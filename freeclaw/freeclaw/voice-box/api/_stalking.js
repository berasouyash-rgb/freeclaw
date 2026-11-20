// Stalking / intimidation detection — shared by the moderation gate and the
// automatic priority scale.
//
// Why a separate module: these statements name no weapon and no verb of
// violence ("i know your name", "i know where you live", "i'm watching you"),
// so the violence/threat/coercion gates never matched them. They published
// untouched, landed as priority "low", and the safety sentinel did not even
// quarantine them. The same signal has to drive both the block/hold decision
// and the priority, or the two drift apart — so it lives here, dependency-free
// (no db client, safe to import from any layer or test).
//
// Each claim pattern requires the AUTHOR'S first-person claim to know, follow
// or watch a specific "you". Ordinary sentences ("i know your name is on the
// exam sheet") stay clean, because the claim continues into a description
// instead of standing as surveillance.
export const STALKING_PATTERNS = [
	// "i know your name / address / room / schedule / route". The trailing
	// guard keeps descriptive sentences ("i know your name is on the list")
	// clean: a claim that ends the clause is surveillance, one that continues
	// into a description of the thing is not.
	/\bi\s+(?:already\s+)?know\s+(?:your|ur)\s+(?:full\s+|real\s+)?(?:name|address|house|home|hostel|room|class|section|schedule|timetable|route|number|stop)\b(?!\s+(?:is|was|are|were|will|would|and|but|too|also)\b)/i,
	// "i know where you live / stay / sit / sleep / study / work"
	/\bi\s+know\s+where\s+(?:you|u|ya)\s+(?:live|stay|sit|sleep|study|work|eat)\b/i,
	// "i'm watching you" / "i am always watching you"
	/\bi(?:'m| am|m)\s+(?:always\s+|still\s+)?(?:watching|following|tracking)\s+(?:you|u)\b/i,
	// "watching your every move" / "i know your every move"
	/\b(?:watching|tracking)\s+(?:your|ur)\s+every\s+move\b|\bi\s+know\s+(?:your|ur)\s+every\s+move\b/i,
	// "i will follow / find / track / hunt you (home)"
	/\bi(?:'ll| will|m gonna| am gonna| am going to|'m going to)\s+(?:follow|find|track|hunt)\s+(?:you|u)\b/i,
	// "you can't hide from me" / "don't try to hide from me"
	/\b(?:you|u)\s+(?:can'?t|cannot|won'?t)\s+hide\s+from\s+me\b|\b(?:don'?t|do\s+not)\s+(?:try\s+to\s+|even\s+try\s+to\s+)?(?:hide|run)\s+from\s+me\b/i,
	// "i will never leave you alone" / "i won't let you go"
	/\bi(?:'ll| will)\s+never\s+(?:leave\s+you\s+alone|let\s+you\s+go)\b/i,
	// Hinglish: "main tumhe dekh raha hoon", "tumhe dhoondh lunga",
	// "mujhe pata hai tum kahan rehte ho"
	/\b(?:main|mein)\s+(?:tumhe|tumhey|tujhe|tujhey)\s+(?:dekh|dekht?)\s*rah[ai]\s*h(?:oon|u)?\b/i,
	/\b(?:tumhe|tumhey|tujhe|tujhey)\s+(?:dhoondh?|dhundh?|dhund)\s*(?:lunga|loonga|lungi)\b/i,
	/\b(?:mujhe|muje)\s+pata\s+hai\s+(?:tum|tu)\s+kahan\b/i,
];

// The other half of the same behaviour: a VICTIM describing it ("my senior
// keeps following me", "he is watching me"). Held for human review, never
// blocked — a report must survive — and never published unreviewed.
export const STALK_VICTIM_RE =
	/\b(?:being\s+(?:followed|watched|stalked|tracked)|(?:follow|watch|track|stalk)(?:s|es|ed|ing)\s+me\b|keeps?\s+(?:following|watching|tracking|texting|messaging)\s+me)\b/i;

// "he said …", "she keeps …" — the claim is QUOTED, so it is a report even
// when the words themselves trip a first-person pattern.
export const STALK_REPORT_FRAME =
	/\b(?:he|she|they|someone|somebody|this\s+(?:guy|person|boy|girl|man|senior)|my\s+(?:senior|classmate|batchmate|friend))\b[^.!?]{0,60}\b(?:said|says|saying|told|tells?|texted|texts?|messaged|messages?|wrote|writes|threatened|threatens?|keeps?|started|is\s+always|has\s+been)\b/i;

const isText = (text) => typeof text === "string" && text.length > 0;

/** True when text carries a stalking/intimidation signal (claim or report). */
export function hasStalkingSignal(text) {
	if (!isText(text)) return false;
	return STALKING_PATTERNS.some((re) => re.test(text)) || STALK_VICTIM_RE.test(text);
}

/**
 * Moderation flags for stalking/intimidation.
 * A claim by the author blocks (critical); a quoted claim or a victim's own
 * description is held for review (high, never blocking). `threatCtx` is the
 * shared threat classifier's verdict (`"reported_threat"` = quoted threat).
 */
export function stalkingFlags(text, threatCtx = "clean") {
	if (!isText(text)) return [];
	const claim = STALKING_PATTERNS.some((re) => re.test(text));
	const victim = STALK_VICTIM_RE.test(text);
	if (!claim && !victim) return [];
	const quoted =
		victim || STALK_REPORT_FRAME.test(text) || threatCtx === "reported_threat";
	if (quoted) {
		return [
			{
				type: "stalking_report",
				severity: "high",
				message: "Possible stalking/intimidation report — needs review",
			},
		];
	}
	return [
		{
			type: "stalking",
			severity: "critical",
			message: "Stalking or intimidation detected",
		},
	];
}
