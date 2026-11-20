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
