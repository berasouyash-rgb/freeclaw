// ═══════════════════════════════════════════════════════════════════
// useDeviceCapability — adaptive quality + WebGL detection.
// ═══════════════════════════════════════════════════════════════════
// Detects the device class (mobile / tablet / desktop), a rough power
// score, and WebGL2/WebGL availability, then derives a quality level:
//
//   LOW    → 15 particles, no post-processing, DPR cap 1
//   MEDIUM → 40 particles, subtle effects,   DPR cap 1.25
//   HIGH   → 80 particles, full atmosphere,  DPR cap 1.5
//
// The preloader never punishes low-end devices with an expensive 3D
// scene, and it NEVER forces reduced motion on its own — that's the
// user's preference.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";

export type Quality = "LOW" | "MEDIUM" | "HIGH";
export type DeviceClass = "mobile" | "tablet" | "desktop";

export interface DeviceCapability {
	quality: Quality;
	deviceClass: DeviceClass;
	webgl: boolean; // WebGL2 or WebGL1 available
	dprCap: number;
	particleBudget: number;
	lowPower: boolean;
}

/** True when a WebGL rendering context can be created in this browser. */
export function detectWebGL(): boolean {
	try {
		const canvas = document.createElement("canvas");
		const gl2 = canvas.getContext("webgl2");
		if (gl2) return true;
		const gl1 = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
		return !!gl1;
	} catch {
		return false;
	}
}

function detectDeviceClass(): DeviceClass {
	try {
		const ua = navigator.userAgent || "";
		const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
		const width = window.innerWidth || 0;
		if (/iPad|Tablet/i.test(ua) || (coarse && width >= 768)) return "tablet";
		if (/Mobi|Android|iPhone|iPad/i.test(ua) || (coarse && width < 768)) return "mobile";
		return "desktop";
	} catch {
		return "desktop";
	}
}

function detectLowPower(): boolean {
	try {
		const cores = navigator.hardwareConcurrency ?? 4;
		// deviceMemory is Chrome-only; absence is treated as unknown → not low
		const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
		return cores <= 4 && mem <= 4;
	} catch {
		return false;
	}
}

export function computeCapability(): DeviceCapability {
	const webgl = detectWebGL();
	const deviceClass = detectDeviceClass();
	const lowPower = detectLowPower();

	let quality: Quality = "HIGH";
	if (deviceClass === "mobile" || lowPower) quality = "MEDIUM";
	if (deviceClass === "mobile" && lowPower) quality = "LOW";
	// No WebGL at all → the Three.js scene is replaced by the CSS fallback,
	// so the quality level only governs the fallback's particle count.
	if (!webgl && quality === "HIGH") quality = "MEDIUM";

	const dprBase = Math.min(window.devicePixelRatio || 1, 2);
	const dprCap = quality === "HIGH" ? 1.5 : quality === "MEDIUM" ? 1.25 : 1;
	const particleBudget =
		quality === "HIGH" ? 80 : quality === "MEDIUM" ? 40 : 15;

	return {
		quality,
		deviceClass,
		webgl,
		dprCap: Math.min(dprBase, dprCap),
		particleBudget,
		lowPower,
	};
}

export function useDeviceCapability(): DeviceCapability {
	const [cap, setCap] = useState<DeviceCapability>(() => computeCapability());

	useEffect(() => {
		let alive = true;
		const refresh = () => {
			if (alive) setCap(computeCapability());
		};
		window.addEventListener("resize", refresh);
		// Cheap, throttled re-check on visibility so device changes (e.g.
		// moving a laptop window to a lower-power monitor) settle correctly.
		document.addEventListener("visibilitychange", refresh);
		return () => {
			alive = false;
			window.removeEventListener("resize", refresh);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, []);

	return useMemo(() => cap, [cap]);
}
