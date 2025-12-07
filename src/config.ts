import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let Config = require('../config/config.json');

const tokenFromEnv = process.env.DISCORD_TOKEN;
const tokenFromConfig = Config.client.token;
const resolvedToken = tokenFromEnv ?? tokenFromConfig;
const proxyPassword = process.env.BD_PROXY_PASSWORD;

if (!resolvedToken || resolvedToken.startsWith('00000000-0000')) {
    throw new Error('Discord bot token not configured. Set DISCORD_TOKEN or update config.json.');
}

export const config = {
    discord: {
        // Prefer environment variable in production; fall back to config file for local dev.
        token: resolvedToken,
    },
    proxy: {
        password: proxyPassword,
    },
};
