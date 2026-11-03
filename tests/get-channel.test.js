const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadPlugin(platform, result) {
    const calls = [];
    const plugin = {};
    const context = vm.createContext({
        exports: plugin,
        device: { platform },
        require(name) {
            if (name === 'cordova/channel') {
                // Startup subscriptions are unrelated to this API.
                return new Proxy({}, { get: () => ({ subscribe() {} }) });
            }
            assert.equal(name, 'cordova/exec');
            return (success, error, service, action, args) => {
                calls.push({ service, action, args: Array.from(args) });
                if (success) success(result);
            };
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../www/local-notification.js'), 'utf8'), context);
    return { plugin, calls };
}

test('queries the exact channel ID without creating a channel and forwards current settings', () => {
    const result = { id: 'reminders', importance: 0, blocked: true };
    const { plugin, calls } = loadPlugin('Android', result);
    let received;
    const scope = {};
    plugin.getChannel('reminders', function (channel) {
        assert.equal(this, scope);
        received = channel;
    }, scope);
    assert.equal(received, result);
    assert.deepEqual(calls, [{ service: 'LocalNotification', action: 'getChannel', args: ['reminders'] }]);
});

test('forwards null for a missing channel or Android without channel support', () => {
    const { plugin } = loadPlugin('Android', null);
    plugin.getChannel('missing', channel => assert.equal(channel, null));
});

test('returns null on iOS without calling the native bridge and preserves callback scope', () => {
    const { plugin, calls } = loadPlugin('iOS');
    const scope = {};
    let called = false;
    plugin.getChannel('reminders', function (channel) {
        called = true;
        assert.equal(channel, null);
        assert.equal(this, scope);
    }, scope);
    assert.equal(called, true);
    assert.deepEqual(calls, []);
});

test('rejects invalid IDs before calling the native bridge', () => {
    const { plugin, calls } = loadPlugin('Android');
    for (const id of [undefined, null, '', 1, {}, []]) {
        assert.throws(() => plugin.getChannel(id, () => {}), { name: 'TypeError' });
    }
    assert.deepEqual(calls, []);
});

test('allows an omitted callback on Android and iOS', () => {
    for (const platform of ['Android', 'iOS']) {
        const { plugin } = loadPlugin(platform, null);
        assert.doesNotThrow(() => plugin.getChannel('reminders'));
    }
});
