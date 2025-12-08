import { ActivityType, ChannelType, Presence, TextChannel } from 'discord.js';

import { EventHandler } from './index.js';
import { Logger } from '../services/index.js';

export class PresenceUpdateHandler implements EventHandler {
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

        // Find the "game" channel (case-insensitive)
        const guild = newPresence.guild;
        if (!guild) {
            return;
        }

        const gameChannel = guild.channels.cache.find(
            channel =>
                channel.type === ChannelType.GuildText && channel.name.toLowerCase() === 'game'
        ) as TextChannel | undefined;

        if (!gameChannel) {
            // Channel doesn't exist, silently return
            return;
        }

        // Check if bot has permission to send messages
        const permissions = gameChannel.permissionsFor(guild.members.me);
        if (!permissions?.has(['ViewChannel', 'SendMessages'])) {
            Logger.warn(
                `Missing permissions to send game notification in channel "${gameChannel.name}" (${gameChannel.id}) in guild "${guild.name}" (${guild.id})`
            );
            return;
        }

        try {
            // Send notification
            const member = newPresence.member;
            const message = `🎮 ${member?.toString() || newPresence.user?.tag} started playing **${newGame.name}**`;

            await gameChannel.send(message);

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
