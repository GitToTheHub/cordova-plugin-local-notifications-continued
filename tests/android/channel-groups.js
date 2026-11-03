document.addEventListener('deviceready', async () => {
    const n = cordova.plugins.notification.local;
    const createGroup = options => new Promise(resolve => n.createChannelGroup(options, resolve));
    const getGroup = id => new Promise(resolve => n.getChannelGroup(id, resolve));
    const deleteGroup = id => new Promise(resolve => n.deleteChannelGroup(id, resolve));
    const createChannel = options => new Promise(resolve => n.createChannel(options, resolve));
    const getChannel = id => new Promise(resolve => n.getChannel(id, resolve));
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const prefix = 'group_test_' + Date.now();
    const groupId = prefix + '_group';
    const channelId = prefix + '_channel';
    try {
        check(await getGroup(groupId) === null, 'missing group must return null');
        check(await getGroup(groupId) === null, 'query must not create a group');
        check(await createGroup({ id: groupId, name: 'Test group', description: 'Group description' }) === true, 'group not created');
        const group = await getGroup(groupId);
        check(group.id === groupId && group.name === 'Test group', 'wrong group identity');
        check(group.description === (parseInt(device.version, 10) >= 9 ? 'Group description' : null), 'wrong version-dependent description');
        check(group.blocked === false && group.channelIds.length === 0, 'wrong initial group state');
        await createChannel({ androidChannelId: channelId, androidChannelName: 'Grouped reminders', androidChannelGroupId: groupId });
        let channel = await getChannel(channelId);
        check(channel.groupId === groupId && channel.groupBlocked === false, 'channel not assigned to group');
        check((await getGroup(groupId)).channelIds.includes(channelId), 'group missing its channel');
        await createGroup({ id: groupId, name: 'Renamed group', description: 'New description' });
        const renamed = await getGroup(groupId);
        check(renamed.name === 'Renamed group', 'group name not updated');
        check(renamed.description === (parseInt(device.version, 10) >= 9 ? 'New description' : null), 'description not updated');
        check((await getGroup(groupId)).channelIds.includes(channelId), 'updating group lost channels');
        const ungroupedId = prefix + '_ungrouped';
        await createChannel({ androidChannelId: ungroupedId, androidChannelImportance: 'IMPORTANCE_LOW' });
        await createChannel({ androidChannelId: ungroupedId, androidChannelGroupId: groupId });
        channel = await getChannel(ungroupedId);
        check(channel.groupId === groupId && channel.importance === 2, 'group assignment changed existing importance');
        const secondGroupId = prefix + '_second';
        await createGroup({ id: secondGroupId, name: 'Second group' });
        await createChannel({ androidChannelId: channelId, androidChannelGroupId: secondGroupId });
        check((await getChannel(channelId)).groupId === groupId, 'existing channel moved between groups');
        await deleteGroup(secondGroupId);
        check(await deleteGroup(groupId) === true, 'group deletion failed');
        check(await getGroup(groupId) === null, 'deleted group still exists');
        check(await getChannel(channelId) === null && await getChannel(ungroupedId) === null, 'group deletion did not delete channels');
        check(await deleteGroup(groupId) === true, 'deleting missing group should be harmless');
        console.log('CHANNEL_GROUP_NATIVE_ALL_PASS');
    } catch (error) {
        console.error('CHANNEL_GROUP_NATIVE_FAIL ' + error.stack);
    }
}, false);
