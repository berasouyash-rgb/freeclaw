/**
 * Voice Box — Electron preload bridge.
 *
 * Exposes the minimum the web app needs to know it runs on desktop:
 * `window.vbDesktop === true` (see src/lib/platform.ts getPlatform).
 * No Node APIs, no secrets, no storage access cross the bridge.
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("vbDesktop", true);
