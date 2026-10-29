/**
 * Tactile sound & haptic feedback:
 * Light haptic tap on Android/Capacitor or navigator.vibrate
 * Soft, subtle mechanical click audio using Web Audio API on desktop.
 */
let audioCtx: AudioContext | null = null;

export function triggerHaptic(style: "light" | "medium" | "warning" = "light") {
	try {
		if (typeof navigator !== "undefined" && "vibrate" in navigator) {
			if (style === "warning") navigator.vibrate([30, 50, 30]);
			else if (style === "medium") navigator.vibrate(25);
			else navigator.vibrate(12);
		}
	} catch {
		/* ignore */
	}
	try {
		if (typeof window !== "undefined") {
			const AudioContextClass =
				window.AudioContext ||
				(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			if (AudioContextClass) {
				if (!audioCtx) audioCtx = new AudioContextClass();
				if (audioCtx.state === "suspended") {
					audioCtx.resume().catch(() => {});
				}
				const osc = audioCtx.createOscillator();
				const gain = audioCtx.createGain();
				osc.type = "sine";
				const freq = style === "warning" ? 180 : style === "medium" ? 600 : 800;
				osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
				gain.gain.setValueAtTime(0.02, audioCtx.currentTime);
				gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.04);
				osc.connect(gain);
				gain.connect(audioCtx.destination);
				osc.start();
				osc.stop(audioCtx.currentTime + 0.05);
			}
		}
	} catch {
		/* audio best-effort */
	}
}
