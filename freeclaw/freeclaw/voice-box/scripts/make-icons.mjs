/**
 * Generate native-shell artwork from public/favicon.svg (the Voice Box mark).
 *
 *   electron/icon.png      512px app icon (electron-builder)
 *   resources/icon.png    1024px source for `capacitor-assets generate`
 *   resources/splash.png  2732px source for `capacitor-assets generate`
 *
 * Runs in CI (sharp is a devDependency but only imported here, so the web
 * bundle and local installs without it are unaffected). All output paths
 * are gitignored build artifacts.
 */
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "public", "favicon.svg");

const BRAND = "#5652d6";
const SPLASH_BG = "#f6f6f9";

async function main() {
	let sharp;
	try {
		sharp = (await import("sharp")).default;
	} catch {
		console.error(
			"[icons] sharp is not installed — run `npm ci` (it is a devDependency).",
		);
		process.exit(1);
	}

	mkdirSync(join(root, "electron"), { recursive: true });
	mkdirSync(join(root, "resources"), { recursive: true });

	// Electron + Capacitor icon (favicon is already a full-bleed tile).
	await sharp(src).resize(512, 512).png().toFile(join(root, "electron", "icon.png"));
	await sharp(src).resize(1024, 1024).png().toFile(join(root, "resources", "icon.png"));

	// Splash: centered mark on the light background.
	const mark = await sharp(src).resize(1024, 1024).png().toBuffer();
	await sharp({
		create: {
			width: 2732,
			height: 2732,
			channels: 4,
			background: SPLASH_BG,
		},
	})
		.composite([{ input: mark, left: 854, top: 854 }])
		.png()
		.toFile(join(root, "resources", "splash.png"));

	console.log(`[icons] brand=${BRAND} — electron/icon.png, resources/icon.png, resources/splash.png ✓`);
}

main().catch((err) => {
	console.error("[icons] failed:", err instanceof Error ? err.message : err);
	process.exit(1);
});
