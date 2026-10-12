/**
 * Text-to-speech: read posts and replies aloud in the device voice.
 *
 * Voice INPUT (dictation, recorded takes, server transcription) was removed:
 * Submit and the inbox are typed-text only. This module keeps output only.
 */
/* ---------- Text-to-speech (read post aloud) ---------- */
export const speechOutputSupported =
	typeof window !== "undefined" && "speechSynthesis" in window;

export function readAloud(text: string, onEnd?: () => void) {
	if (!speechOutputSupported) return;
	window.speechSynthesis.cancel();
	const utter = new SpeechSynthesisUtterance(text.slice(0, 1500));
	utter.rate = 1;
	utter.lang = navigator.language || "en-US";
	if (onEnd) utter.onend = onEnd;
	window.speechSynthesis.speak(utter);
}

/**
 * Read a sequence of segments aloud, announcing each index as it starts.
 * Built directly on speechSynthesis (like readAloud) — no new dependency.
 * Returns a stop function; a late onend after stop() never resumes the chain.
 */
export function readAlong(
	texts: string[],
	onSegment?: (index: number) => void,
	onDone?: () => void,
): () => void {
	const supported =
		typeof window !== "undefined" && "speechSynthesis" in window;
	let cancelled = false;
	let i = 0;
	const stop = () => {
		cancelled = true;
		if (supported) window.speechSynthesis.cancel();
	};
	if (!supported || texts.length === 0) return stop;
	const speakNext = () => {
		if (cancelled) return;
		if (i >= texts.length) {
			onDone?.();
			return;
		}
		onSegment?.(i);
		const utter = new SpeechSynthesisUtterance(texts[i] ?? "");
		utter.rate = 1;
		utter.lang = navigator.language || "en-US";
		utter.onend = () => {
			if (cancelled) return;
			i += 1;
			speakNext();
		};
		window.speechSynthesis.speak(utter);
	};
	speakNext();
	return stop;
}

export function stopReading() {
	if (speechOutputSupported) window.speechSynthesis.cancel();
}
