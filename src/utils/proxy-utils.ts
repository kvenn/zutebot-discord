import { AxiosProxyConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

import { currentProxyUrl } from './proxy-url.js';

function configuredProxyUrl(): string | undefined {
    const value = process.env.BRIGHTDATA_PROXY_URL || process.env.GLOBAL_AGENT_HTTP_PROXY;
    return value ? currentProxyUrl(value) : undefined;
}

export function getProxyAgent(): HttpsProxyAgent<string> | undefined {
    const proxyUrl = configuredProxyUrl();
    if (!proxyUrl) {
        return undefined;
    }
    return new HttpsProxyAgent<string>(proxyUrl);
}

export function getAxiosProxyConfig(): AxiosProxyConfig | undefined {
    const proxyUrl = configuredProxyUrl();
    if (!proxyUrl) {
        return undefined;
    }

    let url = new URL(proxyUrl);
    let port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    let username = url.username ? decodeURIComponent(url.username) : undefined;
    let password = url.password ? decodeURIComponent(url.password) : undefined;

    return {
        protocol: url.protocol.replace(':', ''),
        host: url.hostname,
        port,
        auth: username
            ? {
                  username,
                  password,
              }
            : undefined,
    };
}
