const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function load(platform) {
    const plugin = {}, calls = [];
    let now = 1800000000000;
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../www/local-notification.js'), 'utf8'), {
        exports: plugin, device: { platform }, Date: Clock,
        console: { log() {}, warn() {}, error() {} },
        require(name) {
            if (name === 'cordova/channel') return new Proxy({}, { get: () => ({ subscribe() {} }) });
            assert.equal(name, 'cordova/exec');
            return (success, failure, service, action, args) => {
                calls.push({ action, args });
                if (success) success(true);
            };
        }
    });
    plugin._defaults = Object.assign({}, plugin._commonOptions,
        platform === 'Android' ? plugin._androidSpecificOptions : plugin._iOSSpecificOptions);
    return { plugin, calls, now, advance(ms) { now += ms; } };
}

for (const platform of ['Android', 'iOS']) {
    test(`${platform}: missing and empty triggers request immediate delivery without a five-second delay`, async () => {
        const { plugin, calls, now } = load(platform);
        for (const trigger of [undefined, null, {}]) {
            await plugin.schedule({ id: 1, trigger });
            const sent = calls.filter(c => c.action === 'schedule').at(-1).args[0].trigger;
            assert.equal(sent.type, 'calendar');
            assert.equal(sent.at, platform === 'Android' ? now : undefined);
            assert.equal(sent.in, undefined);
        }
    });

    test(`${platform}: retain the overdue grace period, ignore older dates and preserve future dates`, async () => {
        const { plugin, calls, now } = load(platform);
        await plugin.schedule([
            { id: 1, trigger: { at: now - 4999 } },
            { id: 2, trigger: { at: now - 5000 } },
            { id: 3, trigger: { at: now - 86400000 } },
            { id: 4, trigger: { at: now + 500 } },
            { id: 5, trigger: { at: now } },
            { id: 6, trigger: { in: 2, unit: 'minute' } },
            { id: 7, trigger: { every: 'day' } }
        ]);
        const sent = calls.find(c => c.action === 'schedule').args;
        assert.deepEqual(Array.from(sent, n => n.id), [1, 4, 5, 6, 7]);
        assert.equal(sent[0].trigger.at, now - 4999);
        assert.equal(sent[1].trigger.at, now + 500);
        assert.equal(sent[2].trigger.at, now);
        assert.equal(sent[3].trigger.in, 2);
        assert.equal(sent[4].trigger.every, 'day');
    });

    test(`${platform}: evaluate explicit dates after permission and preserve immediate requests`, async () => {
        const { plugin, calls, advance, now } = load(platform);
        plugin.requestPermission = success => { advance(60000); success(true); };
        const trigger = { at: now + 1000 };
        await plugin.schedule([{ id: 1 }, { id: 2, trigger }, { id: 3, trigger: { at: now + 59000 } }]);
        const sent = calls.find(call => call.action === 'schedule').args;
        assert.deepEqual(Array.from(sent, item => item.id), [1, 3]);
        assert.equal(sent[0].trigger.at, platform === 'Android' ? now + 60000 : undefined);
        assert.deepEqual(trigger, { at: now + 1000 });
    });

    test(`${platform}: a text update leaves the stored trigger intact`, async () => {
        const { plugin, calls } = load(platform);
        await plugin.update({ id: 42, text: 'New text' });
        const sent = calls.find(call => call.action === 'update').args[0];
        assert.equal(Object.hasOwn(sent, 'trigger'), false);
    });
}

test('invalid importance rejects before invoking the native bridge; legacy calls throw TypeError', async () => {
    const { plugin, calls } = load('Android');
    for (const value of ['IMPORTANCE_ALARM', 'toString', '4']) {
        await assert.rejects(plugin.schedule({ androidChannelImportance: value }), /Unknown androidChannelImportance/);
        await assert.rejects(plugin.createChannel({ androidChannelImportance: value }), /Unknown androidChannelImportance/);
        assert.throws(() => plugin.schedule({ androidChannelImportance: value }, () => {}), { name: 'TypeError' });
    }
    assert.equal(calls.length, 0);
    for (const [name, value] of Object.entries(plugin._androidChannelImportanceTypes)) {
        await plugin.createChannel({ androidChannelImportance: name });
        assert.equal(calls.at(-1).args[0].androidChannelImportance, value);
        await plugin.schedule({ androidChannelImportance: value });
        assert.equal(calls.at(-1).args[0].androidChannelImportance, value);
    }
});
