const fs = require('node:fs');
const path = require('node:path');

// package.json is the version source. Keep migration thresholds unchanged.
function syncVersion(root, check = false) {
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
        throw new Error(`Invalid plugin version: ${version}`);
    }

    const replacements = [
        ['plugin.xml', /(<plugin\b[^>]*\bversion=")[^"]+("[^>]*>)/],
        ['www/local-notification.js', /(version: ')[^']+(' \/\/ Current plugin version)/],
        ['src/android/Options.java', /(String PLUGIN_VERSION = ")[^"]+(";)/]
    ];
    const updates = replacements.map(([name, pattern]) => {
        const file = path.join(root, name);
        const content = fs.readFileSync(file, 'utf8');
        if (!pattern.test(content)) throw new Error(`Version field not found in ${name}`);
        return [file, content, content.replace(pattern, (_, before, after) => before + version + after)];
    });

    const lockFile = path.join(root, 'package-lock.json');
    const lockContent = fs.readFileSync(lockFile, 'utf8');
    const lock = JSON.parse(lockContent);
    lock.version = version;
    lock.packages[''].version = version;
    updates.push([lockFile, lockContent, JSON.stringify(lock, null, 2) + '\n']);

    const changed = updates.filter(([, before, after]) => before !== after);
    if (check && changed.length) {
        throw new Error(`Versions differ from package.json (${version}): ${changed.map(([file]) => path.relative(root, file)).join(', ')}. Run node scripts/sync-version.js.`);
    }
    if (!check) for (const [file, , content] of changed) fs.writeFileSync(file, content);
}

if (require.main === module) {
    syncVersion(path.resolve(__dirname, '..'), process.argv.includes('--check'));
}

module.exports = { syncVersion };
