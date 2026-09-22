import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import { ActivityType } from 'discord.js';

import { PresenceUpdateHandler } from '../dist/events/presence-update-handler.js';
import { Logger } from '../dist/services/logger.js';
import { NotificationThrottleService } from '../dist/services/notification-throttle-service.js';
import { ClientUtils } from '../dist/utils/client-utils.js';
import { PermissionUtils } from '../dist/utils/permission-utils.js';

const playerId = '111111111111111111';
const otherId = '222222222222222222';
let throttle;
let handler;
let send;
let findChannel;
let canSend;
let now;

function presence(name, userId = playerId, guildId = 'guild-1') {
    return {
        userId,
        user: { username: 'player', tag: 'player', bot: false },
        member: { displayName: 'TheGrandPoohBah' },
        guild: { id: guildId, name: 'Test guild' },
        activities: name ? [{ type: ActivityType.Playing, name }] : [],
    };
}

beforeEach(() => {
    now = 1_000_000;
    mock.method(Date, 'now', () => now);
    for (const level of ['info', 'warn', 'error']) mock.method(Logger, level, () => {});
    throttle = new NotificationThrottleService(360);
    handler = new PresenceUpdateHandler(throttle);
    send = mock.fn(async () => {});
    findChannel = mock.method(ClientUtils, 'findTextChannel', async () => ({ send }));
    canSend = mock.method(PermissionUtils, 'canSend', () => true);
});

afterEach(() => mock.restoreAll());

test('cosmetic title changes are not game changes', async () => {
    await handler.process(presence('ARK: Survival Ascended'), presence('ARK Survival Ascended'));
    assert.equal(findChannel.mock.callCount(), 0);
});

test('uncached and resumed presence variants share one cooldown and retain the original title', async () => {
    await handler.process(null, presence('ARK: Survival Ascended'));
    await handler.process(null, presence('ARK Survival Ascended'));
    await handler.process(presence(), presence('  ark:  SURVIVAL ASCENDED  '));
    assert.equal(send.mock.callCount(), 1);
    assert.equal(
        send.mock.calls[0].arguments[0],
        '🎮 TheGrandPoohBah started playing **ARK: Survival Ascended**'
    );
    now += 360 * 60 * 1000;
    await handler.process(null, presence('ARK Survival Ascended'));
    assert.equal(send.mock.callCount(), 2);
});

test('simultaneous variants cannot send twice while a send is pending', async () => {
    let finishSend;
    send.mock.mockImplementation(() => new Promise(resolve => (finishSend = resolve)));
    const first = handler.process(null, presence('ARK: Survival Ascended'));
    await Promise.resolve();
    assert.equal(send.mock.callCount(), 1);
    await handler.process(null, presence('ARK Survival Ascended'));
    assert.equal(send.mock.callCount(), 1);
    finishSend();
    await first;
});

test('different games, players, and guilds have independent cooldowns', async () => {
    await handler.process(null, presence('ARK: Survival Ascended'));
    await handler.process(presence('ARK: Survival Ascended'), presence('ARK: Survival Evolved'));
    await handler.process(null, presence('ARK Survival Ascended', otherId));
    await handler.process(null, presence('ARK Survival Ascended', playerId, 'guild-2'));
    assert.equal(send.mock.callCount(), 4);
});

test('hyphenation and Unicode punctuation normalize without dropping sequel numbers or symbols', async () => {
    await handler.process(presence('Counter-Strike 2'), presence('counter strike 2'));
    await handler.process(presence('Tom Clancy’s Game'), presence("Tom Clancy's Game"));
    assert.equal(send.mock.callCount(), 0);
    await handler.process(presence('Game 1'), presence('Game 2'));
    await handler.process(presence('Game'), presence('Game+'));
    await handler.process(presence('Game'), presence('Game#'));
    assert.equal(send.mock.callCount(), 3);
});

test('allowlist selects stable player IDs regardless of their names', async () => {
    handler = new PresenceUpdateHandler(throttle, [playerId]);
    await handler.process(null, presence('ARK', otherId));
    assert.equal(findChannel.mock.callCount(), 0);
    const renamed = presence('ARK');
    renamed.user.username = 'renamed-player';
    renamed.member.displayName = 'New nickname';
    await handler.process(null, renamed);
    assert.equal(send.mock.callCount(), 1);
});

test('omitted allowlist allows everyone; an empty allowlist allows nobody', async () => {
    await handler.process(null, presence('ARK', otherId));
    assert.equal(send.mock.callCount(), 1);
    handler = new PresenceUpdateHandler(throttle, []);
    await handler.process(null, presence('Another game'));
    assert.equal(send.mock.callCount(), 1);
});

test('invalid allowlist config fails closed at startup', () => {
    for (const invalid of [null, 'everyone', {}, ['harrison'], [123], ['']]) {
        assert.throws(
            () => new PresenceUpdateHandler(throttle, invalid),
            /gameNotifications.userIds/
        );
    }
});

test('bots, non-playing activities, stopped games, and missing guilds are ignored', async () => {
    const bot = presence('ARK');
    bot.user.bot = true;
    const listening = presence('Music');
    listening.activities[0].type = ActivityType.Listening;
    const noGuild = presence('ARK');
    noGuild.guild = null;
    for (const current of [bot, listening, noGuild, presence()]) {
        await handler.process(null, current);
    }
    assert.equal(findChannel.mock.callCount(), 0);
});

test('send failures release the reservation and do not consume the cooldown', async () => {
    send.mock.mockImplementationOnce(async () => {
        throw new Error('Send failed');
    });
    await handler.process(null, presence('ARK: Survival Ascended'));
    assert.equal(throttle.getStats().totalEntries, 0);
    await handler.process(null, presence('ARK Survival Ascended'));
    assert.equal(send.mock.callCount(), 2);
    assert.equal(throttle.getStats().totalEntries, 1);
});

test('missing channels, permission denial, and lookup errors can be retried', async () => {
    findChannel.mock.mockImplementationOnce(async () => undefined);
    await handler.process(null, presence('ARK'));
    canSend.mock.mockImplementationOnce(() => false);
    await handler.process(null, presence('ARK'));
    findChannel.mock.mockImplementationOnce(async () => {
        throw new Error('Lookup failed');
    });
    await handler.process(null, presence('ARK'));
    assert.equal(throttle.getStats().totalEntries, 0);
    await handler.process(null, presence('ARK'));
    assert.equal(send.mock.callCount(), 1);
});
