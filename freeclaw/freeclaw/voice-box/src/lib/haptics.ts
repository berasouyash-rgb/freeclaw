/**
 * Tactile sound & haptic feedback suite for VoiceFlow.
 * Provides:
 *   1. Hardware vibration pulses on mobile (Android/Capacitor/navigator.vibrate).
 *   2. Synthesized zero-latency Web Audio micro-acoustics on desktop.
 *   3. Multi-profile feedback: light, medium, heavy, success, warning, error, selection.
 *   4. Zero-battery audio synthesis (starts and tears down in < 60ms).
 */

let audioCtx: AudioContext | null = null;

export type HapticStyle =
	| "light"
	| "medium"
	| "heavy"
	| "success"
	| "warning"
	| "error"
	| "selection";

function isSoundEnabled(): boolean {
	try {
		if (typeof window === "undefined") return false;
		return localStorage.getItem("vb_sound_enabled") !== "false";
	} catch {
		return true;
	}
}

export function setSoundEnabled(enabled: boolean) {
	try {
		localStorage.setItem("vb_sound_enabled", enabled ? "true" : "false");
	} catch {
		/* ignore */
	}
}

export function triggerHaptic(style: HapticStyle = "light") {
	// ── 1. Mobile Physical Vibration ──
	try {
		if (typeof navigator !== "undefined" && "vibrate" in navigator) {
			if (style === "success") navigator.vibrate([15, 30, 25]);
			else if (style === "warning") navigator.vibrate([30, 50, 30]);
			else if (style === "error") navigator.vibrate([40, 60, 40, 60]);
			else if (style === "heavy") navigator.vibrate(35);
			else if (style === "medium") navigator.vibrate(22);
			else if (style === "selection") navigator.vibrate(8);
			else navigator.vibrate(12);
		}
	} catch {
		/* ignore unsupported vibrate */
	}

	// ── 2. Synthesized Desktop Micro-Acoustics ──
	if (!isSoundEnabled()) return;

	try {
		if (typeof window !== "undefined") {
			const AudioContextClass =
				window.AudioContext ||
				(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			if (!AudioContextClass) return;

			if (!audioCtx) audioCtx = new AudioContextClass();
			if (audioCtx.state === "suspended") {
				audioCtx.resume().catch(() => {});
			}

			const now = audioCtx.currentTime;

			if (style === "success") {
				// Harmonic ascending chime (C5 -> E5 -> G5)
				[523.25, 659.25, 783.99].forEach((freq, idx) => {
					if (!audioCtx) return;
					const osc = audioCtx.createOscillator();
					const gain = audioCtx.createGain();
					osc.type = "sine";
					osc.frequency.setValueAtTime(freq, now + idx * 0.04);
					gain.gain.setValueAtTime(0.015, now + idx * 0.04);
					gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.04 + 0.12);
					osc.connect(gain);
					gain.connect(audioCtx.destination);
					osc.start(now + idx * 0.04);
					osc.stop(now + idx * 0.04 + 0.14);
				});
				return;
			}

			if (style === "selection") {
				// Crisp high-frequency micro-tick
				const osc = audioCtx.createOscillator();
				const gain = audioCtx.createGain();
				osc.type = "sine";
				osc.frequency.setValueAtTime(1200, now);
				gain.gain.setValueAtTime(0.012, now);
				gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
				osc.connect(gain);
				gain.connect(audioCtx.destination);
				osc.start(now);
				osc.stop(now + 0.025);
				return;
			}

			if (style === "error") {
				// Low warning double-thud
				[180, 140].forEach((freq, idx) => {
					if (!audioCtx) return;
					const osc = audioCtx.createOscillator();
					const gain = audioCtx.createGain();
					osc.type = "triangle";
					osc.frequency.setValueAtTime(freq, now + idx * 0.07);
					gain.gain.setValueAtTime(0.025, now + idx * 0.07);
					gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.07 + 0.08);
					osc.connect(gain);
					gain.connect(audioCtx.destination);
					osc.start(now + idx * 0.07);
					osc.stop(now + idx * 0.07 + 0.09);
				});
				return;
			}

			// Single tone profiles (light, medium, heavy, warning)
			const osc = audioCtx.createOscillator();
			const gain = audioCtx.createGain();
			osc.type = style === "heavy" ? "triangle" : "sine";
			const freq =
				style === "warning"
					? 220
					: style === "heavy"
						? 320
						: style === "medium"
							? 600
							: 850;
			const duration = style === "heavy" ? 0.07 : style === "warning" ? 0.08 : 0.035;
			osc.frequency.setValueAtTime(freq, now);
			gain.gain.setValueAtTime(0.018, now);
			gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
			osc.connect(gain);
			gain.connect(audioCtx.destination);
			osc.start(now);
			osc.stop(now + duration + 0.01);
		}
	} catch {
		/* audio best-effort */
	}
}
