// ─── speech.ts tests ──────────────────────────────────────────────
// Locks in the Web Speech API wrapper behavior:
//   1. speechSupported reflects SpeechRecognition availability
//   2. cleanTranscript: punctuation voice commands, domain corrections,
//      spacing tidy-up, sentence capitalization
//   3. readAloud/stopReading: speechSynthesis wiring, 1500-char cap,
//      no-op when unsupported
//   4. startDictation: config, interim/final results, best-alternative
//      picking, error mapping, auto-restart, stop, failure paths
//
// NOTE: speech.ts captures the SpeechRecognition constructor at module
// load, so every dictation test re-imports the module AFTER configuring
// window.webkitSpeechRecognition (vi.resetModules + dynamic import).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── helpers ──────────────────────────────────────────────────────

async function loadSpeech() {
	vi.resetModules();
	return await import("../lib/speech");
}

interface RecInstance {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	maxAlternatives: number;
	onresult: ((e: any) => void) | null;
	onerror: ((e: any) => void) | null;
	onend: (() => void) | null;
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
}

let recInstances: RecInstance[] = [];

function makeRec(): RecInstance {
	const inst: RecInstance = {
		lang: "",
		continuous: false,
		interimResults: false,
		maxAlternatives: 1,
		onresult: null,
		onerror: null,
		onend: null,
		start: vi.fn(),
		stop: vi.fn(),
	};
	recInstances.push(inst);
	return inst;
}

/** Point window.webkitSpeechRecognition at a fresh mock constructor. */
function defineRecCtor(make: () => RecInstance = makeRec) {
	recInstances = [];
	// plain constructor (not vi.fn) so `new SR()` reliably works with any
	// make() implementation — a constructor returning an object yields it
	const ctor = function SpeechRecognitionMock() {
		return make();
	};
	Object.defineProperty(window, "webkitSpeechRecognition", {
		writable: true,
		configurable: true,
		value: ctor,
	});
	Object.defineProperty(window, "SpeechRecognition", {
		writable: true,
		configurable: true,
		value: undefined,
	});
}

// ─── speechSupported ──────────────────────────────────────────────

describe("speechSupported", () => {
	it("is true when a SpeechRecognition implementation exists", async () => {
		defineRecCtor();
		const speech = await loadSpeech();
		expect(speech.speechSupported).toBe(true);
	});

	it("is false when no implementation exists", async () => {
		Object.defineProperty(window, "webkitSpeechRecognition", {
			writable: true,
			configurable: true,
			value: undefined,
		});
		Object.defineProperty(window, "SpeechRecognition", {
			writable: true,
			configurable: true,
			value: undefined,
		});
		const speech = await loadSpeech();
		expect(speech.speechSupported).toBe(false);
	});
});

// ─── cleanTranscript ──────────────────────────────────────────────

describe("cleanTranscript", () => {
	it.each([
		// punctuation voice commands
		["hello comma world full stop", "Hello, world."],
		["are you ok question mark", "Are you ok?"],
		["wow exclamation mark", "Wow!"],
		["go now exclamation point", "Go now!"],
		["after this period", "After this."],
		["first line new line second line", "First line \n second line"],
		["para one new paragraph para two", "Para one \n\n para two"],
		// domain corrections
		["the faculties are open", "The facilities are open"],
		["the facility's gate", "The facilities gate"],
		["the can teen is empty", "The canteen is empty"],
		["cant een food", "Canteen food"],
		["wi fi router", "Wi-Fi router"],
		["why fi is slow", "Wi-Fi is slow"],
		["my wifey is broken", "My Wi-Fi is broken"],
		["the hostile has beds", "The hostel has beds"],
		["hostal rules", "Hostel rules"],
		["in the liberary", "In the library"],
		["libary hours", "Library hours"],
		["the principle said hi", "The principal said hi"],
		["bulling is bad", "Bullying is bad"],
		["bullies ing stops", "Bullying stops"],
		["the wash room is clean", "The washroom is clean"],
		["bath room tiles", "Bathroom tiles"],
		["class room one", "Classroom one"],
		["home work is due", "Homework is due"],
		["the time table changed", "The timetable changed"],
		["play ground is empty", "Playground is empty"],
		["my note books are new", "My notebook are new"],
		["note book cover", "Notebook cover"],
		["ac is broken", "AC is broken"],
		["AC unit", "AC unit"],
		["the ev ents are on", "The events are on"],
		// spacing tidy-up and capitalization
		["hello ,world", "Hello, world"],
		["hello,world", "Hello, world"],
		["hello world. next sentence", "Hello world. Next sentence"],
		["hello", "Hello"],
	])("cleanTranscript(%j) → %j", (input, expected) => {
		return loadSpeech().then(({ cleanTranscript }) => {
			expect(cleanTranscript(input)).toBe(expected);
		});
	});
});

// ─── readAloud / stopReading ──────────────────────────────────────

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

// ─── startDictation ───────────────────────────────────────────────

describe("startDictation", () => {
	const opts = () => ({
		lang: "en",
		onInterim: vi.fn(),
		onFinal: vi.fn(),
		onEnd: vi.fn(),
		onError: vi.fn(),
	});

	beforeEach(() => {
		defineRecCtor();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("configures and starts recognition", async () => {
		const { startDictation } = await loadSpeech();
		const session = startDictation(opts());

		expect(session).not.toBeNull();
		const rec = recInstances[0]!;
		expect(rec.lang).toBe("en");
		expect(rec.continuous).toBe(true);
		expect(rec.interimResults).toBe(true);
		expect(rec.maxAlternatives).toBe(3);
		expect(rec.start).toHaveBeenCalledTimes(1);
	});

	it("streams interim results through cleanTranscript", async () => {
		const { startDictation } = await loadSpeech();
		const o = opts();
		startDictation(o);
		const rec = recInstances[0]!;

		rec.onresult!({
			resultIndex: 0,
			results: [
				{
					isFinal: false,
					length: 1,
					0: { transcript: "faculties for ", confidence: 0.5 },
				},
			],
		});

		expect(o.onInterim).toHaveBeenCalledWith("Facilities for ");
	});

	it("picks the highest-confidence alternative for final results", async () => {
		const { startDictation } = await loadSpeech();
		const o = opts();
		startDictation(o);
		const rec = recInstances[0]!;

		rec.onresult!({
			resultIndex: 0,
			results: [
				{
					isFinal: true,
					length: 2,
					0: { transcript: "faculties", confidence: 0.4 },
					1: { transcript: "facilities", confidence: 0.9 },
				},
			],
		});

		expect(o.onFinal).toHaveBeenCalledWith("Facilities ");
	});

	it("skips missing results and respects resultIndex", async () => {
		const { startDictation } = await loadSpeech();
		const o = opts();
		startDictation(o);
		const rec = recInstances[0]!;

		// results[0] missing (undefined) → skipped; final at index 1 processed;
		// resultIndex 1 means index 0 is never visited anyway
		rec.onresult!({
			resultIndex: 1,
			results: [
				undefined as any,
				{
					isFinal: true,
					length: 1,
					0: { transcript: "home work", confidence: 0.8 },
				},
			],
		});

		expect(o.onInterim).toHaveBeenCalledWith("");
		expect(o.onFinal).toHaveBeenCalledWith("Homework ");
	});

	it("emits an empty interim when there are no results", async () => {
		const { startDictation } = await loadSpeech();
		const o = opts();
		startDictation(o);
		const rec = recInstances[0]!;

		rec.onresult!({ resultIndex: 0, results: [] });

		expect(o.onInterim).toHaveBeenCalledWith("");
		expect(o.onFinal).not.toHaveBeenCalled();
	});

	it("skips a final result that has no alternatives", async () => {
		const { startDictation } = await loadSpeech();
		const o = opts();
		startDictation(o);
		const rec = recInstances[0]!;

		// defensive path: a final result with zero alternatives is skipped,
		// no onFinal chunk is emitted, interim is still refreshed
		rec.onresult!({ resultIndex: 0, results: [{ isFinal: true, length: 0 }] });

		expect(o.onFinal).not.toHaveBeenCalled();
		expect(o.onInterim).toHaveBeenCalledWith("");
	});

	it("falls back to navigator.language when no lang option is given", async () => {
		const { startDictation } = await loadSpeech();
		startDictation({
			onInterim: vi.fn(),
			onFinal: vi.fn(),
			onEnd: vi.fn(),
			onError: vi.fn(),
		});
		expect(recInstances[0]!.lang).toBe(navigator.language || "en-US");
	});

	it("falls back to en-US when both lang and navigator.language are missing", async () => {
		Object.defineProperty(navigator, "language", {
			value: "",
			configurable: true,
		});
		const { startDictation } = await loadSpeech();
		startDictation({
			onInterim: vi.fn(),
			onFinal: vi.fn(),
			onEnd: vi.fn(),
			onError: vi.fn(),
		});
		expect(recInstances[0]!.lang).toBe("en-US");
		delete (navigator as any).language;
	});

	it("skips undefined results mid-stream and keeps later interim text", async () => {
		const { startDictation } = await loadSpeech();
		const o = opts();
		startDictation(o);
		const rec = recInstances[0]!;

		rec.onresult!({
			resultIndex: 0,
			results: [
				undefined as any,
				{
					isFinal: false,
					length: 1,
					0: { transcript: "class room", confidence: 0.5 },
				},
			],
		});

		expect(o.onInterim).toHaveBeenCalledWith("Classroom");
	});

	it("keeps the first alternative when no other has higher confidence", async () => {
		const { startDictation } = await loadSpeech();
		const o = opts();
		startDictation(o);
		const rec = recInstances[0]!;

		rec.onresult!({
			resultIndex: 0,
			results: [
				{
					isFinal: true,
					length: 2,
					0: { transcript: "home work", confidence: 0.8 },
					1: { transcript: "classroom", confidence: 0.4 },
				},
			],
		});

		// 0.4 is not > 0.8 → the first alternative wins → 'Homework '
		expect(o.onFinal).toHaveBeenCalledWith("Homework ");
	});

	it("tolerates a missing secondary alternative", async () => {
		const { startDictation } = await loadSpeech();
		const o = opts();
		startDictation(o);
		const rec = recInstances[0]!;

		rec.onresult!({
			resultIndex: 0,
			results: [
				{
					isFinal: true,
					length: 2,
					0: { transcript: "time table", confidence: 0.7 },
					1: undefined as any,
				},
			],
		});

		expect(o.onFinal).toHaveBeenCalledWith("Timetable ");
	});

	it("ignores an interim result with no first alternative", async () => {
		const { startDictation } = await loadSpeech();
		const o = opts();
		startDictation(o);
		const rec = recInstances[0]!;

		rec.onresult!({
			resultIndex: 0,
			results: [{ isFinal: false, length: 1, 0: undefined as any }],
		});

		expect(o.onInterim).toHaveBeenCalledWith("");
	});

	it.each([
		[
			"not-allowed",
			"Microphone access denied. Allow the mic permission and try again.",
		],
		["no-speech", "No speech detected — speak clearly near the microphone."],
		["audio-capture", "No microphone found on this device."],
		["network", "Speech service unreachable — check your connection."],
		["gibberish", "Speech error: gibberish"],
	])("maps the %s error event", async (error, expected) => {
		const { startDictation } = await loadSpeech();
		const o = opts();
		startDictation(o);
		const rec = recInstances[0]!;

		rec.onerror!({ error });

		expect(o.onError).toHaveBeenCalledWith(expected);
	});

	it("does not report an aborted error", async () => {
		const { startDictation } = await loadSpeech();
		const o = opts();
		startDictation(o);
		const rec = recInstances[0]!;

		rec.onerror!({ error: "aborted" });

		expect(o.onError).not.toHaveBeenCalled();
	});

	it("auto-restarts on end until the user stops", async () => {
		const { startDictation } = await loadSpeech();
		const o = opts();
		const session = startDictation(o)!;
		const rec = recInstances[0]!;

		rec.onend!();
		expect(rec.start).toHaveBeenCalledTimes(2);
		expect(o.onEnd).not.toHaveBeenCalled();

		session.stop();
		expect(rec.stop).toHaveBeenCalledTimes(1);

		rec.onend!();
		expect(o.onEnd).toHaveBeenCalledTimes(1);
		expect(rec.start).toHaveBeenCalledTimes(2); // no restart after stop
	});

	it("falls through to onEnd when the auto-restart start() throws", async () => {
		const { startDictation } = await loadSpeech();
		const o = opts();
		startDictation(o);
		const rec = recInstances[0]!;

		rec.start.mockImplementationOnce(() => {
			throw new Error("boom");
		});
		rec.onend!();

		expect(o.onEnd).toHaveBeenCalledTimes(1);
	});

	it("stop() swallows recognition errors", async () => {
		const { startDictation } = await loadSpeech();
		const o = opts();
		const session = startDictation(o)!;
		const rec = recInstances[0]!;

		rec.stop.mockImplementation(() => {
			throw new Error("boom");
		});

		expect(() => session.stop()).not.toThrow();
	});

	it("reports an error and returns null when start() fails", async () => {
		defineRecCtor(() => {
			const inst = makeRec();
			inst.start = vi.fn(() => {
				throw new Error("denied");
			});
			return inst;
		});
		const { startDictation } = await loadSpeech();
		const o = opts();

		const session = startDictation(o);

		expect(session).toBeNull();
		expect(o.onError).toHaveBeenCalledWith("Could not start the microphone.");
	});

	it("returns null and reports when SpeechRecognition is unavailable", async () => {
		Object.defineProperty(window, "webkitSpeechRecognition", {
			writable: true,
			configurable: true,
			value: undefined,
		});
		Object.defineProperty(window, "SpeechRecognition", {
			writable: true,
			configurable: true,
			value: undefined,
		});
		const { startDictation, speechSupported } = await loadSpeech();
		const o = opts();

		const session = startDictation(o);

		expect(speechSupported).toBe(false);
		expect(session).toBeNull();
		expect(o.onError).toHaveBeenCalledWith(
			"Speech recognition is not supported in this browser. Try Chrome or Edge.",
		);
	});
});
