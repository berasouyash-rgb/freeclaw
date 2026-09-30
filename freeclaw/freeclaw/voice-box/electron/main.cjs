/**
 * Voice Box — Electron desktop shell (Windows).
 *
 * Loads the production web build (dist/index.html) over file:// with hash
 * routing (see src/App.tsx ShellRouter). All data flows to the hosted API
 * (VITE_API_BASE baked at build time); identity + activity persist in the
 * app's on-device Chromium profile — the desktop equivalent of browser
 * localStorage. No Node access in the renderer, no secrets here.
 */
const { app, BrowserWindow } = require("electron");
const { existsSync, readFileSync } = require("fs");
const { join } = require("path");

function appVersion() {
	try {
		const pkg = JSON.parse(
			readFileSync(join(__dirname, "..", "package.json"), "utf8"),
		);
		return typeof pkg.version === "string" ? pkg.version : "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function iconPath() {
	const png = join(__dirname, "icon.png");
	return existsSync(png) ? png : undefined;
}

function createWindow() {
	const win = new BrowserWindow({
		width: 1280,
		height: 800,
		minWidth: 1024,
		minHeight: 640,
		title: "Voice Box",
		backgroundColor: "#f6f6f9",
		autoHideMenuBar: true,
		icon: iconPath(),
		webPreferences: {
			preload: join(__dirname, "preload.cjs"),
			// Defaults kept locked down: no Node in the renderer,
			// isolated context, webSecurity on (API + Supabase are https).
		},
	});
	win.loadFile(join(__dirname, "..", "dist", "index.html"));
	return win;
}

// Single instance — a second launch focuses the open window instead of
// forking a second profile (which would look like lost activity).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
} else {
	let mainWin = null;
	app.on("second-instance", () => {
		if (mainWin) {
			if (mainWin.isMinimized()) mainWin.restore();
			mainWin.focus();
		}
	});
	app.whenReady().then(() => {
		mainWin = createWindow();
		app.setAboutPanelOptions({
			applicationName: "Voice Box",
			applicationVersion: appVersion(),
		});
		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				mainWin = createWindow();
			}
		});
	});
	app.on("window-all-closed", () => {
		// Standard Windows/Linux behavior: quit when the last window closes.
		if (process.platform !== "darwin") app.quit();
	});
}
