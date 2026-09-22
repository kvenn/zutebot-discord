import { Message } from 'discord.js';

import { EventHandler, TriggerHandler } from './index.js';

export class MessageHandler implements EventHandler {
    constructor(private triggerHandler: TriggerHandler) {}

    public async process(msg: Message): Promise<void> {
        // Don't respond to system messages or self
        if (
            msg.system ||
            (msg.author.id === msg.client.user?.id && !msg.content.includes('twitch'))
        ) {
            return;
        }

        // Process trigger
        await this.triggerHandler.process(msg);
    }
}

// const getProxyConfig = (): AxiosProxyConfig => {
//     const password = config.proxy.password;
//
//     if (!password) {
//         Logger.info('No proxy password found. Add to the .env');
//         return null;
//     }
//
//     const host = 'brd.superproxy.io';
//     const port = 44445;
//     const username = 'brd-customer-hl_f3368662-zone-residential';
//     const session_id = randomUUID();
//
//     return {
//         host,
//         port,
//         auth: {
//             username: `${username}-session-${session_id}`,
//             password: password,
//         },
//     };
// };
