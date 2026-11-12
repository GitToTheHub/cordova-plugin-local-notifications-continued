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


test('creates, reads, and deletes channel groups with the expected bridge arguments', () => {
    const { plugin, calls } = loadPlugin('Android', true);
    const options = { id: 'accounts', name: 'Accounts', description: 'Account reminders' };
    const scope = {};
    let received;
    plugin.createChannelGroup(options, function (result) {
        assert.equal(this, scope);
        received = result;
    }, scope);
    assert.equal(received, true);
    assert.equal(calls[0].action, 'createChannelGroup');
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)), [options]);
    plugin.getChannelGroup('accounts', () => {});
    plugin.deleteChannelGroup('accounts', () => {});
    assert.deepEqual(calls.slice(1), [
        { service: 'LocalNotification', action: 'getChannelGroup', args: ['accounts'] },
        { service: 'LocalNotification', action: 'deleteChannelGroup', args: ['accounts'] }
    ]);
});

test('group operations return unsupported results on iOS without calling native code', () => {
    const { plugin, calls } = loadPlugin('iOS');
    const scope = {};
    const results = [];
    function callback(value) { assert.equal(this, scope); results.push(value); }
    plugin.createChannelGroup({ id: 'group', name: 'Group' }, callback, scope);
    plugin.getChannelGroup('group', callback, scope);
    plugin.deleteChannelGroup('group', callback, scope);
    assert.deepEqual(results, [false, null, false]);
    assert.doesNotThrow(() => plugin.createChannelGroup({ id: 'group', name: 'Group' }));
    assert.doesNotThrow(() => plugin.getChannelGroup('group'));
    assert.doesNotThrow(() => plugin.deleteChannelGroup('group'));
    assert.deepEqual(calls, []);
});

test('validates group IDs, names, and descriptions before invoking native code', () => {
    const { plugin, calls } = loadPlugin('Android');
    for (const options of [null, {}, { id: '', name: 'Group' }, { id: 'g', name: '' },
        { id: 1, name: 'Group' }, { id: 'g', name: 'Group', description: 1 }]) {
        assert.throws(() => plugin.createChannelGroup(options, () => {}), { name: 'TypeError' });
    }
    for (const id of [undefined, null, '', 1]) {
        assert.throws(() => plugin.getChannelGroup(id, () => {}), { name: 'TypeError' });
        assert.throws(() => plugin.deleteChannelGroup(id, () => {}), { name: 'TypeError' });
    }
    assert.deepEqual(calls, []);
});

test('forwards group membership when preparing channel options', () => {
    const { plugin, calls } = loadPlugin('Android');
    plugin._defaults = Object.assign({}, plugin._commonOptions, plugin._androidSpecificOptions);
    plugin.createChannel({ androidChannelId: 'reminders', androidChannelGroupId: 'accounts' });
    assert.equal(calls[0].action, 'createChannel');
    assert.equal(calls[0].args[0].androidChannelGroupId, 'accounts');
});
