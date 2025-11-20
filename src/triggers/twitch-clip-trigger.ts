import { AttachmentBuilder, Message } from 'discord.js';
import { ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable } from 'node:stream';
import youtubedl from 'youtube-dl-exec';

import { Trigger } from './trigger.js';
import { EventData } from '../models/internal-models.js';
import { Logger } from '../services/index.js';

export class TwitchClipTrigger implements Trigger {
    requireGuild = false;
    urlRegex = /https:\/\/(clips\.twitch\.tv\/[^\s]+|www\.twitch\.tv\/[^\s]+\/clip\/[^\s]+)/;

    // Check if the message contains a Twitch clip URL
    triggered(msg: Message): boolean {
        return this.urlRegex.test(msg.content);
    }

    // Execute the trigger action if a Twitch clip URL is detected
    async execute(msg: Message, _: EventData): Promise<void> {
        const matches = msg.content.match(this.urlRegex);

        if (!matches) {
            return;
        }

        const match = matches[0];
        const url = match.endsWith('>') ? match.slice(0, -1) : match;

        const subprocess = youtubedl.exec(url, {
            format: 'best',
            output: '-',
        }) as ChildProcessWithoutNullStreams;

        if (!subprocess.stdout) {
            Logger.warn('youtube-dl exec did not expose stdout.');
            return;
        }

        let buffer: Buffer;
        try {
            buffer = await this.readStdout(subprocess.stdout, subprocess);
        } catch (error) {
            Logger.error('Failed to download Twitch clip stream.', error);
            return;
        }

        const attachment = new AttachmentBuilder(buffer, { name: 'clip.mp4' });
        try {
            await msg.channel.send({
                content: `Here's your Twitch clip!`,
                files: [attachment],
            });
            Logger.info('Video sent to Discord');
        } catch (error) {
            Logger.error('Error sending video to Discord:', error);
        }
    }

    private async readStdout(
        stdout: Readable,
        child: ChildProcessWithoutNullStreams
    ): Promise<Buffer> {
        let chunks: Buffer[] = [];
        stdout.on('data', chunk => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        let closeCode = await new Promise<number>((resolve, reject) => {
            child.once('error', error => reject(error));
            child.once('close', code => resolve(code ?? 0));
        });

        Logger.info(`youtube-dl process exited with code ${closeCode}`);

        if (closeCode !== 0) {
            throw new Error(`youtube-dl exited with code ${closeCode}`);
        }

        return Buffer.concat(chunks);
    }
}
