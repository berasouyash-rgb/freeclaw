/**
 * Voice Flow — Electron preload bridge.
 *
 * Exposes exactly two things to the renderer:
 *
 *   window.vbDesktop = true          — so src/lib/platform.ts detects the
 *                                      desktop shell (see getPlatform).
 *   window.vbStore.{get,set,remove,keys}
 *                                    — the device-local key/value store,
 *                                      implemented in electron/main.cjs as a
 *                                      JSON file in the app's userData dir.
 *
 * This is the desktop counterpart of the browser's localStorage: identity,
 * drafts, bookmarks and preferences live on the machine itself rather than
 * in a Chromium profile that a "clear browsing data" action can wipe.
 *
 * Deliberately NOT exposed: any Node API, the filesystem, the store's path,
 * or an arbitrary path parameter. The renderer can only move strings in and
 * out of a fixed, validated keyspace — main.cjs re-validates every key and
 * value, so a compromised renderer cannot traverse paths or smuggle a file
 * write through this bridge.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vbDesktop", true);

contextBridge.exposeInMainWorld("vbStore", {
	get: (key) => ipcRenderer.invoke("vb-store:get", key),
	set: (key, value) => ipcRenderer.invoke("vb-store:set", key, value),
	remove: (key) => ipcRenderer.invoke("vb-store:remove", key),
	keys: () => ipcRenderer.invoke("vb-store:keys"),
});
