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

export function stopReading() {
	if (speechOutputSupported) window.speechSynthesis.cancel();
}
