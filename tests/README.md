# Tests

Run the JavaScript API tests with `npm test` (Node.js 18 or newer). They check native bridge arguments, callback scope, missing-channel results, unsupported platforms, and input validation.

## Android Integration Test

Install the current plugin in a disposable Cordova Android app and load `android/get-channel.js` from its HTML page after `cordova.js`. The script runs after `deviceready` and logs `GET_CHANNEL_NATIVE_ALL_PASS` when the checks pass. Read the output with `adb logcat -s chromium`.

Run on Android 8 or newer with notification permission granted. It checks that querying a missing channel does not create it, reads current settings, detects a blocked channel, handles a silent channel, and returns `null` after deletion. It creates channels with the `query_test_` prefix in the disposable app.

Then disable notifications for the test app and restart it. The script logs `GET_CHANNEL_NATIVE_PASS app-disabled` if app-level blocking is reported separately from channel blocking. Restore the permission after testing.

The integration script does not test blocked channel groups or the Android 7 fallback. Never run it in a production app.

## Channel Group Integration Test

Load `android/channel-groups.js` in the disposable Cordova app instead of `android/get-channel.js`. On Android 8 or newer it checks group creation, queries, renaming, channel assignment, assigning an existing ungrouped channel without changing importance, preventing channel moves, and cascade deletion. Success logs `CHANNEL_GROUP_NATIVE_ALL_PASS`. It creates and deletes timestamped `group_test_` groups and channels. Group blocking through system settings requires a separate manual test on Android 9 or newer.

## Native Error Callback Integration Test

Load `android/error-callback.js` in the disposable Cordova app with notification permission granted. It deliberately references a missing group to verify the error callback for channel creation and scheduling (with and without the automatic permission check), the success/error callback argument order, and absence of failed notification/channel side effects. It also checks that an invalid alarm type reaches the error callback. Success logs `ERROR_CALLBACK_NATIVE_ALL_PASS`. It also invokes an operation without an error handler; verify the JavaScript console reports `LocalNotification: createChannel failed` and the app stays running.

## Existing Application Compatibility Check

The error-callback change was checked against the unchanged `NotificationPluginPromises` wrappers in the local Abfuhrkalender app. Android and iOS JavaScript bridge calls match plugin 1.2.3 except for plugin/version metadata. Legacy object scopes and denied-permission results remain supported.

A disposable copy of the app builds for Android with only its plugin dependency replaced. On an Android 16 emulator, the app initializes, its original permission and scheduling Promise wrappers resolve, the scheduled notification can be queried and canceled, and a missing channel group reaches the new native error callback.

This does not cover every app workflow or an iOS device run. A Promise wrapper that only supplies a success callback remains pending after a native error; the plugin logs the error but cannot reject a Promise it does not own.

## iOS Native Error Probe

`ios/error-callback-probe.m` is a test-only simulator library. It loads the real plugin class from a debug host app and substitutes only the notification center and command delegate. It checks asynchronous two-item scheduling, stopping a batch at its second failed request, updating an existing ID while skipping a missing ID, forwarding authorization errors, and an empty batch. Injected `NSError` values exercise callback behavior deterministically; they are not actual OS failures.

Build with the simulator SDK, ARC, Foundation, UIKit, UserNotifications, and the host Cordova include directory. Load it only into a disposable simulator app with `SIMCTL_CHILD_DYLD_INSERT_LIBRARIES` and `xcrun simctl launch --console`. Success logs `IOS_NATIVE_PROBE_ALL_PASS`. Never include this probe in a distributed app.

The Abfuhrkalender app copy builds for iOS Simulator and initializes on iOS 26.5 with the modified native plugin. The original app source remains unchanged.
