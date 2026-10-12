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

describe("readAlong", () => {
	const originalSynth = window.speechSynthesis;

	beforeEach(() => {
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

	it("reads each segment in order, announces the index, then finishes", async () => {
		const { readAlong } = await loadSpeech();
		const onSegment = vi.fn();
		const onDone = vi.fn();

		readAlong(["first", "second"], onSegment, onDone);

		expect(onSegment).toHaveBeenCalledWith(0);
		expect(originalSynth.speak).toHaveBeenCalledTimes(1);
		let utter: any = vi.mocked(originalSynth.speak).mock.calls[0]![0];
		expect(utter.text).toBe("first");

		utter.onend();
		expect(onSegment).toHaveBeenCalledWith(1);
		expect(originalSynth.speak).toHaveBeenCalledTimes(2);
		utter = vi.mocked(originalSynth.speak).mock.calls[1]![0];
		expect(utter.text).toBe("second");

		utter.onend();
		expect(onDone).toHaveBeenCalledTimes(1);
	});

	it("cancelling stops the sequence even if a late onend fires", async () => {
		const { readAlong } = await loadSpeech();
		const onDone = vi.fn();

		const stop = readAlong(["first", "second"], undefined, onDone);
		const utter: any = vi.mocked(originalSynth.speak).mock.calls[0]![0];

		stop();
		expect(originalSynth.cancel).toHaveBeenCalledTimes(1);

		// A cancelled utterance can still report completion late — it must
		// not resurrect the chain.
		utter.onend();
		expect(originalSynth.speak).toHaveBeenCalledTimes(1);
		expect(onDone).not.toHaveBeenCalled();
	});

	it("no-ops on an empty list and when speech synthesis is unsupported", async () => {
		const { readAlong } = await loadSpeech();
		const stop = readAlong([], vi.fn(), vi.fn());
		expect(typeof stop).toBe("function");
		expect(originalSynth.speak).not.toHaveBeenCalled();

		delete (window as any).speechSynthesis;
		try {
			const { readAlong: readAlongUnsupported } = await loadSpeech();
			readAlongUnsupported(["x"], vi.fn(), vi.fn());
			expect(originalSynth.speak).not.toHaveBeenCalled();
		} finally {
			Object.defineProperty(window, "speechSynthesis", {
				writable: true,
				configurable: true,
				value: originalSynth,
			});
		}
	});
});
