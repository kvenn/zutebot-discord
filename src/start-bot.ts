import { REST } from '@discordjs/rest';
import { GatewayIntentBits, Options, Partials } from 'discord.js';
import dotenv from 'dotenv-safe';
import { createRequire } from 'node:module';

import { Button } from './buttons/index.js';
import { DevCommand, HelpCommand, InfoCommand, TestCommand } from './commands/chat/index.js';
import {
    ChatCommandMetadata,
    Command,
    MessageCommandMetadata,
    UserCommandMetadata,
} from './commands/index.js';
import { ViewDateSent } from './commands/message/index.js';
import { ViewDateJoined } from './commands/user/index.js';
import { config } from './config.js';
import {
    ButtonHandler,
    CommandHandler,
    GuildJoinHandler,
    GuildLeaveHandler,
    MessageHandler,
    PresenceUpdateHandler,
    ReactionHandler,
    TriggerHandler,
    VoiceStateUpdateHandler,
} from './events/index.js';
import { CustomClient } from './extensions/index.js';
import { CheckNewClipsJob, kyleGameClipPoster } from './jobs/check-new-clips-job.js';
import { Job } from './jobs/index.js';
import { Bot } from './models/bot.js';
import { Reaction } from './reactions/index.js';
import {
    CommandRegistrationService,
    EventDataService,
    JobService,
    Logger,
    NotificationThrottleService,
} from './services/index.js';
import { Trigger } from './triggers/index.js';
import { TwitchClipTrigger } from './triggers/twitch-clip-trigger.js';
import { XboxMediaTrigger } from './triggers/xbox-media-trigger.js';

// Optional env vars that may be intentionally unset in production
[
    'GLOBAL_AGENT_HTTP_PROXY',
    'BRIGHTDATA_PROXY_URL',
    'BD_PROXY_PASSWORD',
    'TWITCH_ACCESS_TOKEN',
].forEach(name => {
    if (process.env[name] === undefined) {
        process.env[name] = '';
    }
});

dotenv.config({ allowEmptyValues: true });

const require = createRequire(import.meta.url);
let Config = require('../config/config.json');
let Logs = require('../lang/logs.json');

async function start(): Promise<void> {
    // Apply proxy only if explicitly configured; avoids breaking Discord gateway over bad proxies.
    if (process.env.GLOBAL_AGENT_HTTP_PROXY) {
        Logger.warn('GLOBAL_AGENT_HTTP_PROXY detected; enabling global-agent proxying.');
        let { bootstrap } = await import('global-agent');
        bootstrap();
    }

    // Services
    let eventDataService = new EventDataService();
    let notificationThrottleService = new NotificationThrottleService();

    // Start the throttle service cleanup
    notificationThrottleService.startCleanup();

    let enableGatewayDebug =
        process.env.DEBUG_DISCORD_GATEWAY === '1' ||
        process.env.DEBUG_DISCORD_GATEWAY?.toLowerCase() === 'true';

    let disableMessageContentIntent =
        process.env.DISABLE_MESSAGE_CONTENT_INTENT === '1' ||
        process.env.DISABLE_MESSAGE_CONTENT_INTENT?.toLowerCase() === 'true';
    let intents = (Config.client.intents as (keyof typeof GatewayIntentBits)[]).filter(intent =>
        disableMessageContentIntent ? intent !== 'MessageContent' : true
    );
    let intentBits = intents.map(intent => GatewayIntentBits[intent]);
    if (disableMessageContentIntent) {
        Logger.warn('MessageContent intent disabled via DISABLE_MESSAGE_CONTENT_INTENT env var.');
    }
    if (enableGatewayDebug) {
        Logger.warn('Discord gateway debug logging enabled (DEBUG_DISCORD_GATEWAY=1).');
    }

    // Client
    let client = new CustomClient({
        /** https://discord-api-types.dev/api/discord-api-types-v10/enum/GatewayIntentBits#Index */
        intents: intentBits,
        partials: (Config.client.partials as string[]).map(partial => Partials[partial]),
        makeCache: Options.cacheWithLimits({
            // Keep default caching behavior
            ...Options.DefaultMakeCacheSettings,
            // Override specific options from config
            ...Config.client.caches,
        }),
    });

    // Commands
    let commands: Command[] = [
        // Chat Commands
        new DevCommand(),
        new HelpCommand(),
        new InfoCommand(),
        new TestCommand(),

        // Message Context Commands
        new ViewDateSent(),

        // User Context Commands
        new ViewDateJoined(),

        // TODO: Add new commands here
    ];

    // Buttons
    let buttons: Button[] = [
        // TODO: Add new buttons here
    ];

    // Reactions
    let reactions: Reaction[] = [
        // TODO: Add new reactions here
    ];

    // Triggers (a thing that listens to all words in a message)
    let triggers: Trigger[] = [new XboxMediaTrigger(), new TwitchClipTrigger()];

    // Event handlers
    let guildJoinHandler = new GuildJoinHandler(eventDataService);
    let guildLeaveHandler = new GuildLeaveHandler();
    let commandHandler = new CommandHandler(commands, eventDataService);
    let buttonHandler = new ButtonHandler(buttons, eventDataService);
    let triggerHandler = new TriggerHandler(triggers, eventDataService);
    let messageHandler = new MessageHandler(triggerHandler);
    let reactionHandler = new ReactionHandler(reactions, eventDataService);
    let voiceStateUpdateHandler = new VoiceStateUpdateHandler(
        eventDataService,
        notificationThrottleService
    );
    let presenceUpdateHandler = new PresenceUpdateHandler(notificationThrottleService);

    if (enableGatewayDebug) {
        client.on('debug', (message: string) => Logger.warn(`[discord.js debug] ${message}`));
    }

    // Jobs
    let jobs: Job[] = [new CheckNewClipsJob(client, [kyleGameClipPoster])];

    // Bot
    let bot = new Bot(
        config.discord.token,
        client,
        guildJoinHandler,
        guildLeaveHandler,
        messageHandler,
        commandHandler,
        buttonHandler,
        reactionHandler,
        voiceStateUpdateHandler,
        presenceUpdateHandler,
        new JobService(jobs)
    );

    // Register
    if (process.argv[2] == 'commands') {
        try {
            let rest = new REST({ version: '10' }).setToken(config.discord.token);
            let commandRegistrationService = new CommandRegistrationService(rest);
            let localCmds = [
                ...Object.values(ChatCommandMetadata).sort((a, b) => (a.name > b.name ? 1 : -1)),
                ...Object.values(MessageCommandMetadata).sort((a, b) => (a.name > b.name ? 1 : -1)),
                ...Object.values(UserCommandMetadata).sort((a, b) => (a.name > b.name ? 1 : -1)),
            ];
            await commandRegistrationService.process(localCmds, process.argv);
        } catch (error) {
            Logger.error(Logs.error.commandAction, error);
        }
        // Wait for any final logs to be written.
        await new Promise(resolve => setTimeout(resolve, 1000));
        process.exit();
    }

    await bot.start();
}

process.on('unhandledRejection', (reason, _promise) => {
    Logger.error(Logs.error.unhandledRejection, reason);
});

start().catch(error => {
    Logger.error(Logs.error.unspecified, error);
});
