import fetch from 'node-fetch';

import { CustomClient } from '../extensions/index.js';
import { Job } from '../jobs/index.js';
import { Logger } from '../services/index.js';
import { ClientUtils } from '../utils/index.js';

interface ClipPoster {
    guildId: string;
    textChannelId: string;
    twitchBroadcastId: string;
}

export const kyleGameClipPoster: ClipPoster = {
    guildId: '1177719384668635196',
    textChannelId: '1177719384668635199',
    twitchBroadcastId: '131715921',
};

interface Clip {
    id: string;
    url: string;
    created_at: string;
}

interface ClipData {
    data: Clip[];
}

const inMemoryIds: string[] = [];
const minuteInMs = 60000;

export class CheckNewClipsJob extends Job {
    name = 'CheckNewClipsJob';
    log = true;
    // Every 1 minute
    schedule = '*/30 * * * * *';
    private twitchBaseUrl = 'https://api.twitch.tv/helix/clips';
    private readonly clipPosters: ClipPoster[];
    private readonly client: CustomClient;
    private accessToken?: string;
    private accessTokenExpiresAt?: number;

    constructor(client: CustomClient, clipPosters: ClipPoster[] = []) {
        super();
        this.client = client;
        this.clipPosters = clipPosters;
    }

    private async getAccessToken(): Promise<string | undefined> {
        if (this.accessToken && this.accessTokenExpiresAt && Date.now() < this.accessTokenExpiresAt) {
            return this.accessToken;
        }

        let envToken = process.env.TWITCH_ACCESS_TOKEN?.trim();
        if (envToken) {
            this.accessToken = envToken;
            this.accessTokenExpiresAt = Date.now() + 60 * minuteInMs; // assume 1h if unknown
            return this.accessToken;
        }

        let clientId = process.env.TWITCH_CLIENT_ID?.trim();
        let clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();
        if (!clientId || !clientSecret) {
            Logger.warn('Twitch credentials missing; skipping clip check.');
            return undefined;
        }

        try {
            let res = await fetch(
                `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
                {
                    method: 'POST',
                }
            );
            if (!res.ok) {
                Logger.error(`Failed to fetch Twitch app token (status ${res.status}).`);
                return undefined;
            }
            let body = (await res.json()) as { access_token?: string; expires_in?: number };
            if (!body.access_token) {
                Logger.error('Twitch token response missing access_token.');
                return undefined;
            }
            this.accessToken = body.access_token;
            let expiresInMs = (body.expires_in ?? 3600) * 1000;
            this.accessTokenExpiresAt = Date.now() + expiresInMs - 60 * 1000; // refresh 1 min early
            Logger.info('Fetched Twitch app access token.');
            return this.accessToken;
        } catch (error) {
            Logger.error('Error fetching Twitch app token', error);
            return undefined;
        }
    }

    private async fetchClips(
        twitchBroadcastId: string,
        greaterThanIsoString: string,
        token: string
    ): Promise<Clip[]> {
        const url = `${this.twitchBaseUrl}?broadcaster_id=${twitchBroadcastId}&started_at=${greaterThanIsoString}`;
        const response = await fetch(url, {
            headers: {
                'Client-ID': process.env.TWITCH_CLIENT_ID,
                Authorization: `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = (await response.json()) as ClipData;
        return data.data || [];
    }

    public async run(): Promise<void> {
        let token = await this.getAccessToken();
        if (!token) {
            return;
        }

        for (const clipPoster of this.clipPosters) {
            const isoStringToUse = new Date(Date.now() - minuteInMs).toISOString();
            let clips: Clip[];
            try {
                clips = await this.fetchClips(clipPoster.twitchBroadcastId, isoStringToUse, token);
            } catch (error) {
                // Retry once on 401 by refreshing token
                if (error instanceof Error && /401/.test(error.message)) {
                    this.accessToken = undefined;
                    token = await this.getAccessToken();
                    if (!token) {
                        return;
                    }
                    clips = await this.fetchClips(clipPoster.twitchBroadcastId, isoStringToUse, token);
                } else {
                    throw error;
                }
            }
            if (clips.length === 0) {
                continue;
            }

            const guild = await ClientUtils.getGuild(this.client, clipPoster.guildId);
            const textChannel = await ClientUtils.findTextChannel(guild, clipPoster.textChannelId);
            if (!textChannel) {
                console.error(
                    `Text channel ${clipPoster.textChannelId} not found in guild ${clipPoster.guildId}.`
                );
                continue;
            }

            for (const clip of clips) {
                if (!inMemoryIds.includes(clip.id)) {
                    await textChannel.send(`New clip: <${clip.url}>`);
                }
                inMemoryIds.push(clip.id);
            }
        }
    }
}
