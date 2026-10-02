# Voice Flow on desktop + mobile

One codebase, three shells. Behavior is identical everywhere — only the
transport adapts (router type, API origin).

| Shell | How it runs | Your activity is stored… | API |
|---|---|---|---|
| Chrome / browser | `voice-box-psi.vercel.app` | in this browser (localStorage) | same-origin `/api` |
| Desktop app | Electron window (Windows installer) | on this computer, inside the app's on-device profile | `VITE_API_BASE` baked at build |
| Mobile app | Capacitor WebView (Android APK) | on this phone, inside the app's on-device data | `VITE_API_BASE` baked at build |

Details: `src/lib/platform.ts` (detection), `src/lib/api.ts` (base prefix),
`src/App.tsx` (hash routing in native shells).

## What the native shells are

- **Desktop** (`electron/`): loads `dist/index.html` over `file://` with a
  locked-down renderer (no Node, isolated context, per-user NSIS install —
  no admin rights needed). Single-instance: a second launch focuses the
  open window instead of forking a second profile.
- **Mobile** (`capacitor.config.ts`): the same `dist/` inside a native
  WebView. Native projects (`android/`, `ios/`) are generated, not
  committed — CI regenerates them on every native build.

## Building

Local builds need free disk and (for Android) Android Studio — neither is
assumed. The supported path is CI:

1. Set three repo variables `VITE_API_BASE` (e.g. `https://voice-box-psi.vercel.app`),
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (Settings → Secrets and variables →
   Actions → Variables — all three are public-by-design `VITE_` values, same as
   the browser build). Without them the shells build but boot into demo mode
   with honest empty states.
2. Actions → **Native** → Run workflow (or publish a release).
3. Download artifacts: `voice-box-desktop-win-x64` (.exe installer),
   `voice-box-android-debug` (.apk, debug-signed — fine for school sideload,
   not for Play Store).

Local (when disk allows): `npm ci`, `npm run icons`,
`VB_NATIVE_ELECTRON=1 npm run build` + `npx electron-builder --config
electron-builder.yml --win --publish never` for desktop;
`npx cap add android && npx cap sync android` then open in Android Studio
for mobile. `npm run desktop:start` runs the shell against `dist/`.
Set `VITE_API_BASE=https://voice-box-psi.vercel.app` in the same shell before the
local desktop build, or the app falls back to production automatically.

## "Failed to fetch" in the desktop app

The window loads (dist/index.html over file://) but every list is empty and
the console shows `TypeError: Failed to fetch`. That always means the app has
no working API origin — the build went out without `VITE_API_BASE` baked in,
or the API is refusing the shell's origin. Check in order:

1. `VITE_API_BASE` was set when the EXE/APK was built (repo Variables for CI,
   shell env for local builds). Native shells fall back to
   `https://voice-box-psi.vercel.app` when it is missing, so an old broken build
   just needs reinstalling from a fixed artifact.
2. The API allows the shell: Electron sends `Origin: null`, Capacitor sends
   `https://localhost` (v7 default scheme; legacy `capacitor://localhost` and
   `ionic://localhost` stay allowlisted too) — all covered in `api/_auth.js cors()`.
3. No action needed for cookies: the client sends `credentials: include` and
   the server mints `SameSite=None; Secure` cookies for these origins.

## In-app updates (APK + EXE)

Both shells check `GET /api/version` at most once a day and show an
"Update detected — Update now / Later" dialog when a newer build exists
(`src/lib/appUpdate.ts` + `UpdateDialog`, wired in `Layout`). Web browsers
update on reload and never see it.

To publish a release:

1. Bump `version` in `package.json` (e.g. `2.1.0`) and build the artifacts
   (CI **Native** workflow, or local `build-desktop-local.bat` / Gradle).
2. Upload the `.apk` and `.exe` somewhere reachable over https (e.g. a
   GitHub Release on the fork).
3. Set four Vercel env vars on the production project and redeploy:
   `LATEST_APK_VERSION` + `LATEST_APK_URL` (APK), `LATEST_EXE_VERSION` +
   `LATEST_EXE_URL` (EXE). Optional `LATEST_APK_NOTES` / `LATEST_EXE_NOTES`
   (≤500 chars, shown in the dialog).
4. Unset (or leave unset) a platform to stop offering it — the client
   treats a missing entry as up-to-date, never as an error.

`Later` snoozes 24h per device. A failed check is silent by design.

## Honest limitations

- Native shells have no Vercel security headers (no server in front) — they
  talk only to the pinned `VITE_API_BASE` origin over https.
- No push notifications — the in-app Alerts page + badges are the
  notification surface on all shells.
- First launch after backend idle can be slow (cold start); the app says so
  instead of hanging.
- Admin console works in the apps exactly as on web (same code, same RLS).
- Debug APK is sideload-only. Play Store needs a release-signed AAB — a
  separate step with its own keystore, not included here.
