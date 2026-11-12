/*
 * Copyright (c) 2014-2015 by appPlant UG. All rights reserved.
 *
 * @APPPLANT_LICENSE_HEADER_START@
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
 *
 * @APPPLANT_LICENSE_HEADER_END@
 */

package de.appplant.cordova.plugin.localnotification.receiver;

import android.app.AlarmManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import androidx.core.app.NotificationManagerCompat;
import org.json.JSONObject;
import org.json.JSONException;

import de.appplant.cordova.plugin.localnotification.Manager;
import de.appplant.cordova.plugin.localnotification.LocalNotificationChannels;
import de.appplant.cordova.plugin.localnotification.LocalNotificationRequest;

/**
 * This class is triggered, when the system has cleared the alarms and notifications,
 * e.g. because of a device reboot, app update or granting the SCHEDULE_EXACT_ALARM permission.
 * Android invokes this manifest-registered receiver on the application's main thread,
 * even when no Activity is visible. It does not pass through Cordova's thread pool,
 * which handles plugin calls originating from JavaScript.
 *
 * Restore persisted requests on our own worker to keep preference reads/writes and
 * alarm scheduling off the main thread. goAsync() keeps the broadcast active after
 * onReceive() returns; it neither switches threads nor removes the broadcast timeout.
 * Keep the work bounded and finish the pending result when the worker completes.
 *
 * @see <a href="https://developer.android.com/reference/android/content/BroadcastReceiver#goAsync()">BroadcastReceiver.goAsync()</a>
 */
public class RestoreReceiver extends BroadcastReceiver {

    public static final String TAG = "RestoreReceiver";

    // Serialize restoration broadcasts so they cannot restore the same snapshot concurrently.
    private static final ExecutorService RESTORE_EXECUTOR = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                && !AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(action)) {
            return;
        }

        Log.d(TAG, "Received action: " + action);
        // Retain the broadcast result; the executor below performs the actual thread switch.
        PendingResult pendingResult = goAsync();
        Context appContext = context.getApplicationContext();
        RESTORE_EXECUTOR.execute(() -> {
            try {
                restore(appContext);
            } finally {
                // Release the broadcast even if restoration fails.
                pendingResult.finish();
            }
        });
    }

    /** Load saved requests, clean up unusable final occurrences, then restore the rest. */
    private void restore(Context context) {
        List<LocalNotificationRequest> notifications = new Manager(context).getNotificationsFromSharedPreferences();
        Log.d(TAG, "Restoring notifications, count: " + notifications.size());

        notifications = removeExpiredBlockedNotifications(context, notifications);
        restoreNotifications(notifications);
    }

    /** Complete the batched cleanup before schedule() writes any surviving requests back. */
    private List<LocalNotificationRequest> removeExpiredBlockedNotifications(
            Context context, List<LocalNotificationRequest> notifications) {
        LocalNotificationChannels channels = new LocalNotificationChannels(context);
        boolean appEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled();
        Map<String, Boolean> channelEnabled = new HashMap<>();
        SharedPreferences.Editor editor = Manager.getSharedPreferences(context).edit();
        List<LocalNotificationRequest> remaining = new ArrayList<>();
        Date now = new Date();

        for (LocalNotificationRequest notification : notifications) {
            try {
                if (isExpiredFinalOccurrence(notification, now)
                        && isBlockedBySettings(notification, appEnabled, channels, channelEnabled)) {
                    removeStoredNotification(editor, notification);
                    continue;
                }
            } catch (Exception e) {
                // If settings cannot be read, preserve the request rather than deleting it.
                Log.e(TAG, "Could not inspect restored notification, notificationId=" + notification.getId(), e);
            }
            remaining.add(notification);
        }

        if (remaining.size() < notifications.size()) editor.apply();
        Log.d(TAG, "Removed expired blocked notifications, count: "
            + (notifications.size() - remaining.size()));
        return remaining;
    }

    /** Future requests and requests with further occurrences must remain stored. */
    private boolean isExpiredFinalOccurrence(LocalNotificationRequest notification, Date now) {
        Date due = notification.getTriggerHandler().getTriggerDate();
        return due != null && !due.after(now) && notification.getTriggerHandler().isLastOccurrence();
    }

    /** Read app/channel/group blocking, querying each channel at most once per restore. */
    private boolean isBlockedBySettings(LocalNotificationRequest notification, boolean appEnabled,
            LocalNotificationChannels channels, Map<String, Boolean> channelEnabled) throws JSONException {
        if (!appEnabled) return true;

        String channelId = notification.getOptions().getAndroidChannelId();
        Boolean enabled = channelEnabled.get(channelId);
        if (enabled == null) {
            JSONObject channel = channels.get(channelId);
            // Missing channels can be recreated; Android 7 has no channels.
            enabled = channel == null || channel.getBoolean("enabled");
            channelEnabled.put(channelId, enabled);
        }
        return !enabled;
    }

    /** Queue all four lifecycle keys for removal; the caller applies the editor once. */
    private void removeStoredNotification(SharedPreferences.Editor editor, LocalNotificationRequest notification) {
        editor.remove(notification.getSharedPreferencesKeyOptions())
            .remove(notification.getSharedPreferencesKeyOccurrence())
            .remove(notification.getSharedPreferencesKeyTriggerBaseDate())
            .remove(notification.getSharedPreferencesKeyTriggerDate());
    }

    /** A failure restoring one request must not prevent restoration of the following ones. */
    private void restoreNotifications(List<LocalNotificationRequest> notifications) {
        for (LocalNotificationRequest notification : notifications) {
            try {
                notification.schedule();
            } catch (Exception e) {
                Log.e(TAG, "Could not restore notification, notificationId=" + notification.getId()
                    + ", channelId=" + notification.getOptions().getAndroidChannelId()
                    + ", groupId=" + notification.getOptions().getAndroidChannelGroupId(), e);
            }
        }
    }
}
