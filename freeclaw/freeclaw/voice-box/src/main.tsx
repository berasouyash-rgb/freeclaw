import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { isChunkLoadError, reloadOnceForStaleChunk } from "./lib/retryLazy";
import { initSentry } from "./lib/sentry";
import { initVitals } from "./lib/vitals";
import { initErrorCapture } from "./lib/errors";

// Initialize Sentry error tracking as early as possible
initSentry();
// Collect real Core Web Vitals and report to backend
initVitals();
// Capture real JS errors and send to backend for admin visibility
initErrorCapture();

/** Remove the HTML splash. Safe to call multiple times. */
function killSplash() {
	const splash = document.getElementById("vb-splash");
	if (splash) {
		splash.classList.add("vb-hide");
		setTimeout(() => splash.remove(), 260);
	}
}

/** Show a fatal-error screen instead of hanging on the splash forever.
 *  Safe DOM construction only (no innerHTML) — prevents XSS. */
function showFatal(message: string) {
	const splash = document.getElementById("vb-splash");
	if (!splash) return;
	// If the splash was mid-hide, bring it back so the error is readable.
	splash.classList.remove("vb-hide");
	// Clear any existing children safely
	splash.replaceChildren();

	const wrapper = document.createElement("div");
	wrapper.style.cssText =
		"text-align:center;max-width:360px;padding:32px 24px;font-family:'Albert Sans',system-ui,sans-serif";

	const icon = document.createElement("div");
	icon.style.cssText =
		"width:52px;height:52px;margin:0 auto 16px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(239,68,68,.12);font-size:26px;line-height:1";
	icon.textContent = "\u26A0\uFE0F"; // ⚠️

	const title = document.createElement("h1");
	title.style.cssText =
		"font-size:17px;font-weight:700;margin:0 0 6px;color:#171724";
	title.textContent = "Voice Box couldn't start";

	const detail = document.createElement("p");
	detail.style.cssText =
		"font-size:13px;line-height:1.55;color:#8e8ea5;margin:0 0 20px;word-break:break-word";
	detail.textContent = (message || "Unknown startup error").slice(0, 200);

	const actions = document.createElement("div");
	actions.style.cssText =
		"display:flex;gap:10px;justify-content:center;flex-wrap:wrap";

	const reload = document.createElement("button");
	reload.style.cssText =
		"padding:10px 22px;border-radius:10px;border:0;background:#5652d6;color:#fff;font-size:13px;font-weight:600;cursor:pointer";
	reload.textContent = "Reload";
	reload.addEventListener("click", () => location.reload());

	const hardReload = document.createElement("button");
	hardReload.style.cssText =
		"padding:10px 16px;border-radius:10px;border:1px solid #e2e2ee;background:transparent;color:#5652d6;font-size:13px;font-weight:600;cursor:pointer";
	hardReload.textContent = "Clear cache + reload";
	hardReload.addEventListener("click", () => {
		try {
			sessionStorage.clear();
		} catch {
			/* storage unavailable */
		}
		location.reload();
	});

	actions.append(reload, hardReload);
	wrapper.append(icon, title, detail, actions);
	splash.appendChild(wrapper);
}

try {
	createRoot(document.getElementById("root")!).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
	// Primary: remove splash after first painted frame
	requestAnimationFrame(() => requestAnimationFrame(killSplash));
	// Backups: window load + hard 3s ceiling (React is mounted synchronously above,
	// so if we reach here the app IS running — never leave the splash up)
	window.addEventListener("load", killSplash);
	setTimeout(killSplash, 3000);
} catch (err: unknown) {
	console.error("[VoiceBox] fatal boot error:", err);
	showFatal(err instanceof Error ? err.message : "Unknown startup error");
}

// ─── Unified global error handling ───────────────────────────────
// Handles two concerns in one listener to avoid races:
// 1. Stale-chunk self-healing: after a Vercel redeploy, old chunk URLs 404.
//    Reload once per session (guarded) to get fresh index.html → fresh chunks.
// 2. Splash-fatal: if the splash is still visible, show a fatal error screen
//    (but NOT if we're about to reload for a stale chunk — that would flash).
window.addEventListener("error", (e) => {
	// Chunk-load errors: self-heal by reloading (takes priority over fatal screen)
	if (isChunkLoadError(e.message)) {
		reloadOnceForStaleChunk();
		return;
	}
	// Any other error before splash removal → visible error, not a dead spinner
	const splash = document.getElementById("vb-splash");
	if (splash && !splash.classList.contains("vb-hide")) {
		showFatal(e.message || "Script error");
	}
});
window.addEventListener("unhandledrejection", (e) => {
	const msg =
		e.reason instanceof Error ? e.reason.message : String(e.reason ?? "");
	if (isChunkLoadError(msg)) reloadOnceForStaleChunk();
});
