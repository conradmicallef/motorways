# Mini Roads - native wrapper (Capacitor 7)

App ID `com.conradmicallef.motorways`, name "Mini Roads". The web app is **not copied**: `capacitor.config.json` points `webDir` at `../pwa`, and `npx cap sync` copies it into the native projects. Edit `pwa/`, then sync.

Capacitor 7 requires JDK 21 to compile the Android project (JDK 17 fails with "invalid source release: 21"). Install a JDK 21 and point JAVA_HOME at it.

## Setup (once)
```
cd native
npm install
```
Requires Node 20+, JDK 21 (`JAVA_HOME`), Android SDK (`ANDROID_HOME`, platform 35/36 + build-tools).

## npm scripts
| Script | What it does |
|---|---|
| `npm run sync` | `cap sync`: copy `../pwa` into android + ios, update plugins |
| `npm run build:android` | sync + `gradlew assembleDebug` -> `android/app/build/outputs/apk/debug/app-debug.apk` |
| `npm run build:android:release` | sync + `gradlew bundleRelease` (unsigned AAB, see below) |
| `npm run android` | sync and open in Android Studio |
| `npm run ios` | sync and open Xcode (Mac only) |

## Android
- Debug APK: `npm run build:android`, then `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.
- Run from Android Studio: `npm run android`, press Run.
- Release (Play Store AAB): create a keystore (`keytool -genkeypair -v -keystore mini-roads.jks -alias miniroads -keyalg RSA -keysize 2048 -validity 10000`), add a `signingConfigs.release` block in `android/app/build.gradle` (or use Android Studio: Build > Generate Signed Bundle), then `npm run build:android:release`; output is `android/app/build/outputs/bundle/release/app-release.aab`. Bump `versionCode`/`versionName` in `android/app/build.gradle` for each upload. Keep the keystore and passwords out of the repo.

## iOS (needs a Mac with Xcode; cannot be built on Windows)
1. On the Mac: `cd native && npm install && npx cap sync ios` (needs CocoaPods: `sudo gem install cocoapods` or `brew install cocoapods`; sync runs `pod install`).
2. `open ios/App/App.xcworkspace` (always the workspace, not the .xcodeproj).
3. Select the `App` target > Signing & Capabilities > pick your Team; bundle ID is `com.conradmicallef.motorways`.
4. Choose a device/simulator and press Run.
5. App Store: set the version/build, choose "Any iOS Device", Product > Archive, then Distribute App > App Store Connect (needs an Apple Developer account and an app record with this bundle ID).

## Native behaviour / customisation
- Orientation: all allowed (Android default; iOS portrait + both landscapes, all four on iPad).
- Background/splash: solid `#efe8d8`. Status bar: overlays the web view, light style, so the page's `env(safe-area-inset-*)` handling applies.
- Zoom/overscroll: prevented by the viewport meta and `overscroll-behavior:none` already in `pwa/index.html`.
- Service worker: `pwa/index.html` skips registration when running inside Capacitor (assets are bundled, so it isn't needed). Browser/PWA behaviour is unchanged.
- Icons/splash: `python scripts/generate-icons.py` (needs Pillow) regenerates Android mipmaps (adaptive icon, foreground = `icon-maskable-512.png` on `#f3ecdc`) and the iOS 1024x1024 opaque AppIcon and splash from `../pwa/icons`. Run `npm run sync` afterwards. Source is 512px, so the 1024 iOS icon is upscaled; replace it with a native 1024 render if you want it crisper.
