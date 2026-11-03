document.addEventListener('deviceready', async () => {
    const n = cordova.plugins.notification.local;
    const query = id => new Promise(resolve => n.getChannel(id, resolve));
    const create = options => new Promise(resolve => n.createChannel(options, resolve));
    const remove = id => new Promise(resolve => n.deleteChannel(id, resolve));
    const check = (value, message) => { if (!value) throw new Error(message); };
    try {
        if (!(await new Promise(resolve => n.hasPermission(resolve)))) {
            const channel = await query('query_test_default');
            check(channel.appNotificationsEnabled === false, 'app-level blocking not reflected');
            check(channel.blocked === false, 'app blocking must not change channel blocking');
            console.log('GET_CHANNEL_NATIVE_PASS app-disabled');
            return;
        }
        const missingId = 'query_missing_' + Date.now();
        check(await query(missingId) === null, 'missing channel should return null');
        check(await query(missingId) === null, 'query must not create a missing channel');
        console.log('GET_CHANNEL_NATIVE_PASS missing-no-side-effects');
        await create({androidChannelId: 'query_test_default', androidChannelName: 'Query test', androidChannelImportance: 'IMPORTANCE_DEFAULT', sound: null});
        const channel = await query('query_test_default');
        check(channel.id === 'query_test_default', 'wrong ID');
        check(channel.importance === 3 && channel.blocked === false, 'wrong default state');
        check(typeof channel.sound === 'string', 'default sound should return its system URI');
        check(channel.description === null || typeof channel.description === 'string', 'invalid description');
        check(channel.groupId === null && channel.groupBlocked === false, 'wrong group state');
        check(typeof channel.appNotificationsEnabled === 'boolean', 'missing app status');
        check(typeof channel.vibration === 'boolean' && typeof channel.lights === 'boolean' && typeof channel.showBadge === 'boolean', 'missing settings');
        console.log('GET_CHANNEL_NATIVE_PASS existing-settings ' + JSON.stringify(channel));
        await create({androidChannelId: 'query_test_blocked', androidChannelName: 'Blocked test', androidChannelImportance: 'IMPORTANCE_NONE'});
        const blocked = await query('query_test_blocked');
        check(blocked.importance === 0 && blocked.blocked === true, 'blocked channel not detected');
        console.log('GET_CHANNEL_NATIVE_PASS blocked');
        await create({androidChannelId: 'query_test_silent', androidChannelName: 'Silent test', sound: ''});
        check((await query('query_test_silent')).sound === null, 'silent channel should return null sound');
        console.log('GET_CHANNEL_NATIVE_PASS silent');
        await remove('query_test_deleted');
        await create({androidChannelId: 'query_test_deleted', androidChannelName: 'Deleted test'});
        await remove('query_test_deleted');
        check(await query('query_test_deleted') === null, 'deleted channel should return null');
        console.log('GET_CHANNEL_NATIVE_PASS deleted');
        console.log('GET_CHANNEL_NATIVE_ALL_PASS');
    } catch (error) {
        console.error('GET_CHANNEL_NATIVE_FAIL ' + error.stack);
    }
}, false);
