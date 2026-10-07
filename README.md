# TW2 Intel Android (experimental)

Experimental Android WebView wrapper for the TW2 Intel v1.6.0 dashboard.

## Build on GitHub from a phone
1. Create a new GitHub repository.
2. Upload the contents of this project to the repository root.
3. Open the repository's **Actions** tab.
4. Select **Build TW2 Intel APK**.
5. Tap **Run workflow**.
6. When the run finishes, open it and download the **TW2-Intel-debug-apk** artifact.
7. Extract the downloaded ZIP and install `app-debug.apk` on Android.

Android may ask you to allow installation of unknown apps for the browser/files app used to open the APK.

## First test
Open TW2 Intel, sign in to TW2, enter your world, and check whether the floating crossed-swords Intel button appears.

## Notes
- This does not replace or modify the official Tribal Wars 2 app.
- The embedded userscript is `app/src/main/assets/tw2-intel.js`.
- JavaScript is injected at document start when Android System WebView supports `DOCUMENT_START_SCRIPT`.
- This is an experimental test build. Do not remove the official TW2 app.
