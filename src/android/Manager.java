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

import android.annotation.SuppressLint;
import android.app.AlarmManager;
import androidx.core.app.NotificationManagerCompat;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.service.notification.StatusBarNotification;
import android.net.Uri;
import android.util.Log;
import android.os.PowerManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Random;
import java.util.Set;

import static android.os.Build.VERSION.SDK_INT;
import static android.os.Build.VERSION_CODES.S;
import static de.appplant.cordova.plugin.localnotification.LocalNotificationRequest.Type.TRIGGERED;
import de.appplant.cordova.plugin.localnotification.util.AssetUtil;

/**
 * Central way to access all or single local notifications set by specific
 * state like triggered or scheduled. Offers shortcut ways to schedule,
 * cancel or clear local notifications.
 */
public final class Manager {
    // Key for shared preferences
    static final String PREF_KEY_ID = "NOTIFICATION_ID";

    public static final String TAG = "Manager";
    
    private Context context;

    private static final Random randomGenerator = new Random();

    public Manager(Context context) {
        this.context = context;
    }

    /**
     * Check if the setting to schedule exact alarms is enabled.
     */
    public static boolean canScheduleExactAlarms(Context context) {
        // Supported since Android 12
        if (SDK_INT < S) return true;
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return alarmManager.canScheduleExactAlarms();
    }

    /**
     * Update local notification specified by ID.
     * @param notificationId The ID of the notification.
     * @param updates JSON object with notification options.
     */
    public LocalNotificationRequest update(int notificationId, JSONObject updates) {
        LocalNotificationRequest notification = LocalNotificationRequest.getFromSharedPreferences(context, notificationId);
        if (notification == null) return null;

        notification.update(updates);

        return notification;
    }

    /**
     * Clear all local notifications.
     */
    public void clearAll() {
        for (LocalNotificationRequest notification : getByType(TRIGGERED)) {
            notification.clear();
        }

        NotificationManagerCompat.from(context).cancelAll();
    }

    /**
     * Cancel all local notifications.
     */
    public void cancelAll() {
        for (LocalNotificationRequest notification : getNotificationsFromSharedPreferences()) {
            notification.cancel();
        }

        NotificationManagerCompat.from(context).cancelAll();
    }

    /**
     * Get saved notification ids
     */
    public List<Integer> getNotificationIds() {
        List<Integer> notificationIds = new ArrayList<Integer>();

        // Options are stored by the notification id in the shared preferences
        for (String key : getSharedPreferences().getAll().keySet()) {
            // Skip keys with underscore for e.g. _occurrence
            if (key.contains("_")) continue;

            try {
                notificationIds.add(Integer.parseInt(key));
            } catch (NumberFormatException exception) {
                exception.printStackTrace();
            }
        }

        return notificationIds;
    }

    /**
     * Get saved notification ids for a given type.
     * @param type The notification life cycle type
     */
    public List<Integer> getNotificationIdsByType(LocalNotificationRequest.Type type) {
        // Returns triggered and scheduled notifications
        if (type == LocalNotificationRequest.Type.ALL) return getNotificationIds();

        List<Integer> activeIds = new ArrayList<Integer>();

        for (StatusBarNotification statusBarNotification : getActiveNotifications()) {
            activeIds.add(statusBarNotification.getId());
        }

        if (type == TRIGGERED) return activeIds;

        // Return scheduled notifications
        List<Integer> notificationIds = getNotificationIds();
        // Remove triggered notifications
        notificationIds.removeAll(activeIds);

        return notificationIds;
    }

    /**
     * List of all local notification.
     */
    public List<LocalNotificationRequest> getNotificationsFromSharedPreferences() {
        return getNotificationsFromSharedPreferences(getNotificationIds());
    }

    /**
     * List of local notifications with matching ID.
     */
    public List<LocalNotificationRequest> getNotificationsFromSharedPreferences(List<Integer> notificationIds) {
        List<LocalNotificationRequest> notifications = new ArrayList<LocalNotificationRequest>();

        for (int notificationId : notificationIds) {
            LocalNotificationRequest notification = LocalNotificationRequest.getFromSharedPreferences(context, notificationId);
            if (notification != null) notifications.add(notification);
        }

        return notifications;
    }

    /**
     * List of local notifications from given type.
     *
     * @param type The notification life cycle type
     */
    public List<LocalNotificationRequest> getByType(LocalNotificationRequest.Type type) {
        return type == LocalNotificationRequest.Type.ALL ? getNotificationsFromSharedPreferences() : getNotificationsFromSharedPreferences(getNotificationIdsByType(type));
    }

    /**
     * Returns the active status bar notification with the specified notificationId.
     * If there is no active status bar notification, null will be returned.
     * @param notificationId
     */
    StatusBarNotification getActiveNotification(int notificationId) {
        for (StatusBarNotification statusBarNotification : getActiveNotifications()) {
            if (statusBarNotification.getId() == notificationId) {
                return statusBarNotification;
            }
        }

        return null;
    }

    public SharedPreferences getSharedPreferences() {
        return getSharedPreferences(context);
    }

    /**
     * Shared private preferences for the application.
     */
    public static SharedPreferences getSharedPreferences(Context context) {
        return context.getSharedPreferences(PREF_KEY_ID, Context.MODE_PRIVATE);
    }

    /**
     * Get all active status bar notifications.
     */
    public List<StatusBarNotification> getActiveNotifications() {
        return NotificationManagerCompat.from(context).getActiveNotifications();
    }

    /**
     * Wake up the screen and returns a WakeLock, which have to be release, after the work is done.
     * @return WakeLock, which have to be release, after the work is done.
     */
    public static PowerManager.WakeLock wakeUpScreen(Context context) {
        PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wakeLook = powerManager.newWakeLock(
            PowerManager.SCREEN_DIM_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "LocalNotification");
        wakeLook.acquire();
        return wakeLook;
    }

    /**
     * In Android 7 and 8, the app will crash if an external process has no
     * permission to access content:// Uris, which are used for shared files in [App path]/files/shared_files.
     * This was fixed in Android 9.
     * See: https://stackoverflow.com/questions/39359465/android-7-0-notification-sound-from-file-provider-uri-not-playing
     */
    public static void grantUriPermission(Context context, Uri uri) {
        context.grantUriPermission("com.android.systemui", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
    }

    /**
     * Gets a random request code between 1 and Integer.MAX_VALUE.
     */
    public static int getRandomRequestCode() {
        return randomGenerator.nextInt(Integer.MAX_VALUE) + 1;
    }
}