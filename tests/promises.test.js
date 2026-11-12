const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function load({ platform = 'Android', fail, permission = true } = {}) {
    const plugin = {}, calls = [], logs = [];
    const error = { code: 'NATIVE_FAILURE', message: 'Failed' };
    const context = vm.createContext({ exports: plugin, device: { platform },
        console: { log() {}, warn() {}, error: (...args) => logs.push(args) },
        require(name) {
            if (name === 'cordova/channel') return new Proxy({}, { get: () => ({ subscribe() {} }) });
            assert.equal(name, 'cordova/exec');
            return (success, failure, service, action, args) => {
                calls.push({ action, args });
                // Real bridge completions are asynchronous.
                queueMicrotask(() => {
                    if (action === fail) failure(error);
                    else success(action === 'requestPermission' || action === 'hasPermission' ? permission :
                        action === 'type' ? 'scheduled' : action === 'getChannel' ? null : true);
                });
            };
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../www/local-notification.js'), 'utf8'), context);
    plugin._defaults = Object.assign({}, plugin._commonOptions,
        platform === 'Android' ? plugin._androidSpecificOptions : plugin._iOSSpecificOptions);
    return { plugin, calls, error, logs };
}

const cases = [
    ['createChannel', [{}], 'createChannel'], ['getChannel', ['id'], 'getChannel'],
    ['deleteChannel', ['id'], 'deleteChannel'],
    ['createChannelGroup', [{ id: 'g', name: 'Group' }], 'createChannelGroup'],
    ['getChannelGroup', ['g'], 'getChannelGroup'], ['deleteChannelGroup', ['g'], 'deleteChannelGroup'],
    ['hasPermission', [], 'hasPermission'], ['requestPermission', [], 'requestPermission'],
    ['canScheduleExactAlarms', [], 'canScheduleExactAlarms'],
    ['schedule', [{ id: 1 }], 'schedule'], ['update', [{ id: 1 }], 'update'],
    ['clear', [1], 'clear'], ['clearAll', [], 'clearAll'],
    ['cancel', [1], 'cancel'], ['cancelAll', [], 'cancelAll'],
    ['isPresent', [1], 'type'], ['isScheduled', [1], 'type'], ['isTriggered', [1], 'type'],
    ['hasType', [1, 'scheduled'], 'type'], ['getType', [1], 'type'],
    ['getIds', [], 'ids'], ['getScheduledIds', [], 'ids'], ['getTriggeredIds', [], 'ids'],
    ['get', [1], 'notification'], ['get', [[1]], 'notifications'], ['get', [], 'notifications'],
    ['getAll', [], 'notifications'], ['getScheduled', [], 'notifications'], ['getTriggered', [], 'notifications'],
    ['addActions', ['g', []], 'actions'], ['removeActions', ['g'], 'actions'], ['hasActions', ['g'], 'actions'],
    ['openNotificationSettings', [], 'openNotificationSettings'], ['openAlarmSettings', [], 'openAlarmSettings'],
    ['iOSClearBadge', [], 'clearBadge'], ['getUnusedAppRestrictionsStatus', [], 'getUnusedAppRestrictionsStatus'],
    ['openManageUnusedAppRestrictions', [], 'openManageUnusedAppRestrictions']
];

test('every asynchronous API resolves and rejects without a callback', async () => {
    for (const [method, args, action] of cases) {
        const success = load();
        const promise = success.plugin[method](...JSON.parse(JSON.stringify(args)));
        assert.equal(typeof promise.then, 'function', method);
        await promise;
        assert.ok(success.calls.some(call => call.action === action), method);
        const failure = load({ fail: action });
        await assert.rejects(failure.plugin[method](...JSON.parse(JSON.stringify(args))), e => e === failure.error, method);
        assert.equal(failure.logs.length, 0, method);
    }
});

test('normal false and null results remain fulfilled values', async () => {
    const { plugin, calls } = load({ permission: false });
    assert.equal(await plugin.requestPermission(), false);
    assert.equal(await plugin.schedule({ id: 1 }), false);
    assert.equal(await plugin.update({ id: 1 }), false);
    assert.equal(await plugin.getChannel('missing'), null);
    assert.ok(!calls.some(c => c.action === 'schedule' || c.action === 'update'));
    const ios = load({ platform: 'iOS' });
    assert.equal(await ios.plugin.getChannel('id'), null);
    assert.equal(await ios.plugin.createChannelGroup({ id: 'g', name: 'Group' }), false);
    assert.equal(await ios.plugin.getChannelGroup('g'), null);
    assert.equal(await ios.plugin.deleteChannelGroup('g'), false);
    assert.equal(ios.calls.length, 0);
});

test('Promise validation rejects; callback validation still throws synchronously', async () => {
    const { plugin } = load();
    await assert.rejects(plugin.getChannel(''), { name: 'TypeError' });
    await assert.rejects(plugin.createChannelGroup({}), { name: 'TypeError' });
    assert.throws(() => plugin.getChannel('', () => {}), { name: 'TypeError' });
});

test('Promise scheduling supports options and propagates permission errors', async () => {
    for (const method of ['schedule', 'update']) {
        const { plugin, calls } = load();
        assert.equal(await plugin[method]({ id: 1 }, { skipPermission: true }), true);
        assert.deepEqual(calls.map(c => c.action), [method]);
        const failure = load({ fail: 'requestPermission' });
        await assert.rejects(failure.plugin[method]({ id: 1 }), e => e === failure.error);
    }
});

test('callback calls retain their return value and legacy object scope', async () => {
    const { plugin } = load();
    const scope = {};
    await new Promise(resolve => {
        const result = plugin.hasPermission(function (value) {
            assert.equal(this, scope); assert.equal(value, true); resolve();
        }, scope);
        assert.equal(result, undefined);
    });
    assert.equal(typeof plugin.getDefaults().then, 'undefined');
});


test('get() reads all notifications while get([]) keeps an explicit empty selection', async () => {
    const { plugin, calls } = load();
    await plugin.get();
    await plugin.get([]);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
        { action: 'notifications', args: [0] },
        { action: 'notifications', args: [3, []] }
    ]);
});
