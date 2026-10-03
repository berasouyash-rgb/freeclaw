// ─── speech.ts tests ──────────────────────────────────────────────
// Locks in the text-to-speech output behavior (voice INPUT was removed:
// Submit and the inbox are typed-text only):
//   readAloud/stopReading: speechSynthesis wiring, 1500-char cap,
//   no-op when unsupported
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── helpers ──────────────────────────────────────────────────────

async function loadSpeech() {
	vi.resetModules();
	return await import("../lib/speech");
}

describe("readAloud and stopReading", () => {
	const originalSynth = window.speechSynthesis;

	beforeEach(() => {
		// jsdom has no SpeechSynthesisUtterance — supply a minimal class
		class UtteranceMock {
			text: string;
			rate = 1;
			lang = "";
			onend: (() => void) | null = null;
			constructor(text = "") {
				this.text = text;
			}
		}
		Object.defineProperty(window, "SpeechSynthesisUtterance", {
			writable: true,
			configurable: true,
			value: UtteranceMock,
		});
		vi.mocked(originalSynth.speak).mockClear();
		vi.mocked(originalSynth.cancel).mockClear();
	});

	it("speaks the text and wires up onEnd", async () => {
		const { readAloud } = await loadSpeech();
		const onEnd = vi.fn();

		readAloud("hello world", onEnd);

		expect(originalSynth.cancel).toHaveBeenCalledTimes(1);
		expect(originalSynth.speak).toHaveBeenCalledTimes(1);
		const utter: any = vi.mocked(originalSynth.speak).mock.calls[0]![0];
		expect(utter.text).toBe("hello world");
		expect(utter.rate).toBe(1);
		expect(utter.lang).toBe(navigator.language || "en-US");

		utter.onend();
		expect(onEnd).toHaveBeenCalledTimes(1);
	});

	it("truncates long text to 1500 characters", async () => {
		const { readAloud } = await loadSpeech();
		readAloud("x".repeat(2000));
		const utter: any = vi.mocked(originalSynth.speak).mock.calls[0]![0];
		expect(utter.text.length).toBe(1500);
	});

	it("stopReading cancels synthesis", async () => {
		const { stopReading } = await loadSpeech();
		stopReading();
		expect(originalSynth.cancel).toHaveBeenCalledTimes(1);
	});

	it("leaves onend unset when no callback is given", async () => {
		const { readAloud } = await loadSpeech();
		readAloud("hello world");
		const utter: any = vi.mocked(originalSynth.speak).mock.calls[0]![0];
		expect(utter.onend).toBeNull();
	});

	it("falls back to en-US when navigator.language is empty", async () => {
		Object.defineProperty(navigator, "language", {
			value: "",
			configurable: true,
		});
		const { readAloud } = await loadSpeech();
		readAloud("hello world");
		const utter: any = vi.mocked(originalSynth.speak).mock.calls[0]![0];
		expect(utter.lang).toBe("en-US");
		delete (navigator as any).language;
	});

	it("no-ops when speech synthesis is unsupported", async () => {
		// the module guards with 'speechSynthesis' in window, so simulate absence
		delete (window as any).speechSynthesis;
		try {
			const { readAloud, stopReading } = await loadSpeech();
			readAloud("hello", vi.fn());
			stopReading();
			expect(originalSynth.speak).not.toHaveBeenCalled();
			expect(originalSynth.cancel).not.toHaveBeenCalled();
		} finally {
			Object.defineProperty(window, "speechSynthesis", {
				writable: true,
				configurable: true,
				value: originalSynth,
			});
		}
	});
});
