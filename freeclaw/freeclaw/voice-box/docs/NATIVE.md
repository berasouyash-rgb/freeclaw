# Voice Box on desktop + mobile

One codebase, three shells. Behavior is identical everywhere — only the
transport adapts (router type, API origin).

| Shell | How it runs | Your activity is stored… | API |
|---|---|---|---|
| Chrome / browser | `voice-box.vercel.app` | in this browser (localStorage) | same-origin `/api` |
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

1. Set three repo variables `VITE_API_BASE` (e.g. `https://voice-box.vercel.app`),
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
