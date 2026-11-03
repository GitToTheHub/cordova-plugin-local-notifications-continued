/*
 * Apache 2.0 License
 *
 * Copyright (c) Sebastian Katzer 2017
 * Copyright (c) Manuel Beck 2024
 *
 * This file contains Original Code and/or Modifications of Original Code
 * as defined in and that are subject to the Apache License
 * Version 2.0 (the 'License'). You may not use this file except in
 * compliance with the License. Please obtain a copy of the License at
 * http://opensource.org/licenses/Apache-2.0/ and read it before using this
 * file.
 *
 * The Original Code and all software distributed under the License are
 * distributed on an 'AS IS' basis, WITHOUT WARRANTY OF ANY KIND, EITHER
 * EXPRESS OR IMPLIED, AND APPLE HEREBY DISCLAIMS ALL SUCH WARRANTIES,
 * INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT OR NON-INFRINGEMENT.
 * Please see the License for the specific language governing rights and
 * limitations under the License.
 */

// codebeat:disable[TOO_MANY_FUNCTIONS]

package de.appplant.cordova.plugin.localnotification;

import android.app.NotificationChannel;
import android.app.NotificationChannelGroup;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.net.Uri;
import android.util.Log;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import static android.os.Build.VERSION.SDK_INT;
import static android.os.Build.VERSION_CODES.O;
import static android.os.Build.VERSION_CODES.P;

/** Android channel and channel-group operations, independent of Cordova callbacks. */
public final class LocalNotificationChannels {
    private static final String TAG = "LocalNotificationChannels";
    private final Context context;

    public LocalNotificationChannels(Context context) {
        this.context = context;
    }

    private NotificationChannel getNativeChannel(Options options) {
        // Channels are only supported since Android 8
        if (SDK_INT < O) return null;
        return NotificationManagerCompat.from(context).getNotificationChannel(options.getAndroidChannelId());
    }

    /**
     * Create Notification channel with options
     * @param options Set of channel options.
     *
     */
    public void create(Options options) {
        // Channels are only supported since Android 8
        if (SDK_INT < O) return;

        // Check if channel exists
        NotificationChannel channel = getNativeChannel(options);

        String groupId = options.getAndroidChannelGroupId();
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (groupId != null && manager.getNotificationChannelGroup(groupId) == null) {
            throw new IllegalArgumentException("Create the channel group before using it: " + groupId);
        }

        // Android permits assigning a previously ungrouped channel, but not moving it.
        if (channel != null) {
            if (channel.getGroup() == null && groupId != null) {
                channel.setGroup(groupId);
                manager.createNotificationChannel(channel);
            }
            return;
        }

        Log.d(TAG, "Create channel" +
            ", id=" + options.getAndroidChannelId() +
            ", name=" + options.getAndroidChannelName() +
            ", options=" + options);

        // Create new channel
        channel = new NotificationChannel(
            options.getAndroidChannelId(),
            options.getAndroidChannelName(), options.getAndroidChannelImportance());

        channel.setGroup(groupId);
        channel.setDescription(options.getAndroidChannelDescription());
        channel.enableVibration(options.isAndroidChannelEnableVibration());
        channel.enableLights(options.getAndroidChannelEnableLights());

        Uri soundUri = options.getSoundUri();
        Log.d(TAG, "sound uri: " + soundUri);

        // Grant permission to the system to play the sound, needed only in Android 8
        if (soundUri != Uri.EMPTY && SDK_INT < P) {
            Manager.grantUriPermission(context, soundUri);
        }

        // If options.getSoundUri() is Uri.EMPTY, an empty sound will be set, which means no sound
        channel.setSound(soundUri, new AudioAttributes.Builder().setUsage(options.getSoundUsage()).build());

        NotificationManagerCompat.from(context).createNotificationChannel(channel);
    }

    /**
     * Deletes a notification channel by an id. If you create a new channel with this same id,
     * the deleted channel will be un-deleted with all of the same settings it had before it was deleted.
     * @param channelId Like "my_channel_01"
     */
    public void delete(String channelId) {
        // Channels are supported since Android 8
        if (SDK_INT < O) return;

        Log.d(TAG, "Delete channel, id=" + channelId);

        // Cancel all notifications regarding this channel
        for (LocalNotificationRequest notification : new Manager(context).getNotificationsFromSharedPreferences()) {
            if (notification.getOptions().getAndroidChannelId().equals(channelId)) {
                notification.cancel();
            }
        }

        NotificationManagerCompat.from(context).deleteNotificationChannel(channelId);
    }

    /** Read current settings without creating a channel. */
    public JSONObject get(String channelId) throws JSONException {
        if (SDK_INT < O) return null;
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        NotificationChannel channel = manager.getNotificationChannel(channelId);
        if (channel == null) return null;

        boolean groupBlocked = false;
        if (SDK_INT >= P && channel.getGroup() != null) {
            NotificationChannelGroup group = manager.getNotificationChannelGroup(channel.getGroup());
            groupBlocked = group != null && group.isBlocked();
        }

        boolean blocked = channel.getImportance() == NotificationManager.IMPORTANCE_NONE;
        boolean appNotificationsEnabled = manager.areNotificationsEnabled();

        JSONObject result = new JSONObject();
        result.put("id", channel.getId());
        result.put("name", channel.getName().toString());
        result.put("description", channel.getDescription() == null ? JSONObject.NULL : channel.getDescription());
        result.put("importance", channel.getImportance());
        result.put("blocked", blocked);
        result.put("appNotificationsEnabled", appNotificationsEnabled);
        result.put("groupId", channel.getGroup() == null ? JSONObject.NULL : channel.getGroup());
        result.put("groupBlocked", groupBlocked);
        Uri sound = channel.getSound();
        result.put("sound", sound == null || Uri.EMPTY.equals(sound) ? JSONObject.NULL : sound.toString());
        result.put("vibration", channel.shouldVibrate());
        result.put("lights", channel.shouldShowLights());
        result.put("showBadge", channel.canShowBadge());
        return result;
    }

    /** Read current group settings without creating a group. */
    public JSONObject getGroup(String groupId) throws JSONException {
        if (SDK_INT < O) return null;
        NotificationChannelGroup group = NotificationManagerCompat.from(context).getNotificationChannelGroup(groupId);
        if (group == null) return null;
        JSONObject result = new JSONObject();
        result.put("id", group.getId());
        result.put("name", group.getName().toString());
        String description = SDK_INT >= P ? group.getDescription() : null;
        result.put("description", description == null ? JSONObject.NULL : description);
        result.put("blocked", SDK_INT >= P && group.isBlocked());
        JSONArray channelIds = new JSONArray();
        for (NotificationChannel channel : group.getChannels()) {
            channelIds.put(channel.getId());
        }
        result.put("channelIds", channelIds);
        return result;
    }

    /** Create or update a group while preserving Android's user-controlled blocked state. */
    public boolean createGroup(JSONObject options) {
        if (SDK_INT < O) return false;
        if (options == null || options.optString("id").isEmpty() || options.optString("name").isEmpty()) {
            throw new IllegalArgumentException("Channel group requires id and name");
        }
        NotificationChannelGroup group = new NotificationChannelGroup(options.optString("id"), options.optString("name"));
        if (SDK_INT >= P) group.setDescription(options.optString("description", null));
        NotificationManagerCompat.from(context).createNotificationChannelGroup(group);
        return true;
    }

    /** Deleting a group also deletes all channels belonging to it. */
    public boolean deleteGroup(String groupId) {
        if (SDK_INT < O) return false;
        NotificationManagerCompat.from(context).deleteNotificationChannelGroup(groupId);
        return true;
    }
}
