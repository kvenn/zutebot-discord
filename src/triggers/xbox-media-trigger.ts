import axios from 'axios';
import * as cheerio from 'cheerio';
import { Message } from 'discord.js';

import { Trigger } from './trigger.js';
import { EventData } from '../models/internal-models.js';
import { Logger } from '../services/index.js';
import { MessageUtils, getAxiosProxyConfig } from '../utils/index.js';

export class XboxMediaTrigger implements Trigger {
    requireGuild = false;
    urlRegex = /https:\/\/www\.xbox\.com\/play\/media\/(.+)/;

    // Check if the message contains an Xbox media URL
    triggered(msg: Message): boolean {
        return this.urlRegex.test(msg.content);
    }

    // Execute the trigger action if an Xbox media URL is detected
    async execute(msg: Message, _: EventData): Promise<void> {
        const matches = msg.content.match(this.urlRegex);

        if (matches) {
            Logger.info('Xbox media URL detected');
            const url = matches[0];

            // Make a request to the detected URL
            const response = await axios.get(url, {
                proxy: getAxiosProxyConfig() ?? false,
            });

            // Check for a successful response
            if (response.status !== 200) {
                Logger.error('Failed to fetch Xbox media URL', { url, status: response.status });
                return;
            }

            // Parse the HTML to find the video source
            const $ = cheerio.load(response.data);
            const videoSrc = $('video').attr('src');

            // If a video source is found, format and send a message
            if (videoSrc) {
                const usersName = msg.author.username;
                const formattedMessage = `📽️ Sick clip from ${usersName}:\n[Original](${msg.content})\n[Unfurl](${videoSrc})`;
                await MessageUtils.send(msg.channel, formattedMessage);

                // Delete the original message
                await msg.delete();
            }
        } else {
            Logger.warn('Xbox media URL not detected but trigger executed');
        }
    }
}
