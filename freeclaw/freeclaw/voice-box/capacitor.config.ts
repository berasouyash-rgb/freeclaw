/**
 * Voice Flow — Capacitor config (Android mobile app).
 *
 * The same `dist/` web build ships inside the native WebView. Routing is
 * hash-based there (see src/App.tsx ShellRouter), so no server rewrites are
 * needed. localStorage persists in the app's on-device WebView data.
 * Native projects (android/) are generated in CI via `cap add` + `cap sync`
 * and are gitignored — this file is the only committed mobile config.
 * MANUAL NATIVE DELTAS (re-apply after any `cap add` regeneration):
 * - android/app/src/main/AndroidManifest.xml:
 *   android:allowBackup="false" — the anon identity must never roam via
 *   Google cloud backup; anonymity is the product promise.
 * - WebView third-party cookies are accepted by
 *   scripts/patch-android-webview-cookies.mjs, wired into native.yml
 *   between sync and build (NOT a manual edit — it runs every CI build).
 *
 * Structural type is declared locally (no @capacitor/cli import) so the
 * file typechecks even before mobile deps are installed.
 */
const config: {
	appId: string;
	appName: string;
	webDir: string;
	backgroundColor: string;
	android?: {
		backgroundColor: string;
	};
} = {
	appId: "app.voicebox",
	appName: "Voice Flow",
	webDir: "dist",
	backgroundColor: "#f6f6f9",
	android: {
		backgroundColor: "#f6f6f9",
	},
};

export default config;
