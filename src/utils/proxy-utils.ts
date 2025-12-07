import { AxiosProxyConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

const proxyUrl = process.env.BRIGHTDATA_PROXY_URL ?? process.env.GLOBAL_AGENT_HTTP_PROXY;

export function getProxyAgent(): HttpsProxyAgent | undefined {
    if (!proxyUrl) {
        return undefined;
    }
    return new HttpsProxyAgent(proxyUrl);
}

export function getAxiosProxyConfig(): AxiosProxyConfig | undefined {
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
