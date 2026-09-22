import { ActivityType, Presence } from 'discord.js';

import { EventHandler } from './index.js';
import { Logger, NotificationThrottleService } from '../services/index.js';
import { ClientUtils, PermissionUtils } from '../utils/index.js';

export class PresenceUpdateHandler implements EventHandler {
    private readonly inFlightNotifications: Set<string> = new Set();
    private readonly allowedUserIds: Set<string> | undefined;

    constructor(
        private throttleService: NotificationThrottleService,
        userIds?: string[]
    ) {
        if (
            userIds !== undefined &&
            (!Array.isArray(userIds) ||
                userIds.some(id => typeof id !== 'string' || !/^\d{17,20}$/.test(id)))
        ) {
            throw new Error(
                'gameNotifications.userIds must be an array of Discord user ID strings'
            );
        }
        this.allowedUserIds = userIds === undefined ? undefined : new Set(userIds);
    }

    private normalizeGameName(name: string): string {
        // Ignore cosmetic punctuation, spacing, and case. Keep meaningful symbols such as + and #.
        return name
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[\p{P}\s]/gu, character => (character === '#' ? character : ''));
    }

    public async process(oldPresence: Presence | null, newPresence: Presence): Promise<void> {
        // Ignore bot users
        if (newPresence.user?.bot) {
            return;
        }

        if (this.allowedUserIds && !this.allowedUserIds.has(newPresence.userId)) {
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
        if (!newGame) {
            return;
        }
        const gameKey = this.normalizeGameName(newGame.name);
        if (oldGame && this.normalizeGameName(oldGame.name) === gameKey) {
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
        const context = `game:${gameKey}`;
        const notificationKey = JSON.stringify([guildId, userId, context]);

        if (
            this.inFlightNotifications.has(notificationKey) ||
            !this.throttleService.shouldNotify(userId, guildId, context)
        ) {
            // Notification throttled, skip
            return;
        }

        // Reserve synchronously before any await so simultaneous presence events cannot both send.
        this.inFlightNotifications.add(notificationKey);
        try {
            const gameChannel = await ClientUtils.findTextChannel(guild, 'game');
            if (!gameChannel) {
                return;
            }

            if (!PermissionUtils.canSend(gameChannel, true)) {
                Logger.warn(
                    `Missing permissions to send game notification in channel "${gameChannel.name}" (${gameChannel.id}) in guild "${guild.name}" (${guild.id})`
                );
                return;
            }

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
        } finally {
            // Failed sends and missing channels remain eligible for a later retry.
            this.inFlightNotifications.delete(notificationKey);
        }
    }
}
