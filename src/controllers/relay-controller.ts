import { REST } from '@discordjs/rest';
import { DiscordAPIError, Routes, ShardingManager } from 'discord.js';
import { Request, Response, Router } from 'express';
import router from 'express-promise-router';
import { createRequire } from 'node:module';

import { Controller } from './controller.js';
import { mapClass } from '../middleware/index.js';
import { RelayMessageRequest } from '../models/relay-api/index.js';
import { Logger } from '../services/index.js';
import { ShardUtils } from '../utils/index.js';

const require = createRequire(import.meta.url);
let Config = require('../../config/config.json');
let Logs = require('../../lang/logs.json');

interface RelayEvalAttachment {
    url: string;
    name?: string;
    description?: string;
}

interface RelayEvalResult {
    delivered: boolean;
    messageId?: string;
    reason?: string;
}

export class RelayController implements Controller {
    public path = '/relay';
    public router: Router = router();
    public authToken: string = Config.api.relay?.secret ?? Config.api.secret;

    private allowedMentions: Record<string, unknown> | undefined;

    constructor(
        private shardManager: ShardingManager,
        private rest: REST
    ) {
        this.allowedMentions = Config.api.relay?.allowedMentions ?? { parse: [] };
    }

    public register(): void {
        this.router.post('/messages', mapClass(RelayMessageRequest), (req, res) =>
            this.relayMessage(req, res)
        );
    }

    private async relayMessage(req: Request, res: Response): Promise<void> {
        let body: RelayMessageRequest = res.locals.input;
        let payload = this.preparePayload(body.payload ?? {});
        if (!this.hasMessageContent(payload, body.attachments)) {
            res.status(400).json({
                error: true,
                message:
                    'Payload must include content, embeds, components, stickers, or attachments.',
            });
            return;
        }

        let targetChannelId = body.threadId ?? body.channelId;
        let channelMetadata: any;
        try {
            channelMetadata = await this.rest.get(Routes.channel(targetChannelId));
        } catch (error) {
            await Logger.error(Logs.error.relayChannelLookupFailed, error);
            let status = error instanceof DiscordAPIError ? error.status : 502;
            if (status === 404) {
                res.status(404).json({
                    error: true,
                    message: 'Channel was not found or the bot lacks access.',
                });
            } else if (status === 403) {
                res.status(403).json({
                    error: true,
                    message: 'Bot is not authorized to post in the requested channel.',
                });
            } else {
                res.status(502).json({
                    error: true,
                    message: 'Failed to resolve Discord channel metadata.',
                });
            }
            return;
        }

        if (!channelMetadata?.guild_id) {
            Logger.warn(
                Logs.warn.relayChannelUnavailable
                    ?.replaceAll('{CHANNEL_ID}', targetChannelId)
                    .replaceAll('{GUILD_ID}', body.guildId) ??
                    `Channel '${targetChannelId}' is not a guild text channel.`
            );
            res.status(400).json({
                error: true,
                message: 'Relay target must be a guild text channel the bot can access.',
            });
            return;
        }

        if (channelMetadata.guild_id !== body.guildId) {
            Logger.warn(
                Logs.warn.relayChannelMismatch
                    ?.replaceAll('{CHANNEL_ID}', targetChannelId)
                    .replaceAll('{GUILD_ID}', body.guildId) ??
                    `Guild '${body.guildId}' does not match channel '${targetChannelId}'.`
            );
            res.status(400).json({
                error: true,
                message: 'Provided guildId does not own the specified channel.',
            });
            return;
        }

        let shardCount =
            typeof this.shardManager.totalShards === 'number'
                ? this.shardManager.totalShards
                : this.shardManager.shards.size;
        let shardId = ShardUtils.shardId(body.guildId, shardCount);

        try {
            let evalResult = await this.shardManager.broadcastEval(
                async (client, context) => {
                    let channel = await client.channels.fetch(context.channelId).catch(() => null);
                    if (!channel || !channel.isTextBased()) {
                        return { delivered: false, reason: 'CHANNEL_NOT_TEXT_BASED' };
                    }

                    let messagePayload = { ...context.payload };

                    // Process username mentions ({{username}} -> <@userId>)
                    if (typeof messagePayload.content === 'string') {
                        let content = messagePayload.content;
                        let usernamePattern = /\{\{([^}]+)\}\}/g;
                        let matches = [...content.matchAll(usernamePattern)];

                        if (matches.length > 0 && channel.guild) {
                            let mentionedUserIds: string[] = [];

                            // Fetch all members if cache is empty
                            if (channel.guild.members.cache.size === 0) {
                                await channel.guild.members.fetch();
                            }

                            for (let match of matches) {
                                let username = match[1].trim().toLowerCase();

                                // Try to find in cache first
                                let member = channel.guild.members.cache.find(
                                    m =>
                                        m.user.username.toLowerCase() === username ||
                                        m.user.tag.toLowerCase() === username ||
                                        (m.nickname && m.nickname.toLowerCase() === username)
                                );

                                // If not found in cache, try fetching by username search
                                if (!member) {
                                    try {
                                        let searchResults = await channel.guild.members.search({
                                            query: username,
                                            limit: 1,
                                        });
                                        if (searchResults.size > 0) {
                                            member = searchResults.first();
                                        }
                                    } catch (error) {
                                        // Search failed, continue without this member
                                    }
                                }

                                if (member) {
                                    content = content.replace(match[0], `<@${member.user.id}>`);
                                    mentionedUserIds.push(member.user.id);
                                }
                            }

                            messagePayload.content = content;

                            // Update allowedMentions to include found users
                            if (mentionedUserIds.length > 0) {
                                if (!messagePayload.allowedMentions) {
                                    messagePayload.allowedMentions = { parse: [], users: [] };
                                }
                                if (typeof messagePayload.allowedMentions === 'object') {
                                    let allowedMentions = messagePayload.allowedMentions as Record<
                                        string,
                                        unknown
                                    >;
                                    if (!Array.isArray(allowedMentions.users)) {
                                        allowedMentions.users = [];
                                    }
                                    (allowedMentions.users as string[]).push(...mentionedUserIds);
                                }
                            }
                        }
                    }

                    if (context.attachments?.length) {
                        let fetchFn = (globalThis as any).fetch;
                        if (!fetchFn) {
                            throw new Error('Fetch API is unavailable in shard process.');
                        }

                        let files = [];
                        for (let i = 0; i < context.attachments.length; i++) {
                            let attachment = context.attachments[i];
                            let response = await fetchFn(attachment.url).catch(() => null);
                            if (!response || !response.ok) {
                                throw new Error(`Failed to download attachment: ${attachment.url}`);
                            }
                            let buffer = Buffer.from(await response.arrayBuffer());
                            files.push({
                                attachment: buffer,
                                name: attachment.name ?? `attachment-${i + 1}`,
                                description: attachment.description,
                            });
                        }
                        messagePayload.files = files;
                    }

                    let sent = await channel.send(messagePayload);
                    return { delivered: true, messageId: sent.id } satisfies RelayEvalResult;
                },
                {
                    context: {
                        channelId: targetChannelId,
                        payload,
                        attachments: body.attachments,
                    },
                    shard: shardId,
                }
            );

            let delivery: RelayEvalResult = Array.isArray(evalResult)
                ? evalResult.find(result => result?.delivered)
                : evalResult;

            if (!delivery?.delivered) {
                Logger.warn(
                    Logs.warn.relayMessageUndelivered
                        ?.replaceAll('{CHANNEL_ID}', targetChannelId)
                        .replaceAll('{GUILD_ID}', body.guildId) ??
                        `Relay payload for channel '${targetChannelId}' could not be delivered.`
                );
                res.status(502).json({
                    error: true,
                    message: 'Unable to deliver relay message to Discord.',
                });
                return;
            }

            Logger.info(
                Logs.info.relayMessageDelivered
                    .replaceAll('{CHANNEL_ID}', targetChannelId)
                    .replaceAll('{GUILD_ID}', body.guildId)
            );

            res.status(202).json({
                guildId: body.guildId,
                channelId: targetChannelId,
                messageId: delivery.messageId,
            });
        } catch (error) {
            await Logger.error(Logs.error.relaySendFailed, error);
            res.status(502).json({ error: true, message: 'Failed to deliver relay message.' });
        }
    }

    private preparePayload(payload: Record<string, unknown>): Record<string, unknown> {
        let sanitized = payload ? JSON.parse(JSON.stringify(payload)) : {};
        if (!sanitized.allowedMentions && this.allowedMentions) {
            sanitized.allowedMentions = JSON.parse(JSON.stringify(this.allowedMentions));
        }
        if ('files' in sanitized) {
            delete sanitized.files;
        }
        return sanitized;
    }

    private hasMessageContent(
        payload: Record<string, unknown>,
        attachments?: RelayEvalAttachment[]
    ): boolean {
        if (!payload) {
            return Boolean(attachments?.length);
        }

        let content = payload.content as string;
        if (typeof content === 'string' && content.trim().length > 0) {
            return true;
        }

        let embeds = payload.embeds as unknown[];
        if (Array.isArray(embeds) && embeds.length > 0) {
            return true;
        }

        let components = payload.components as unknown[];
        if (Array.isArray(components) && components.length > 0) {
            return true;
        }

        let stickers = payload.stickers as unknown[];
        if (Array.isArray(stickers) && stickers.length > 0) {
            return true;
        }

        return Boolean(attachments?.length);
    }
}
