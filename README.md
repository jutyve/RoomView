# RoomView Android

This is the Android/Capacitor adaptation of the supplied RoomView project.

## What this build does

- Runs as an installed Android application.
- Bundles Three.js locally; the viewer does not need a CDN or internet connection.
- Uses the Android WebView's secure `https://localhost` app origin for device-orientation events.
- Opens 360-degree panorama images from the phone.
- Saves selected panorama images in IndexedDB so they remain available offline.
- Supports touch drag, motion controls, reset, zoom, and the existing side-by-side VR presentation.

## Current limitation

The supplied project stitches photos through a Python FastAPI endpoint using OpenCV. That server is not part of an offline APK, so this first Android build does not stitch ordinary photos on-device. It opens already-stitched 360-degree panorama images. The stitching feature needs a separate native Android implementation before it can work fully offline.

## Build on Windows

Install:

1. Node.js 22 or newer: https://nodejs.org/
2. Android Studio: https://developer.android.com/studio
3. In Android Studio > SDK Manager, install an Android SDK Platform (API 24 or newer) and Android SDK Build-Tools.

Then open PowerShell in this project folder and run:

```powershell
npm install
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

In Android Studio:

1. Wait for Gradle sync to finish.
2. Select **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
3. When it finishes, click **locate** in the notification. The APK is normally at `android/app/build/outputs/apk/debug/app-debug.apk`.
4. Transfer that APK to your Android phone and install it. If Android asks, allow installation from the file manager you used.

For later web-code changes, run:

```powershell
npm run build
npx cap sync android
```

Then rebuild the APK in Android Studio.

## Motion control

Open a panorama, tap **Enable motion**, then move the phone. On Android, no iOS-style permission prompt is expected. If motion does not respond, check that the device has motion sensors and that Android's auto-rotate is not disabled, then restart the app.

## Panorama image format

A full 360-degree equirectangular panorama is normally 2:1 (for example, 4000 x 2000 pixels). A normal camera photo is not a 360-degree panorama.
