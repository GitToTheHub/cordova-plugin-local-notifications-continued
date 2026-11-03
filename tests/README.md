# Tests

Run the JavaScript API tests with `npm test` (Node.js 18 or newer). They check native bridge arguments, callback scope, missing-channel results, unsupported platforms, and input validation.

## Android Integration Test

Install the current plugin in a disposable Cordova Android app and load `android/get-channel.js` from its HTML page after `cordova.js`. The script runs after `deviceready` and logs `GET_CHANNEL_NATIVE_ALL_PASS` when the checks pass. Read the output with `adb logcat -s chromium`.

Run on Android 8 or newer with notification permission granted. It checks that querying a missing channel does not create it, reads current settings, detects a blocked channel, handles a silent channel, and returns `null` after deletion. It creates channels with the `query_test_` prefix in the disposable app.

Then disable notifications for the test app and restart it. The script logs `GET_CHANNEL_NATIVE_PASS app-disabled` if app-level blocking is reported separately from channel blocking. Restore the permission after testing.

The integration script does not test blocked channel groups or the Android 7 fallback. Never run it in a production app.
