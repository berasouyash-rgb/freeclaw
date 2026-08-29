// ═══════════════════════════════════════════════════════════════════
// Preloader — the premium boot layer above the real application.
// ═══════════════════════════════════════════════════════════════════
// Owns:
//   • the LoadingCoordinator (REAL readiness — shell/fonts/data)
//   • the Three.js scene (or the CSS fallback when WebGL is absent)
//   • an Anime.js timeline for DOM choreography (logo, status labels,
//     thin progress line) and the exit morph
//
// The application mounts underneath this overlay and becomes interactive
// the moment readiness flips to READY — the loader then reveals it with
// a premium morph, never a hard-cut, and unmounts fully (all GPU + timer
// resources released).
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { animate } from "animejs";
import { PreloaderFallback } from "./PreloaderFallback";
// Type-only import — the runtime scene module (three.js) is loaded
// lazily so the ~600KB WebGL dependency stays OUT of the initial
// bundle. The DOM shell paints instantly; the 3D scene upgrades in
// when its chunk arrives (or the CSS fallback stands in).
import type { SceneController } from "./PreloaderScene";
import type { PreloaderStatus } from "./PreloaderStatus";
import { t, usePreloaderLocale, type PreloaderTextKey } from "./preloaderI18n";
import { useLoadingCoordinator } from "./useLoadingCoordinator";
import { useDeviceCapability } from "./useDeviceCapability";
import { useReducedMotion } from "./useReducedMotion";
import "./preloader.css";

interface PreloaderProps {
	onFinish?: () => void;
	/** Debug overlay (dev-only — never enabled in production). */
	debug?: boolean;
}

// Map the machine status to a translatable text key.
const STATUS_TO_KEY: Record<PreloaderStatus, PreloaderTextKey> = {
	INITIALIZING: "starting",
	ENVIRONMENT: "environment",
	AUTHENTICATION: "authentication",
	DATABASE: "database",
	REALTIME: "realtime",
	PERMISSIONS: "resources",
	RESOURCES: "resources",
	SERVICES: "resources",
	VERIFYING: "verifying",
	READY: "ready",
	REVEAL: "ready",
	ERROR: "error",
};

export default function Preloader({ onFinish, debug = false }: PreloaderProps) {
	const reducedMotion = useReducedMotion();
	const capability = useDeviceCapability();
	const locale = usePreloaderLocale();
	const coordinator = useLoadingCoordinator();
	const { status, progress, flags, elapsedMs, errored, retry, continueLimited } =
		coordinator;

	// Detect system color scheme for light/dark preloader theme
	const [isLight, _setIsLight] = useState(() => {
		try {
			const saved = localStorage.getItem("vb:theme");
			if (saved === "light") return true;
			if (saved === "dark") return false;
		} catch { /* ignore */ }
		return window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
	});

	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const sceneRef = useRef<SceneController | null>(null);
	const logoRef = useRef<HTMLDivElement | null>(null);
	const statusRef = useRef<HTMLDivElement | null>(null);
	const barRef = useRef<HTMLDivElement | null>(null);
	const rootRef = useRef<HTMLDivElement | null>(null);

	const [webglReady, setWebglReady] = useState<boolean | null>(null);
	const finishedRef = useRef(false);

	// ── Create the Three.js scene (or flag fallback) ──────────────
	// The scene module is code-split: three.js only downloads if the loader
	// is actually shown, and the CSS fallback covers the gap while (or if)
	// the chunk loads. Disposal is idempotent, so unmount-while-loading is
	// safe — the cancelled flag just drops the async result.
	useEffect(() => {
		if (!canvasRef.current) return;
		let cancelled = false;
		void import("./PreloaderScene").then(({ createPreloaderScene }) => {
			if (cancelled || !canvasRef.current) return;
			const scene = createPreloaderScene({
				canvas: canvasRef.current,
				quality: capability.quality,
				reducedMotion,
			});
			if (!scene) {
				setWebglReady(false);
				return;
			}
			setWebglReady(true);
			sceneRef.current = scene;
			scene.setStatus(status);
		});
		return () => {
			cancelled = true;
			if (sceneRef.current) {
				sceneRef.current.dispose();
				sceneRef.current = null;
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Feed the scene the current machine status.
	useEffect(() => {
		sceneRef.current?.setStatus(status);
	}, [status]);

	// ── Entrance timeline (Anime.js) — logo + status + progress ───
	useEffect(() => {
		if (!logoRef.current) return;
		const anims = [
			animate(logoRef.current, {
				opacity: [0, 1],
				scale: [0.96, 1],
				translateY: [10, 0],
				duration: 650,
				easing: "easeOutCubic",
			}),
		];
		if (barRef.current) {
			anims.push(
				animate(barRef.current, {
					scaleX: [0, 1],
					duration: 700,
					easing: "easeOutCubic",
				}),
			);
		}
		if (statusRef.current) {
			anims.push(
				animate(statusRef.current, {
					opacity: [0, 1],
					translateY: [6, 0],
					duration: 450,
					easing: "easeOutCubic",
				}),
			);
		}
		return () => anims.forEach((a) => a.cancel());
	}, [reducedMotion]);

	// ── Status label swaps + progress line updates ────────────────
	// The label follows the machine state AND the browser locale — when the
	// user switches language mid-boot, the visible status re-translates.
	const statusText = t(errored ? "error" : STATUS_TO_KEY[status], locale);
	useEffect(() => {
		if (!statusRef.current) return;
		if (statusRef.current.textContent !== statusText) {
			statusRef.current.textContent = statusText;
		}
	}, [statusText]);

	useEffect(() => {
		if (!barRef.current) return;
		barRef.current.style.transform = `scaleX(${progress})`;
	}, [progress]);

	// ── Ready → reveal with a premium morph (no hard-cut) ──────────
	// The app handoff is DETERMINISTIC: plain timeouts drive it so the
	// overlay can never be trapped behind an animation library. Anime.js
	// runs alongside purely as the visual exit — if it stalls, the app
	// still reveals on schedule.
	useEffect(() => {
		if (status !== "READY" || finishedRef.current) return;
		finishedRef.current = true;

		if (reducedMotion) {
			const t = window.setTimeout(() => onFinish?.(), 80);
			return () => window.clearTimeout(t);
		}

		// t1: brief beat on "Ready", then start the exit morph.
		const t1 = window.setTimeout(() => {
			if (rootRef.current) {
				animate(rootRef.current, {
					opacity: [1, 0],
					translateY: [0, -22],
					scale: [1, 1.015],
					duration: 620,
					easing: "easeOutCubic",
				});
			}
		}, 220);
		// t2: hand off after the morph window (620ms) regardless of anime.
		const t2 = window.setTimeout(() => onFinish?.(), 220 + 620);
		return () => {
			window.clearTimeout(t1);
			window.clearTimeout(t2);
		};
	}, [status, onFinish, reducedMotion]);

	// Error → calm the scene and let the user choose.
	useEffect(() => {
		if (errored) sceneRef.current?.setStatus("ERROR");
	}, [errored]);

	// Scroll-lock while the overlay is up (released on unmount).
	useEffect(() => {
		document.body.classList.add("vpl-lock");
		return () => document.body.classList.remove("vpl-lock");
	}, []);

	const showError = errored;

	return (
		<div
			ref={rootRef}
			className={`vpl-root vpl-overlay${isLight ? " light" : ""}`}
			data-testid="vpl-overlay"
			data-status={status}
			data-reduced-motion={reducedMotion ? "true" : "false"}
		>
			{/* ambient backdrop */}
			<span className="vpl-bg vpl-bg--1" aria-hidden="true" />
			<span className="vpl-bg vpl-bg--2" aria-hidden="true" />

			{webglReady === false ? (
				<PreloaderFallback
					quality={capability.quality}
					reducedMotion={reducedMotion}
					status={statusText}
				/>
			) : (
				<canvas
					ref={canvasRef}
					className="vpl-canvas"
					data-testid="vpl-canvas"
					aria-hidden="true"
				/>
			)}

			<div className="vpl-center" ref={logoRef}>
				<div className="vpl-brand">
					<span className="vpl-brand__mark" aria-hidden="true">
						<span />
						<span />
						<span />
					</span>
					<span className="vpl-brand__name">Voice Box</span>
				</div>
				<div
					className="vpl-status"
					ref={statusRef}
					role="status"
					aria-live="polite"
					data-testid="vpl-status"
				>
					{statusText}
				</div>
				<div className="vpl-track" role="progressbar" aria-valuemin={0} aria-valuemax={1} aria-valuenow={progress}>
					<div className="vpl-bar" ref={barRef} data-testid="vpl-bar" />
				</div>
			</div>

			{showError && (
				<div className="vpl-error" data-testid="vpl-error" role="alert">
					<p className="vpl-error__msg">{t("errorMsg", locale)}</p>
					<p className="vpl-error__detail">{t("errorMsgDetail", locale)}</p>
					<div className="vpl-error__actions">
						<button type="button" className="vpl-btn vpl-btn--primary" onClick={retry}>
							{t("retry", locale)}
						</button>
						<button type="button" className="vpl-btn" onClick={continueLimited}>
							{t("continue", locale)}
						</button>
					</div>
				</div>
			)}

			{debug && (
				<div className="vpl-debug" data-testid="vpl-debug">
					<span>state: {status}</span>
					<span>quality: {capability.quality}</span>
					<span>webgl: {webglReady === null ? "checking" : webglReady ? "yes" : "fallback"}</span>
					<span>reduced: {reducedMotion ? "yes" : "no"}</span>
					<span>t: {Math.round(elapsedMs)}ms</span>
					<span>
						shell {flags.shellReady ? "✓" : "·"} env {flags.envReady ? "✓" : "·"} fonts {flags.fontsReady ? "✓" : "·"} auth {flags.authReady ? "✓" : "·"} db {flags.dbReady ? "✓" : "·"} rt {flags.realtimeReady ? "✓" : "·"} data {flags.dataReady ? "✓" : "·"}
					</span>
				</div>
			)}

		</div>
	);
}
