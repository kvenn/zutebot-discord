import { ActivityType, Presence } from 'discord.js';

import { EventHandler } from './index.js';
import { Logger, NotificationThrottleService } from '../services/index.js';
import { ClientUtils, PermissionUtils } from '../utils/index.js';

export class PresenceUpdateHandler implements EventHandler {
    constructor(private throttleService: NotificationThrottleService) {}

    public async process(oldPresence: Presence | null, newPresence: Presence): Promise<void> {
        // Ignore bot users
        if (newPresence.user?.bot) {
            return;
        }

        // Check if user started playing a game
        const oldGame = oldPresence?.activities.find(
            activity => activity.type === ActivityType.Playing
        );
        const newGame = newPresence.activities.find(
            activity => activity.type === ActivityType.Playing
        );

        // Only notify when transitioning from not playing to playing a game
        // or when switching to a different game
        if (!newGame || (oldGame && oldGame.name === newGame.name)) {
            return;
        }

        // Find the "game" channel using ClientUtils
        const guild = newPresence.guild;
        if (!guild) {
            return;
        }

        // Check throttle before proceeding
        const userId = newPresence.userId;
        const guildId = guild.id;
        const context = `game:${newGame.name}`;

        if (!this.throttleService.shouldNotify(userId, guildId, context)) {
            // Notification throttled, skip
            return;
        }

        const gameChannel = await ClientUtils.findTextChannel(guild, 'game');
        if (!gameChannel) {
            // Channel doesn't exist, silently return
            return;
        }

        // Check if bot has permission to send messages
        if (!PermissionUtils.canSend(gameChannel, true)) {
            Logger.warn(
                `Missing permissions to send game notification in channel "${gameChannel.name}" (${gameChannel.id}) in guild "${guild.name}" (${guild.id})`
            );
            return;
        }

        try {
            // Send notification
            const member = newPresence.member;
            const username = member?.displayName || newPresence.user?.username || 'Someone';
            const message = `🎮 ${username} started playing **${newGame.name}**`;

            await gameChannel.send(message);

            // Record notification after successful send
            this.throttleService.recordNotification(userId, guildId, context);

            Logger.info(
                `Game notification sent: ${newPresence.user?.tag} started playing ${newGame.name} in guild "${guild.name}"`
            );
        } catch (error) {
            Logger.error(
                `Failed to send game notification in guild "${guild.name}" (${guild.id})`,
                error
            );
        }
    }
}
