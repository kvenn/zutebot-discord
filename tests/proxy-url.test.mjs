import assert from 'node:assert/strict';
import test from 'node:test';
import { currentProxyUrl, configureGlobalProxy } from '../dist/utils/proxy-url.js';
import { getAxiosProxyConfig, getProxyAgent } from '../dist/utils/proxy-utils.js';

test('upgrades Bright Data ports without changing proxy credentials or unrelated endpoints', () => {
    for (const host of ['brd.superproxy.io', 'zproxy.lum-superproxy.io']) {
        for (const port of ['22225', '33335']) {
            const url = new URL(currentProxyUrl(`http://user:p%40ss@${host}:${port}`));
            assert.equal(url.hostname, 'brd.superproxy.io');
            assert.equal(url.port, '44445');
            assert.equal(url.username, 'user');
            assert.equal(url.password, 'p%40ss');
        }
    }
    for (const value of [
        'http://localhost:22225',
        'http://brd.superproxy.io.attacker.example:22225',
        'http://brd.superproxy.io:44445',
    ]) {
        assert.equal(currentProxyUrl(value), value);
    }
});

test('selective and global proxies use environment values loaded after module imports', () => {
    const keys = ['BRIGHTDATA_PROXY_URL', 'GLOBAL_AGENT_HTTP_PROXY', 'GLOBAL_AGENT_HTTPS_PROXY'];
    const previous = keys.map(key => process.env[key]);
    try {
        process.env.BRIGHTDATA_PROXY_URL = '';
        process.env.GLOBAL_AGENT_HTTP_PROXY = 'http://user:p%40ss@brd.superproxy.io:22225';
        process.env.GLOBAL_AGENT_HTTPS_PROXY = 'http://user:p%40ss@brd.superproxy.io:33335';
        assert.equal(getAxiosProxyConfig().port, 44445);
        assert.equal(getAxiosProxyConfig().auth.password, 'p@ss');
        const agent = getProxyAgent();
        assert.equal(agent.proxy.port, '44445');
        agent.destroy();
        configureGlobalProxy();
        assert.equal(new URL(process.env.GLOBAL_AGENT_HTTP_PROXY).port, '44445');
        assert.equal(new URL(process.env.GLOBAL_AGENT_HTTPS_PROXY).port, '44445');
    } finally {
        keys.forEach((key, i) => {
            if (previous[i] === undefined) delete process.env[key];
            else process.env[key] = previous[i];
        });
    }
});
