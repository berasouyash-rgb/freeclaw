#!/usr/bin/env node
/**
 * Voice Flow — one-command native release (APK + Windows EXE).
 *
 * WHY THIS EXISTS
 * The three shells share one codebase, but only the web shell updates itself
 * (Vercel redeploys on push). The APK and the EXE are *packages*: they embed a
 * snapshot of `dist/` taken at build time. Nothing used to enforce that the
 * snapshot was current, so the reported failure was real and silent —
 * `Voice-Box-Android.apk` on disk was packaged from an older `dist/` than the
 * live web build, and the student kept installing a version of the app that
 * did not have the features the website did. Two things caused it:
 *
 *   1. build order — the APK was assembled before the web bundle it ships was
 *      rebuilt, so it captured the previous chunk hashes;
 *   2. publishing — even a correct build was copied to the repository root by
 *      hand, so the "download" copy drifted from the build output.
 *
 * This script makes both impossible to get wrong:
 *
 *   • it always rebuilds `dist/` first, for the shell being packaged;
 *   • it always packages from that exact build (cap sync / electron-builder);
 *   • it VERIFIES the finished artifact really contains the new chunk names,
 *     and fails loudly if it does not;
 *   • it publishes with stable filenames (a hand copy cannot drift), and
 *     writes the release manifest `/api/version` reads.
 *
 * USAGE
 *   node scripts/release-native.mjs            # both shells
 *   node scripts/release-native.mjs --desktop  # Windows EXE only
 *   node scripts/release-native.mjs --android  # APK only
 *   node scripts/release-native.mjs --no-restore-web
 *
 * Flags:
 *   --android / --desktop  restrict to one shell (default: both)
 *   --no-restore-web       skip the trailing web build that leaves `dist/` in
 *                          its browser (absolute-base) form. The native builds
 *                          overwrite `dist/`, so this is on by default: it
 *                          keeps a locally-served `dist/` correct.
 */

import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = process.platform === "win32";

// Production origin both shells talk to. Everything the native apps call is
// absolute, so a wrong value here ships an app that cannot reach its API.
const PRODUCTION_ORIGIN = "https://voice-box-psi.vercel.app";

const args = new Set(process.argv.slice(2));
const wantAndroid = args.has("--android") || !args.has("--desktop");
const wantDesktop = args.has("--desktop") || !args.has("--android");
const restoreWeb = !args.has("--no-restore-web");

// ── output ──────────────────────────────────────────────────────────
const step = (msg) => console.log(`\n\x1b[36m▸ ${msg}\x1b[0m`);
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const warn = (msg) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);
const fail = (msg) => {
	console.error(`\n\x1b[31m✗ ${msg}\x1b[0m\n`);
	process.exit(1);
};

// ── shell execution ─────────────────────────────────────────────────
function run(command, argv, { cwd = ROOT, env = {}, label } = {}) {
	const display = [command, ...argv].join(" ");
	console.log(`  $ ${label || display}`);
	// Windows needs a shell to run .cmd/.bat shims (npm, npx, gradlew), but a
	// shell splits an unquoted absolute path on its spaces — `C:\Program
	// Files\nodejs\node.exe` becomes the command `C:\Program`. Quote it.
	const target = IS_WIN && /\s/.test(command) ? `"${command}"` : command;
	const res = spawnSync(target, argv, {
		cwd,
		stdio: "inherit",
		shell: IS_WIN,
		env: { ...process.env, ...env },
	});
	if (res.error) fail(`${display}\n  ${res.error.message}`);
	if (res.status !== 0) fail(`${display}\n  exited with code ${res.status}`);
}

/** Java is required by Gradle and is frequently not on PATH on Windows. */
function javaHome() {
	if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) {
		return process.env.JAVA_HOME;
	}
	for (const candidate of ["D:/jdk21", "D:/jdk17", "C:/Program Files/Java/latest"]) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

// ── tiny ZIP reader (APK verification) ──────────────────────────────
// An APK is a ZIP. We only need entry NAMES, so read the central directory
// rather than pulling a dependency in for one check.
function listZipEntries(file) {
	const buf = readFileSync(file);
	// End of central directory: scan backwards for the signature.
	let eocd = -1;
	for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) return [];
	const count = buf.readUInt16LE(eocd + 10);
	let offset = buf.readUInt32LE(eocd + 16);
	const names = [];
	for (let n = 0; n < count; n++) {
		if (buf.readUInt32LE(offset) !== 0x02014b50) break;
		const nameLen = buf.readUInt16LE(offset + 28);
		const extraLen = buf.readUInt16LE(offset + 30);
		const commentLen = buf.readUInt16LE(offset + 32);
		names.push(buf.toString("utf8", offset + 46, offset + 46 + nameLen));
		offset += 46 + nameLen + extraLen + commentLen;
	}
	return names;
}

/** The hashed entry chunks referenced by a built index.html. */
function chunksOf(indexHtmlPath) {
	const html = readFileSync(indexHtmlPath, "utf8");
	const found = new Set();
	for (const m of html.matchAll(/assets\/([\w.-]+\.js)/g)) found.add(m[1]);
	return found;
}

/**
 * Refuse to publish an artifact that does not contain the bundle just built.
 * This is the check whose absence produced the stale APK.
 */
function assertPackaged(entries, expectedChunks, artifactLabel, matcher) {
	const missing = [...expectedChunks].filter(
		(chunk) => !entries.some((entry) => matcher(entry, chunk)),
	);
	if (missing.length) {
		fail(
			`${artifactLabel} does not contain the current web bundle.\n` +
				`  Missing chunks: ${missing.join(", ")}\n` +
				`  The artifact was packaged from a stale dist/. Re-run after a clean build.`,
		);
	}
	ok(`${artifactLabel} contains all ${expectedChunks.size} current entry chunk(s)`);
}


// ── the previous release must not ride along ────────────────────────
// vite copies public/ into dist/ verbatim, and dist/ is exactly what both
// native shells package. public/downloads/ holds the APK published by the
// PREVIOUS run, so every build embedded the last build inside itself — the
// artifact grew 7.9 → 14.9 → 20.9 MB over three releases, all of it dead
// weight that also shipped a stale copy of the app. The download copy is
// written after packaging, and the web deployment still serves it from
// public/, so dropping it from the bundled dist/ costs nothing.
function stripPublishedDownloads(stage) {
	// Shared with the CI jobs (.github/workflows/native.yml), which package
	// dist/ directly and used to skip this guard entirely — so the artifacts
	// users actually installed carried the nested installer. One script, one
	// behaviour, and it fails loudly if the directory survives removal.
	run(process.execPath, [join("scripts", "strip-published-downloads.mjs"), stage], {
		label: `strip previously published installers (${stage})`,
	});
}

/**
 * Fail if the APK carries an installer of its own. Entry names are real paths
 * in the archive, so this cannot false-positive on app copy the way a text scan
 * of the bundle would.
 */
function assertNoNestedInstaller(entries, label) {
	const nested = entries.filter((entry) =>
		/[^\s"']*\.(?:apk|aab|msi)\b/i.test(entry.replace(/\\/g, "/")),
	);
	if (nested.length) {
		fail(
			`${label} contains a packaged installer: ${nested.slice(0, 3).join(", ")}.\n` +
				`  dist/downloads/ was bundled into the shell. The artifact would grow by\n` +
				`  one installer on every release. Refusing to publish it.`,
		);
	}
}

// ── release manifest ────────────────────────────────────────────────
// Generated as a JS module (not JSON) so the serverless function imports it
// statically: Vercel bundles imports, but a runtime readFileSync of a
// non-imported file is not guaranteed to exist in the function sandbox.
/**
 * Platforms already advertised, so a single-shell run does not erase the
 * other one. `--desktop` alone used to rewrite the manifest with only what it
 * built, and a manifest with no `android` entry takes the APK download away
 * from every phone still on the previous version.
 */
function readAdvertisedPlatforms() {
	const file = join(ROOT, "api", "_release-manifest.js");
	if (!existsSync(file)) return {};
	const match = readFileSync(file, "utf8").match(/export const platforms = ([\s\S]+);\s*$/);
	if (!match) return {};
	try {
		const parsed = JSON.parse(match[1]);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		warn("existing api/_release-manifest.js has an unreadable platforms map — starting fresh");
		return {};
	}
}

function writeReleaseManifest(version, platforms) {
	// Merge, never replace: this run only rebuilt some of the shells, and the
	// others are still published at the version they were built at.
	const merged = { ...readAdvertisedPlatforms(), ...platforms };
	const body = `// GENERATED by scripts/release-native.mjs — do not edit by hand.
// Rewritten on every native release so /api/version can advertise the
// artifacts the release pipeline just published, with no env configuration.
export const generated = ${JSON.stringify(new Date().toISOString())};
export const version = ${JSON.stringify(version)};
export const platforms = ${JSON.stringify(merged, null, "\t")};
`;
	writeFileSync(join(ROOT, "api", "_release-manifest.js"), body, "utf8");
	ok(
		`api/_release-manifest.js written — advertising ${Object.keys(merged).sort().join(", ") || "nothing (no artifact published yet)"}`,
	);
}

// ── main ────────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const version = String(pkg.version || "0.0.0");
console.log(`\n\x1b[1mVoice Flow — native release ${version}\x1b[0m`);

// Two destinations, deliberately different:
//   release/          — the canonical artifacts (gitignored, never deployed).
//   public/downloads/ — ONLY what the deployment should serve. Vite copies
//                       public/ into dist/ verbatim, so anything left here
//                       (and not .vercelignore'd) ships on every deploy. The
//                       ~90 MB Windows installer must not.
const releaseDir = join(ROOT, "release");
const downloadsDir = join(ROOT, "public", "downloads");
mkdirSync(releaseDir, { recursive: true });
mkdirSync(downloadsDir, { recursive: true });

const platforms = {};
const buildEnv = {
	VITE_API_BASE: PRODUCTION_ORIGIN,
	// The shells compare this against the release feed. If it is missing from
	// the bundle every build looks like 2.0.1 and the updater offers an
	// update to the version already installed.
	VITE_APP_VERSION: version,
};
if (process.env.VITE_SUPABASE_URL)
	buildEnv.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL;
if (process.env.VITE_SUPABASE_ANON_KEY)
	buildEnv.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

// Icons are generated (electron/icon.png is gitignored).
step("Generating app icons");
run(process.execPath, [join("scripts", "make-icons.mjs")]);

// ── Android APK ─────────────────────────────────────────────────────
if (wantAndroid) {
	const home = javaHome();
	if (!home) {
		fail(
			"No JDK found. Gradle needs Java 17+ to build the APK.\n" +
				"  Install one, or set JAVA_HOME, then re-run.",
		);
	}
	ok(`JDK: ${home}`);

	step("Building web bundle for Android (absolute asset base)");
	run("npm", ["run", "build"], { env: { ...buildEnv, VB_NATIVE_ANDROID: "1" } });
	stripPublishedDownloads("Android");

	const expected = chunksOf(join(ROOT, "dist", "index.html"));
	ok(`built ${expected.size} entry chunk(s)`);

	if (!existsSync(join(ROOT, "android", "app"))) {
		step("Creating the Android native project");
		run("npx", ["cap", "add", "android"]);
	}

	step("Syncing web build into the native project");
	run("npx", ["cap", "sync", "android"]);

	// Third-party cookie acceptance: without it every session call 403s ~20s
	// after install (see the script header). Idempotent, fails loudly.
	step("Patching WebView cookie policy");
	run(process.execPath, [join("scripts", "patch-android-webview-cookies.mjs"), "android"]);

	// Back must navigate, not quit (BridgeActivity inherits Activity's
	// finish()). Same generated-tree constraint as the cookie delta above.
	step("Patching Android back button");
	run(process.execPath, [join("scripts", "patch-android-back-button.mjs"), "android"]);

	// Android compares build.gradle's versionName/versionCode, not
	// package.json. A release that moves only one ships an APK the feed calls
	// 2.0.2 while the phone still reports 2.0.1, so nothing ever upgrades.
	step("Syncing the Android version identity");
	run(process.execPath, [join("scripts", "sync-android-version.mjs"), "android"]);

	// `clean` is not tidiness, it is correctness: an incremental packaging pass
	// over an APK that used to be larger rewrites the entries but leaves the
	// old tail behind, so the file keeps the previous release's size as padding
	// (measured: 7.7 MB of content in a 21.9 MB file). Students download that
	// difference on mobile data for nothing.
	step("Building debug APK (Gradle, clean)");
	run(IS_WIN ? "gradlew.bat" : "./gradlew", ["clean", "assembleDebug", "--no-daemon"], {
		cwd: join(ROOT, "android"),
		env: { JAVA_HOME: home, PATH: `${home}${IS_WIN ? ";" : ":"}${process.env.PATH}` },
	});

	const builtApk = join(ROOT, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
	if (!existsSync(builtApk)) fail(`Gradle reported success but produced no APK at ${builtApk}`);

	step("Verifying the APK contains the current bundle");
	const apkEntries = listZipEntries(builtApk);
	assertPackaged(
		apkEntries,
		expected,
		"APK",
		(entry, chunk) => entry.replace(/\\/g, "/").endsWith(`assets/public/assets/${chunk}`),
	);
	assertNoNestedInstaller(apkEntries, "APK");

	const apkOut = join(downloadsDir, "Voice-Flow-Android.apk");
	copyFileSync(builtApk, join(releaseDir, "Voice-Flow-Android.apk"));
	copyFileSync(builtApk, apkOut);
	// Keep the historical root copy in lockstep: it is what people grab by hand.
	copyFileSync(builtApk, join(ROOT, "Voice-Box-Android.apk"));
	const mb = (statSync(apkOut).size / 1024 / 1024).toFixed(1);
	ok(`published public/downloads/Voice-Flow-Android.apk (${mb} MB)`);

	platforms.android = {
		version,
		url: `${PRODUCTION_ORIGIN}/downloads/Voice-Flow-Android.apk`,
		notes: `Voice Flow ${version} for Android.`,
	};
}

// ── Windows EXE ─────────────────────────────────────────────────────
if (wantDesktop) {
	step("Building web bundle for Electron (relative file:// asset base)");
	run("npm", ["run", "build"], { env: { ...buildEnv, VB_NATIVE_ELECTRON: "1" } });
	stripPublishedDownloads("Electron");

	const expected = chunksOf(join(ROOT, "dist", "index.html"));
	ok(`built ${expected.size} entry chunk(s)`);

	step("Packaging Windows installer");
	run(
		IS_WIN ? join("node_modules", ".bin", "electron-builder.CMD") : join("node_modules", ".bin", "electron-builder"),
		["--config", "electron-builder.yml", "--win", "--publish", "never"],
		{ env: buildEnv },
	);

	const distDir = join(ROOT, "electron", "dist");
	// Pick the installer THIS run produced. The old rule — largest .exe — was
	// silently wrong: electron/dist also still holds the previous release's
	// installer (electron-builder never deletes it), and once a build gets
	// smaller (this one dropped ~7 MB by no longer embedding the APK) the
	// LARGER stale file won. The 2.0.2 installer was then re-published as
	// 2.0.3 and the manifest advertised a version nobody had built.
	// Two independent guards: the filename must carry this version (it comes
	// from electron-builder.yml's artifactName), and among those the newest
	// mtime wins. A mismatch fails loudly instead of shipping the old file.
	const allExes = existsSync(distDir)
		? readdirSync(distDir).filter((f) => f.endsWith(".exe"))
		: [];
	if (!allExes.length) fail(`electron-builder produced no .exe in ${distDir}`);
	const versioned = allExes.filter((f) => f.includes(version));
	if (!versioned.length) {
		fail(
			`No installer for version ${version} in ${distDir}.\n` +
				`  Found: ${allExes.join(", ")}\n` +
				`  Refusing to publish a stale build — check electron-builder.yml's artifactName.`,
		);
	}
	const exeName = versioned.sort(
		(a, b) => statSync(join(distDir, b)).mtimeMs - statSync(join(distDir, a)).mtimeMs,
	)[0];
	const builtExe = join(distDir, exeName);
	ok(`packaged ${exeName}`);

	// The installer is an NSIS stub; the renderer lives in the unpacked
	// app.asar beside it. Verify the asar carries the chunks just built.
	step("Verifying the packaged renderer contains the current bundle");
	const asar = join(distDir, "win-unpacked", "resources", "app.asar");
	if (!existsSync(asar)) {
		fail(
			`No app.asar at ${asar} — cannot prove the installer has the new build.\n` +
				`  Refusing to publish an unverified EXE.`,
		);
	}
	const asarText = readFileSync(asar).toString("latin1");
	const missing = [...expected].filter((chunk) => !asarText.includes(chunk));
	if (missing.length)
		fail(`app.asar is missing current chunks: ${missing.join(", ")}`);
	ok(`app.asar contains all ${expected.size} current entry chunk(s)`);
	// No installer-inside-installer scan of the asar: the renderer legitimately
	// carries "/downloads/Voice-Flow-Android.apk" as the download URL, so a text
	// match proves nothing. The strip above asserts the real cause is gone.

	const exeOut = join(releaseDir, "Voice-Flow-Desktop-win-x64.exe");
	copyFileSync(builtExe, exeOut);
	const mb = (statSync(exeOut).size / 1024 / 1024).toFixed(1);
	ok(`published release/Voice-Flow-Desktop-win-x64.exe (${mb} MB)`);

	// Also publish into public/downloads/ so the Download page can serve the
	// Windows build itself. It used to stay out of public/ on the theory that
	// a 90 MB installer would ship on every web deploy — true, but the cost of
	// NOT doing it was worse: /api/version advertised no `windows` entry, so
	// the download page showed "Web PWA Available" for Windows and nobody
	// could install the desktop app at all. The file is well under the 100 MB
	// per-file deployment ceiling, and .vercelignore whitelists it explicitly.
	// Set VB_SERVE_DESKTOP_EXE=0 to go back to external hosting.
	const serveExe = String(process.env.VB_SERVE_DESKTOP_EXE ?? "1") !== "0";
	const servedExe = join(downloadsDir, "Voice-Flow-Desktop-setup.exe");
	if (serveExe) {
		copyFileSync(builtExe, servedExe);
		const smb = (statSync(servedExe).size / 1024 / 1024).toFixed(1);
		ok(`published public/downloads/Voice-Flow-Desktop-setup.exe (${smb} MB)`);
	}

	// An explicit LATEST_EXE_URL still wins: an operator who hosts the
	// installer elsewhere (GitHub Release / object storage) gets that address
	// in the feed; otherwise the file we just published answers.
	const externalExeUrl = String(process.env.LATEST_EXE_URL || "").trim();
	const exeUrl = /^https?:\/\//i.test(externalExeUrl)
		? externalExeUrl
		: serveExe
			? `${PRODUCTION_ORIGIN}/downloads/Voice-Flow-Desktop-setup.exe`
			: "";
	if (exeUrl) {
		platforms.windows = {
			version,
			url: exeUrl,
			notes: `Voice Flow ${version} for Windows.`,
		};
	} else {
		warn(
			"VB_SERVE_DESKTOP_EXE=0 and LATEST_EXE_URL is unset, so the Windows\n" +
				"    build is not advertised. Upload release/Voice-Flow-Desktop-win-x64.exe\n" +
				"    and set LATEST_EXE_URL to its public address.",
		);
	}
}

// ── manifest + web restore ──────────────────────────────────────────
step("Writing release manifest");
writeReleaseManifest(version, platforms);

if (restoreWeb) {
	// Both native builds emit their own base into dist/. Leave the browser
	// build in place so a locally served dist/ is still deployable.
	step("Restoring the browser (absolute-base) web build");
	run("npm", ["run", "build"], { env: buildEnv });
}

console.log(`\n\x1b[32m✓ Native release ${version} complete.\x1b[0m`);
console.log(`  Artifacts: ${releaseDir}`);
console.log(`  Served:    ${downloadsDir}`);
console.log(`  Feed:      ${PRODUCTION_ORIGIN}/api/version\n`);
