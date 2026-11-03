document.addEventListener('deviceready', async () => {
    const n = cordova.plugins.notification.local;
    const prefix = 'error_test_' + Date.now();
    function expectFailure(invoke, expectedMessage = prefix + '_missing') {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Native error callback did not run')), 5000);
            invoke(() => { clearTimeout(timeout); reject(new Error('Unexpected success callback')); }, function (error) {
                clearTimeout(timeout);
                if (typeof error !== 'string' || !error.includes(expectedMessage)) {
                    reject(new Error('Wrong error payload: ' + error));
                } else resolve();
            });
        });
    }
    try {
        await expectFailure((success, error) => n.createChannel({
            androidChannelId: prefix + '_channel', androidChannelGroupId: prefix + '_missing'
        }, success, error));
        console.log('ERROR_CALLBACK_NATIVE_PASS createChannel');
        for (const skipPermission of [true, false]) {
            await expectFailure((success, error) => n.schedule({
                id: 90001,
                androidChannelId: prefix + '_channel', androidChannelGroupId: prefix + '_missing',
                trigger: { in: 1, unit: 'minute' }
            }, success, error, { skipPermission }));
        }
        await expectFailure((success, error) => n.schedule({
            id: 90002,
            androidAlarmType: 99,
            trigger: { in: 1, unit: 'minute' }
        }, success, error, { skipPermission: true }), 'Invalid alarm type');
        await new Promise(resolve => n.cancel(90002, resolve));
        console.log('ERROR_CALLBACK_NATIVE_PASS invalid-alarm');
        const present = await new Promise(resolve => n.isPresent(90001, resolve));
        if (present) throw new Error('Failed notification was stored');
        const channel = await new Promise(resolve => n.getChannel(prefix + '_channel', resolve));
        if (channel !== null) throw new Error('Failed channel was created');
        // An omitted handler must log the error, without crashing or invoking success.
        n.createChannel({ androidChannelId: prefix + '_unhandled', androidChannelGroupId: prefix + '_missing' });
        console.log('ERROR_CALLBACK_NATIVE_ALL_PASS');
    } catch (error) {
        console.error('ERROR_CALLBACK_NATIVE_FAIL ' + error.stack);
    }
}, false);
