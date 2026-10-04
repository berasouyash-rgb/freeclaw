/**
 * Voice Flow — Electron desktop shell (Windows).
 *
 * Loads the production web build (dist/index.html) over file:// with hash
 * routing (see src/App.tsx ShellRouter). All data flows to the hosted API
 * (VITE_API_BASE baked at build time).
 *
 * Local identity + activity persist in `userData/vb-store.json` — the
 * machine's own storage, reached only through the preload bridge
 * (see electron/preload.cjs and src/lib/storage.ts). No Node access in the
 * renderer, no secrets here.
 */
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const {
	existsSync,
	readFileSync,
	writeFileSync,
	renameSync,
	mkdirSync,
	rmSync,
	copyFileSync,
} = require("fs");
const { join, dirname } = require("path");

// ── school-PC compatibility ──────────────────────────────────────
// Many school PCs (old Intel iGPUs, outdated drivers, RDP sessions) crash
// Chromium's GPU process (gpu_process_host "exited unexpectedly"), leaving a
// black/blank window. Software rendering costs nothing visible in this app
// (lists and text, no 3D/video) and boots everywhere. Must run before ready.
try {
	app.disableHardwareAcceleration();
} catch {
	/* older Electron — ignore */
}

// ── device store ───────────────────────────────────────────────────
//
// A single JSON object of `vb:*` → string. Kept deliberately narrow:
// the renderer can only move strings within one validated keyspace, so a
// compromised renderer cannot reach an arbitrary path through this bridge.

/** Written atomically (tmp + rename) so a crash mid-write cannot corrupt it. */
function storeFile() {
	return join(app.getPath("userData"), "vb-store.json");
}

/** Keys must be prefixed and path-safe — no separators, no traversal. */
const KEY_RE = /^vb:[A-Za-z0-9._:-]{0,190}$/;
/** Ceiling for a single value. Photo data URLs are capped client-side at
 *  ~500k chars; this leaves headroom without letting the file balloon. */
const MAX_VALUE_CHARS = 1_000_000;

let cache = null;
/** Serializes writes so two rapid saves cannot interleave the rename. */
let writeChain = Promise.resolve();

function loadStore() {
	if (cache) return cache;
	cache = {};
	try {
		if (!existsSync(storeFile())) return cache;
		const parsed = JSON.parse(readFileSync(storeFile(), "utf8"));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			for (const [key, value] of Object.entries(parsed)) {
				if (typeof key === "string" && typeof value === "string") {
					cache[key] = value;
				}
			}
		}
	} catch {
		// Unreadable or corrupt: back up the existing file on disk so student data
		// (identity, drafts, bookmarks) can be rescued before a future write overwrites it.
		try {
			const file = storeFile();
			if (existsSync(file)) {
				const backup = `${file}.corrupted-${Date.now()}`;
				copyFileSync(file, backup);
			}
		} catch {
			/* best effort backup */
		}
		cache = {};
	}
	return cache;
}

function persist() {
	const file = storeFile();
	const tmp = `${file}.tmp`;
	writeChain = writeChain.then(
		() =>
			new Promise((resolve) => {
				try {
					mkdirSync(dirname(file), { recursive: true });
					writeFileSync(tmp, JSON.stringify(cache), "utf8");
					renameSync(tmp, file); // atomic swap
				} catch {
					try {
						rmSync(tmp, { force: true });
					} catch {
						/* nothing else to do */
					}
				}
				resolve();
			}),
	);
	return writeChain;
}

function validKey(key) {
	return typeof key === "string" && KEY_RE.test(key);
}

ipcMain.handle("vb-store:get", (_event, key) => {
	if (!validKey(key)) return null;
	const value = loadStore()[key];
	return typeof value === "string" ? value : null;
});

ipcMain.handle("vb-store:set", (_event, key, value) => {
	if (!validKey(key) || typeof value !== "string") return false;
	if (value.length > MAX_VALUE_CHARS) return false;
	loadStore()[key] = value;
	void persist();
	return true;
});

ipcMain.handle("vb-store:remove", (_event, key) => {
	if (!validKey(key)) return false;
	delete loadStore()[key];
	void persist();
	return true;
});

ipcMain.handle("vb-store:keys", () =>
	Object.keys(loadStore()).filter((key) => key.startsWith("vb:")),
);

// ── window ─────────────────────────────────────────────────────────

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
		title: "Voice Flow",
		backgroundColor: "#f6f6f9",
		autoHideMenuBar: true,
		icon: iconPath(),
		webPreferences: {
			preload: join(__dirname, "preload.cjs"),
			// Defaults kept locked down: no Node in the renderer,
			// isolated context, webSecurity on (API + Supabase are https).
			// The device store is reachable only through the preload bridge.
		},
	});
	win.loadFile(join(__dirname, "..", "dist", "index.html"));
	// Never spawn renderer windows: target=_blank links (docs, legal pages)
	// would otherwise open an uncontrolled second window with no app chrome.
	// http(s) links open in the user's default browser instead.
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
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
			applicationName: "Voice Flow",
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
