const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { syncVersion } = require('../scripts/sync-version');

const root = path.resolve(__dirname, '..');

test('all shipped version fields match package.json', () => {
    syncVersion(root, true);
});

test('version synchronization handles releases and development versions without changing migrations', (t) => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'local-notifications-version-'));
    t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
    const files = ['package.json', 'package-lock.json', 'plugin.xml', 'www/local-notification.js', 'src/android/Options.java'];
    for (const name of files) {
        fs.mkdirSync(path.dirname(path.join(fixture, name)), { recursive: true });
        fs.copyFileSync(path.join(root, name), path.join(fixture, name));
    }
    const originalJava = fs.readFileSync(path.join(root, 'src/android/Options.java'), 'utf8');
    for (const version of ['2.0.0', '2.0.1-dev']) {
        const pkg = JSON.parse(fs.readFileSync(path.join(fixture, 'package.json'), 'utf8'));
        pkg.version = version;
        fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify(pkg));
        assert.throws(() => syncVersion(fixture, true), /Versions differ/);
        syncVersion(fixture);
        syncVersion(fixture, true);
        const java = fs.readFileSync(path.join(fixture, 'src/android/Options.java'), 'utf8');
        assert.ok(java.includes(`PLUGIN_VERSION = "${version}"`));
        assert.equal(java.replace(version, 'VERSION'), originalJava.replace(/String PLUGIN_VERSION = "[^"]+"/, 'String PLUGIN_VERSION = "VERSION"'));
    }
    // A missing version field must fail rather than silently leave stale metadata.
    fs.writeFileSync(path.join(fixture, 'plugin.xml'), '<plugin/>');
    assert.throws(() => syncVersion(fixture), /Version field not found/);
});
