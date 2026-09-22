/** Upgrade retired Bright Data endpoints without changing unrelated proxies. */
export function currentProxyUrl(value: string): string {
    const url = new URL(value);
    if (
        ['brd.superproxy.io', 'zproxy.lum-superproxy.io'].includes(url.hostname) &&
        ['22225', '33335'].includes(url.port)
    ) {
        url.hostname = 'brd.superproxy.io';
        url.port = '44445';
        return url.toString();
    }
    return value;
}

export function configureGlobalProxy(): void {
    for (const name of ['GLOBAL_AGENT_HTTP_PROXY', 'GLOBAL_AGENT_HTTPS_PROXY']) {
        const value = process.env[name];
        if (value) process.env[name] = currentProxyUrl(value);
    }
}
