/**
 * Voice Flow — keep the Android build's version identity equal to package.json.
 *
 * WHY THIS EXISTS
 * Two different numbers describe a release, and only one of them is in the
 * repository's control:
 *
 *   package.json `version`                  → what /api/version advertises;
 *   build.gradle `versionName`/`versionCode` → what Android itself compares
 *                                              when deciding whether an APK
 *                                              is an update.
 *
 * Bumping only the first is invisible on this machine and fatal on a phone.
 * The app is told 2.0.2 is available, downloads it, and Android either refuses
 * it as a downgrade or installs it as a reinstall of the version already
 * present — either way the update card never goes away. That is exactly the
 * "update doesn't work" report this script exists to prevent.
 *
 * Behaviour:
 *   • versionName always becomes package.json's version;
 *   • versionCode increments only when versionName actually changes, so
 *     re-running the pipeline for the same release is a no-op and the locally
 *     built APK stays byte-identical to the published one;
 *   • the result is read back and verified before exiting.
 *
 * Usage: node scripts/sync-android-version.mjs [androidRoot]
 * Exits non-zero when the gradle file or its version fields are missing, so a
 * drifting release fails here rather than on a student's phone.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const androidRoot = resolve(process.argv[2] || join(ROOT, "android"));
const gradlePath = join(androidRoot, "app", "build.gradle");

if (!existsSync(gradlePath)) {
	console.error(`[android-version] no build.gradle at ${gradlePath}`);
	process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const version = String(pkg.version || "").trim();
if (!/^\d+\.\d+\.\d+/.test(version)) {
	console.error(`[android-version] package.json version is not semver: "${version}"`);
	process.exit(1);
}

const source = readFileSync(gradlePath, "utf8");
const codeMatch = source.match(/versionCode\s+(\d+)/);
const nameMatch = source.match(/versionName\s+"([^"]*)"/);

if (!codeMatch || !nameMatch) {
	console.error(
		"[android-version] build.gradle has no versionCode/versionName — refusing to guess",
	);
	process.exit(1);
}

const prevCode = Number(codeMatch[1]);
const prevName = nameMatch[1];
const nextCode = prevName === version ? prevCode : Math.max(1, prevCode + 1);

const updated = source
	.replace(/versionCode\s+\d+/, `versionCode ${nextCode}`)
	.replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);

if (updated !== source) writeFileSync(gradlePath, updated, "utf8");

// Read back: a silent no-op here would ship the drifting APK this guards against.
const check = readFileSync(gradlePath, "utf8");
const okCode = Number((check.match(/versionCode\s+(\d+)/) || [])[1]);
const okName = (check.match(/versionName\s+"([^"]*)"/) || [])[1];

if (okName !== version || okCode !== nextCode) {
	console.error(
		`[android-version] readback mismatch: expected ${version}/${nextCode}, got ${okName}/${okCode}`,
	);
	process.exit(1);
}

console.log(
	prevName === version && prevCode === nextCode
		? `[android-version] already ${okName} (code ${okCode})`
		: `[android-version] ${prevName} (code ${prevCode}) → ${okName} (code ${okCode})`,
);
