/**
 * Optimized speech-to-text built on the Web Speech API.
 * - continuous dictation with interim (live) results
 * - domain vocabulary correction: common mis-hearings are auto-fixed
 *   (e.g. "faculties" → "facilities", "canteen" variants, school terms)
 * - punctuation voice commands ("comma", "full stop", "new line")
 */

// Web Speech API vendor-prefixed interface — not in all TS DOM typings.
interface SpeechRecognitionLike {
	new (): SpeechRecognitionInstance;
}
interface SpeechRecognitionInstance {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	maxAlternatives: number;
	onresult: ((e: SpeechRecognitionEventLike) => void) | null;
	onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
}
interface SpeechRecognitionEventLike {
	resultIndex: number;
	results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionResultListLike {
	length: number;
	[index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionResultLike {
	isFinal: boolean;
	length: number;
	[index: number]: { transcript: string; confidence: number };
}
interface SpeechRecognitionErrorEventLike {
	error: string;
}
interface WindowWithSR {
	SpeechRecognition?: SpeechRecognitionLike;
	webkitSpeechRecognition?: SpeechRecognitionLike;
}

const SR: SpeechRecognitionLike | undefined =
	(window as unknown as WindowWithSR).SpeechRecognition ??
	(window as unknown as WindowWithSR).webkitSpeechRecognition;

export const speechSupported = !!SR;

/** Domain dictionary — fixes frequent recognition errors for school vocabulary */
const CORRECTIONS: [RegExp, string][] = [
	[/\bfaculties\b/gi, "facilities"],
	[/\bfacility's\b/gi, "facilities"],
	[/\bcan teen\b/gi, "canteen"],
	[/\bcant een\b/gi, "canteen"],
	[/\bwi[- ]?fi\b/gi, "Wi-Fi"],
	[/\bwhy fi\b/gi, "Wi-Fi"],
	[/\bwifey\b/gi, "Wi-Fi"],
	[/\bhostile\b/gi, "hostel"],
	[/\bhostal\b/gi, "hostel"],
	[/\bliberary\b/gi, "library"],
	[/\blibary\b/gi, "library"],
	[/\bprinciple\b/gi, "principal"],
	[/\bbulling\b/gi, "bullying"],
	[/\bbullies?\s+ing\b/gi, "bullying"],
	[/\bwash room\b/gi, "washroom"],
	[/\bbath room\b/gi, "bathroom"],
	[/\bclass room\b/gi, "classroom"],
	[/\bhome work\b/gi, "homework"],
	[/\btime table\b/gi, "timetable"],
	[/\bplay ground\b/gi, "playground"],
	[/\bnote books?\b/gi, "notebook"],
	[/\bwater cooler\b/gi, "water cooler"],
	[/\bac\b/g, "AC"],
	[/\bev ents\b/gi, "events"],
];

/** Spoken punctuation commands */
const PUNCTUATION: [RegExp, string][] = [
	[/\b(full stop|period)\b/gi, "."],
	[/\bcomma\b/gi, ","],
	[/\bquestion mark\b/gi, "?"],
	[/\bexclamation (mark|point)\b/gi, "!"],
	[/\bnew line\b/gi, "\n"],
	[/\bnew paragraph\b/gi, "\n\n"],
];

export function cleanTranscript(raw: string): string {
	let text = raw;
	for (const [re, sub] of PUNCTUATION) text = text.replace(re, sub);
	for (const [re, sub] of CORRECTIONS) text = text.replace(re, sub);
	// tidy spacing around punctuation
	text = text
		.replace(/\s+([.,?!])/g, "$1")
		.replace(/([.,?!])(?=[A-Za-z])/g, "$1 ");
	// capitalize sentence starts
	text = text.replace(
		/(^|[.?!]\s+)([a-z])/g,
		(_, pre, ch) => pre + ch.toUpperCase(),
	);
	return text;
}

export interface SpeechSession {
	stop: () => void;
}

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

export function startDictation(opts: {
	lang?: string;
	onInterim: (text: string) => void; // live partial text
	onFinal: (text: string) => void; // corrected final chunk
	onEnd: () => void;
	onError: (message: string) => void;
}): SpeechSession | null {
	if (!SR) {
		opts.onError(
			"Speech recognition is not supported in this browser. Try Chrome or Edge.",
		);
		return null;
	}

	const rec = new SR();
	rec.lang = opts.lang || navigator.language || "en-US";
	rec.continuous = true;
	rec.interimResults = true;
	rec.maxAlternatives = 3; // we pick the best-scoring alternative

	let stopped = false;
	// Restart-loop guard: fatal conditions (mic denied, no device) fire
	// onerror → onend → rec.start() immediately, which re-raises the same
	// error forever and spams the UI with toasts. Track consecutive rapid
	// restarts and give up after the limit; a genuinely healthy long session
	// never hits this because successful runs reset the counter.
	const MAX_CONSECUTIVE_RESTARTS = 5;
	const RESTART_WINDOW_MS = 10_000;
	let restartTimes: number[] = [];
	const fatalErrors = new Set(["not-allowed", "audio-capture", "service-not-allowed"]);

	rec.onresult = (e: SpeechRecognitionEventLike) => {
		let interim = "";
		for (let i = e.resultIndex; i < e.results.length; i++) {
			const result = e.results[i];
			if (!result) continue;
			if (result.isFinal) {
				// choose highest-confidence alternative
				let best = result[0];
				if (!best) continue;
				for (let a = 1; a < result.length; a++) {
					const alt = result[a];
					if (alt && alt.confidence > best.confidence) best = alt;
				}
				opts.onFinal(cleanTranscript(best.transcript.trim()) + " ");
			} else {
				const first = result[0];
				if (first) interim += first.transcript;
			}
		}
		opts.onInterim(cleanTranscript(interim));
	};

	rec.onerror = (e: SpeechRecognitionErrorEventLike) => {
		const map: Record<string, string> = {
			"not-allowed":
				"Microphone access denied. Allow the mic permission and try again.",
			"no-speech": "No speech detected — speak clearly near the microphone.",
			"audio-capture": "No microphone found on this device.",
			network: "Speech service unreachable — check your connection.",
		};
		if (e.error !== "aborted")
			opts.onError(map[e.error] || `Speech error: ${e.error}`);
		if (fatalErrors.has(e.error)) stopped = true;
	};

	rec.onend = () => {
		// auto-restart on silence gaps unless the user pressed stop
		if (!stopped) {
			const now = Date.now();
			restartTimes = restartTimes.filter((t) => now - t < RESTART_WINDOW_MS);
			if (restartTimes.length >= MAX_CONSECUTIVE_RESTARTS) {
				stopped = true;
				opts.onError(
					"Dictation kept stopping — tap the mic button to start again.",
				);
				opts.onEnd();
				return;
			}
			restartTimes.push(now);
			try {
				rec.start();
				return;
			} catch {
				/* fallthrough */
			}
		}
		opts.onEnd();
	};

	try {
		rec.start();
	} catch {
		opts.onError("Could not start the microphone.");
		return null;
	}

	return {
		stop: () => {
			stopped = true;
			try {
				rec.stop();
			} catch {
				/* noop */
			}
		},
	};
}
