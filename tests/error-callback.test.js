const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadPlugin(failAction, permission = true) {
    const calls = [], loggedErrors = [];
    const plugin = {};
    const error = { message: 'Native operation failed', code: 'TEST_ERROR' };
    const context = vm.createContext({
        exports: plugin,
        device: { platform: 'Android' },
        console: { log() {}, warn() {}, error: (...args) => loggedErrors.push(args) },
        require(name) {
            if (name === 'cordova/channel') {
                return new Proxy({}, { get: () => ({ subscribe() {} }) });
            }
            assert.equal(name, 'cordova/exec');
            return (success, failure, service, action, args) => {
                calls.push({ action, args });
                if (action === failAction) failure(error);
                else if (success) success(action === 'requestPermission' ? permission : true);
            };
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../www/local-notification.js'), 'utf8'), context);
    plugin._defaults = Object.assign({}, plugin._commonOptions, plugin._androidSpecificOptions);
    return { plugin, error, calls, loggedErrors };
}

const failSuccess = () => assert.fail('Success callback must not run for a native error');

test('native channel errors reach the third-argument error callback with the original payload', () => {
    const { plugin, error, loggedErrors } = loadPlugin('createChannel');
    let count = 0;
    plugin.createChannel({ androidChannelId: 'test' }, failSuccess, function (value) {
        assert.equal(value, error);
        count++;
    });
    assert.equal(count, 1);
    assert.deepEqual(loggedErrors, []);
});

test('native bridge methods and query wrappers forward their final error callback', () => {
    const cases = [
        ['getChannel', ['test'], 'getChannel'],
        ['createChannelGroup', [{ id: 'g', name: 'Group' }], 'createChannelGroup'],
        ['getChannelGroup', ['g'], 'getChannelGroup'],
        ['deleteChannelGroup', ['g'], 'deleteChannelGroup'],
        ['deleteChannel', ['test'], 'deleteChannel'],
        ['hasPermission', [], 'hasPermission'],
        ['requestPermission', [], 'requestPermission'],
        ['canScheduleExactAlarms', [], 'canScheduleExactAlarms'],
        ['clear', [[1, 2]], 'clear'], ['clearAll', [], 'clearAll'],
        ['cancel', [1], 'cancel'], ['cancelAll', [], 'cancelAll'],
        ['isPresent', [1], 'type'], ['isScheduled', [1], 'type'],
        ['isTriggered', [1], 'type'], ['hasType', [1, 'scheduled'], 'type'],
        ['getType', [1], 'type'], ['getIds', [], 'ids'],
        ['getScheduledIds', [], 'ids'], ['getTriggeredIds', [], 'ids'],
        ['getAll', [], 'notifications'], ['getScheduled', [], 'notifications'],
        ['getTriggered', [], 'notifications'], ['get', [1], 'notification'],
        ['get', [[1, 2]], 'notifications'],
        ['addActions', ['group', []], 'actions'], ['removeActions', ['group'], 'actions'],
        ['hasActions', ['group'], 'actions'],
        ['openNotificationSettings', [], 'openNotificationSettings'],
        ['openAlarmSettings', [], 'openAlarmSettings'], ['iOSClearBadge', [], 'clearBadge'],
        ['getUnusedAppRestrictionsStatus', [], 'getUnusedAppRestrictionsStatus'],
        ['openManageUnusedAppRestrictions', [], 'openManageUnusedAppRestrictions']
    ];
    for (const [method, args, action] of cases) {
        const { plugin, error } = loadPlugin(action);
        let count = 0;
        plugin[method](...args, failSuccess, function (value) {
            assert.equal(value, error, method);
            count++;
        });
        assert.equal(count, 1, method);
    }
});

test('schedule and update report native operation and permission-query errors', () => {
    for (const method of ['schedule', 'update']) {
        for (const skipPermission of [false, true]) {
            for (const failAction of skipPermission ? [method] : ['requestPermission', method]) {
                const { plugin, error } = loadPlugin(failAction);
                let count = 0;
                plugin[method]({ id: 1, trigger: { in: 1, unit: 'minute' } }, failSuccess,
                    function (value) {
                        assert.equal(value, error);
                        count++;
                    }, { skipPermission });
                assert.equal(count, 1, method + ': ' + failAction);
            }
        }
    }
});

test('permission denial keeps the existing success(false) behavior', () => {
    for (const method of ['schedule', 'update']) {
        const { plugin, calls } = loadPlugin(null, false);
        let called = false;
        plugin[method]({ id: 1 }, value => { assert.equal(value, false); called = true; },
            () => assert.fail('Permission denial is not a native exception'));
        assert.equal(called, true);
        assert.deepEqual(calls.map(call => call.action), ['requestPermission']);
    }
});

test('omitted error handlers log native failures once without calling success', () => {
    const { plugin, error, loggedErrors } = loadPlugin('createChannel');
    plugin.createChannel({}, failSuccess);
    assert.equal(loggedErrors.length, 1);
    assert.equal(loggedErrors[0][0], 'LocalNotification: createChannel failed');
    assert.equal(loggedErrors[0][1], error);
});

test('successful legacy calls retain callback scope and get(callback, scope) overload', () => {
    const { plugin } = loadPlugin(null);
    const scope = {};
    plugin.createChannel({}, function (value) { assert.equal(value, true); assert.equal(this, scope); }, scope);
    let called = false;
    plugin.get(function () { assert.equal(this, scope); called = true; }, scope);
    assert.equal(called, true);
});

test('get(callback, errorCallback) forwards native errors', () => {
    const { plugin, error } = loadPlugin('notifications');
    let received;
    plugin.get(failSuccess, value => { received = value; });
    assert.equal(received, error);
});

test('synchronous argument validation continues to throw TypeError', () => {
    const { plugin, calls } = loadPlugin('getChannel');
    assert.throws(() => plugin.getChannel('', failSuccess, failSuccess), { name: 'TypeError' });
    assert.deepEqual(calls, []);
});


test('legacy object scopes still bind success callbacks in schedule, update, and query wrappers', () => {
    for (const method of ['schedule', 'update', 'isPresent', 'isScheduled', 'isTriggered', 'hasType']) {
        const { plugin } = loadPlugin(null);
        const scope = {};
        let called = false;
        function success() { assert.equal(this, scope, method); called = true; }
        if (method === 'schedule' || method === 'update') {
            plugin[method]({ id: 1 }, success, scope, { skipPermission: true });
        } else if (method === 'hasType') {
            plugin.hasType(1, 'scheduled', success, scope);
        } else {
            plugin[method](1, success, scope);
        }
        assert.equal(called, true, method);
    }
});
