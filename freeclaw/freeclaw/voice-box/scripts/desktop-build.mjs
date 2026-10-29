#!/usr/bin/env node
/**
 * Desktop (Electron) build driver — cross-platform.
 *
 * The renderer must be built with VB_NATIVE_ELECTRON=1 so vite emits
 * relative asset URLs (`base: "./"`). Electron loads dist/index.html from
 * the local filesystem via file://, where absolute "/assets/..." paths
 * resolve to the drive root and every lazy chunk 404s into a blank window.
 *
 * The old npm script did this with Unix-only syntax
 * (`VB_NATIVE_ELECTRON=1 npm run build && ...`), which cmd.exe rejects with
 * "'VB_NATIVE_ELECTRON' is not recognized..." — so desktop:build could never
 * succeed on Windows. Setting the variable on process.env here works on every
 * shell because it never crosses the command line.
 *
 * CI (.github/workflows/native.yml) already exports VB_NATIVE_ELECTRON at the
 * job level; re-setting it here is idempotent and keeps one code path.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";

// Emit relative asset URLs for the packaged renderer.
process.env.VB_NATIVE_ELECTRON = "1";
// tsc -b plus vite both run here; give the shared heap enough room.
process.env.NODE_OPTIONS = "--max-old-space-size=6144";

function run(cmd, args) {
	console.log(`\n> ${cmd} ${args.join(" ")}`);
	const res = spawnSync(cmd, args, {
		stdio: "inherit",
		shell: isWin,
		env: process.env,
	});
	if (res.error) {
		console.error(res.error.message);
		process.exit(1);
	}
	if (res.status !== 0) process.exit(res.status ?? 1);
}

// 1) Build the renderer with relative asset paths.
run(npm, ["run", "build"]);
// 2) Package the Windows installer + portable build from electron-builder.yml.
run(
	isWin ? "node_modules\\.bin\\electron-builder.CMD" : "node_modules/.bin/electron-builder",
	["--config", "electron-builder.yml", "--win", "--publish", "never"],
);
