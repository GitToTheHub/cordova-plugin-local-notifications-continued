const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

test('iOS native triggers and notification delegate ownership', { skip: process.platform !== 'darwin' }, (t) => {
    if (spawnSync('xcrun', ['--find', 'clang']).status !== 0) return t.skip('Xcode command line tools are required');
    const root = path.resolve(__dirname, '..');
    const ios = path.join(root, 'src/ios');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-notifications-ios-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const source = fs.readFileSync(path.join(ios, 'APPLocalNotification.m'), 'utf8');
    const methods = ['- (BOOL) isPluginNotification:',
        '- (void) userNotificationCenter:(UNUserNotificationCenter *)center\n        willPresentNotification:',
        '- (void) userNotificationCenter:(UNUserNotificationCenter *)center\n didReceiveNotificationResponse:'];
    const extracted = methods.map(signature => {
        const start = source.indexOf(signature);
        assert.notEqual(start, -1, `Missing production method: ${signature}`);
        const end = source.indexOf('\n}', start);
        assert.notEqual(end, -1);
        return source.slice(start, end + 2);
    });
    fs.writeFileSync(path.join(tmp, 'notification-delegates.inc'), extracted.join('\n\n'));
    // Location triggers are iOS-only. Keep all date/time methods unchanged while
    // replacing the untested location method for this macOS command-line probe.
    const optionsSource = fs.readFileSync(path.join(ios, 'APPNotificationOptions.m'), 'utf8');
    const regionStart = optionsSource.indexOf('- (UNLocationNotificationTrigger*) triggerWithRegion');
    assert.notEqual(regionStart, -1);
    const regionEnd = optionsSource.indexOf('\n}', regionStart) + 2;
    const hostOptions = optionsSource.slice(0, regionStart) +
        '- (UNNotificationTrigger*) triggerWithRegion { [NSException raise:NSInternalInconsistencyException format:@"Location is not part of this probe"]; return nil; }' +
        optionsSource.slice(regionEnd);
    fs.writeFileSync(path.join(tmp, 'APPNotificationOptions.m'), hostOptions);
    const binary = path.join(tmp, 'probe');
    const compile = spawnSync('xcrun', ['clang', '-fobjc-arc', '-fmodules',
        `-fmodules-cache-path=${path.join(tmp, 'modules')}`, '-framework', 'Foundation',
        '-framework', 'UserNotifications', '-framework', 'CoreLocation', '-I', ios, '-I', tmp,
        path.join(tmp, 'APPNotificationOptions.m'), path.join(ios, 'UNNotificationRequest+APPLocalNotification.m'),
        path.join(root, 'tests/ios/notification-delivery-probe.m'), '-o', binary], { encoding: 'utf8' });
    assert.equal(compile.status, 0, compile.stderr);
    const run = spawnSync(binary, [], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.match(run.stdout, /IOS_NOTIFICATION_DELIVERY_PASS/);
});
