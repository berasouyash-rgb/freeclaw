#!/usr/bin/env node
/**
 * Remove previously published installers from the bundled dist/.
 *
 * WHY THIS EXISTS
 * `public/downloads/` holds the APK the release pipeline publishes — committed
 * on purpose (.gitignore re-includes it) so the deployment can serve it. Vite
 * copies `public/` into `dist/` verbatim, and `dist/` is exactly what both
 * native shells package:
 *
 *   • the APK embeds the PREVIOUS APK → every release adds ~7.5 MB of dead
 *     weight a student pays for on mobile data, and ships a stale copy of the
 *     app inside the app;
 *   • the EXE embeds the same file in app.asar → the installer grows too.
 *
 * scripts/release-native.mjs has always stripped this before packaging, but
 * the CI jobs package `dist/` directly, so the CI artifacts — the ones users
 * actually install — carried the nested installer. This is the single
 * implementation both paths call, so they cannot drift apart.
 *
 * USAGE
 *   node scripts/strip-published-downloads.mjs [stage]
 *
 * Exits non-zero when the directory survives removal: the shells package
 * `dist/` minutes later, and a leftover here is exactly the defect above.
 */

import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stage = process.argv[2] || "build";
const bundled = join(ROOT, "dist", "downloads");

if (existsSync(bundled)) {
	rmSync(bundled, { recursive: true, force: true });
	console.log(
		`  ✓ dropped dist/downloads from the ${stage} bundle (it nests the previous installer)`,
	);
}

if (existsSync(bundled)) {
	console.error(
		`✗ dist/downloads survived removal — the ${stage} would package the previous installer.`,
	);
	process.exit(1);
}
