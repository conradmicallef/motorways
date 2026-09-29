# Mini Roads

A Mini Motorways-style game: draw roads, connect houses to same-coloured destinations, avoid overflow.
Plain-JS canvas PWA, wrapped with Capacitor for Android and iOS. GitHub: `conradmicallef/motorways` (public, branch `main`).

## Layout
- `pwa/` - the whole game. No build step, no dependencies.
  - `game.js` - all game logic, rendering and input (one IIFE). Tuning constants are at the top (`PIN_CAP`, `OVERFLOW_LIMIT`, `WEEK_LEN`, `CAR_SPEED`); demand/spawn pacing is in `update()`.
  - `index.html` - HUD, overlays, styles. `sw.js` - offline cache. `manifest.webmanifest`, `icons/`.
- `native/` - Capacitor 7 project. `webDir` is `../pwa`, so native builds always package the current `pwa/` code (no copy step).
  - `android/`, `ios/` generated projects; `scripts/generate-icons.py` rebuilds native icons/splash from `pwa/icons`.
- `.github/workflows/` - `android.yml` (debug APK, artifact), `ios.yml` (unsigned simulator build), `testflight.yml` (signed IPA -> TestFlight).

## Run locally
`cd pwa && python -m http.server 8080` then open http://localhost:8080. Service workers need http(s), not `file://`.

## Gotchas
- **Service worker cache:** it is cache-first. When changing any file in `pwa/`, bump `CACHE` in `sw.js` (currently `mini-roads-v4`), and hard-reload or unregister the SW when testing.
- **Native ignores the SW:** `index.html` skips registration when `window.Capacitor.isNativePlatform()`.
- **Bundle ID is `com.conradmicallef.motorways`** (matches the App Store Connect app "My Motorways"). It appears in `native/capacitor.config.json`, Android `applicationId`/namespace/package dir, and iOS `PRODUCT_BUNDLE_IDENTIFIER`. Change all together. `app.conradmicallef.motorways` was tried and is wrong.
- **Line endings:** `.gitattributes` forces LF. Windows CRLF breaks `gradlew` on the Linux runner.
- **Input model:** roads are an edge graph (`S.adj`), not cell fills. One finger draws; two fingers pinch-zoom/pan (`zoomAt`, `clampView`); wheel zooms on desktop; `cs/ox/oy` are the live (zoomed) layout, `bcs/box/boy` the fit layout.

## CI / releases
- Push to `main` touching `pwa/**` or `native/**` builds Android and iOS automatically.
- **Android** needs JDK 21 (Capacitor 7). Debug APK is uploaded as an artifact. A signed AAB is only built if the `ANDROID_KEYSTORE_*` secrets exist.
- **TestFlight:** run "iOS TestFlight" from the Actions tab (workflow_dispatch) or push a `v*` tag. The archive is built unsigned, then exported and signed by Xcode via the App Store Connect API key (automatic signing; a dev profile is not possible as the account has no registered devices). Build number = the run number.
- Repo secrets used: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (raw .p8 contents), `IOS_TEAM_ID`.
- iOS deployment target is 15.0; `ITSAppUsesNonExemptEncryption` is false in `Info.plist`.
- Never commit `.p8`, `.p12`, keystores or provisioning profiles (they are in `.gitignore`).
