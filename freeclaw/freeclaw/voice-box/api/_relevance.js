// ═══════════════════════════════════════════════════════════════════
// RELEVANCE — is this an actionable school problem, or noise?
// ═══════════════════════════════════════════════════════════════════
// THE PROBLEM THIS SOLVES
//
//   "the AC is not working"        → a real, fixable school problem
//   "my fate is not coming to me"  → not something a school can act on
//
// Without this, a school's inbox fills with fatalism, venting and
// off-topic posts, and the genuinely fixable items get buried. That is
// a real cost, and it is what this layer exists to reduce.
//
// WHAT IT IS NOT
//
// It is NOT a gate. It never blocks, never rejects, and never changes
// what gets stored. Every verdict is advisory, the author always sees
// WHY, and the author can always post anyway. Students write in Hinglish,
// abbreviations and run-on sentences about problems we have never seen;
// a confident machine verdict that silences a real complaint is a far
// worse failure than a noisy inbox. So the scoring below is deliberately
// biased toward "unclear" — an honest "I can't tell" — never toward
// "reject".
//
// WHY NOT A MODEL
//
// This runs on every debounce while the student types. A provider call
// would put a spinner in front of every keystroke and make the verdict
// non-reproducible. It is deterministic, explains itself with the exact
// text it matched, and costs microseconds. The model layer, where it
// exists, sits above this and is not consulted here.
//
// EXTENDING IT
//
// Add vocabulary, never add verdict rules. Every entry is a curated,
// word-boundary pattern; the four buckets (context / problem / distress /
// off-topic) and the verdict ladder are what make the output
// explainable. Substring matching is never used — this repo already
// learned that lesson: a naive matcher fires on "class" and "grass" when
// looking for "ass".

export const POLICY_VERSION = "relevance-v1";

/** A school setting or institution is mentioned. */
const SCHOOL_CONTEXT = [
	{
		id: "classroom",
		label: "a classroom",
		re: /\b(?:class(?:room|es|rooms)?|lecture hall|period)\b/i,
	},
	{
		id: "institution",
		label: "the school itself",
		re: /\b(?:school|college|campus|institution|institute|academy|university)\b/i,
	},
	{
		id: "staff",
		label: "a staff member",
		re: /\b(?:teacher|teachers|sir|ma'?am|madam|professor|principal|headmaster|headmistress|staff|faculty|warden|peon|watchman|counsel+?or|counsellor|nurse)\b/i,
	},
	{
		id: "academic",
		label: "academics",
		re: /\b(?:exam|exams|test|tests|homework|assignment|assignments|syllabus|timetable|marks|grades?|results?|admission|fees?|scholarship|semester|term|practical|viva|revision|unit test)\b/i,
	},
	{
		id: "facilities",
		label: "a school facility",
		re: /\b(?:bench(?:es)?|desks?|chairs?|blackboard|whiteboard|projector|fans?|ac|a\/c|aircon|air ?condition(?:er|ing|ed)?|cooler|water ?cooler|drinking water|taps?|sinks?|toilets?|washrooms?|restrooms?|bathrooms?|urinals?|corridors?|staircases?|stairs|roof|ceiling|walls?|floors?|windows?|doors?|lights?|bulbs?|tube ?lights?|electricity|power|sockets?|switch(?:es)?|plugs?|wifi|wi-fi|internet|computers?|printers?|canteen|cafeteria|mess|hostel|dormitor(?:y|ies)|playground|ground|field|garden|gate|parking|bus|buses|van|transport|lift|elevator|lockers?|uniform|bags?|books?|notebooks?|stationery|mid[- ]?day meal|library|labs?|laborator(?:y|ies))\b/i,
	},
	{
		id: "people",
		label: "students",
		re: /\b(?:students?|pupils?|classmates?|seniors?|juniors?|batchmates?)\b/i,
	},
	{
		id: "relative",
		label: "our own class/school/bus",
		re: /\b(?:in|at|on) (?:my|our) (?:class|school|college|hostel|bus|canteen|lab|library|floor|block|section)\b/i,
	},
];

/** Something is actually wrong — the actionable half of a problem. */
const PROBLEM = [
	{
		id: "malfunction",
		label: "something is broken or not working",
		re: /\b(?:not|isn'?t|aren'?t|doesn'?t|don'?t|won'?t|stopped|failed)\s+(?:work(?:ing|s)?|function(?:ing|s)?|operat(?:e|es|ing)|cool(?:ing)?|heat(?:ing)?)\b/i,
	},
	{
		id: "damaged",
		label: "damaged or faulty equipment",
		re: /\b(?:broken|damaged?|dented|cracked|shattered|torn|leaking|leaks?|leaking|leaked|rusted|blocked|choked|clogged|jammed|stuck|knocked out|out of order|not in (?:use|service)|dysfunctional|faulty)\b/i,
	},
	{
		id: "unclean",
		label: "cleanliness or hygiene",
		re: /\b(?:dirty|unclean|filthy|smelly|stinks?|stinking|untidy|messy|garbage|trash|waste|never (?:been )?clean(?:ed)?|not clean(?:ed)?|dusty|mosquit(?:o|es)|rodents?|cockroach(?:es)?|rats?|insects?|mould|mold)\b/i,
	},
	{
		id: "shortage",
		label: "a shortage of something needed",
		re: /\b(?:no|not enough|short(?:age)? of|lack(?:ing|s)? of|insufficient|less)\s+(?:water|electricity|power|light|fans?|chairs?|desks?|benches?|books?|teachers?|staff|computers?|toilets?|washrooms?|buses?|space|seats?|funds?|money|time)\b/i,
	},
	{
		id: "condition",
		label: "uncomfortable or unsafe conditions",
		re: /\b(?:too (?:hot|cold|crowded|noisy|dusty|dirty|dark)|humid|stuffy|unsafe|dangerous|hazard|overflowing|flooded)\b/i,
	},
	{
		id: "availability",
		label: "something expected was not available",
		re: /\b(?:unavailable|not available|missing|absent|closed|cancell?ed|postponed|delayed|denied|refused)\b/i,
	},
	{
		// "the library closes too early during exam week" is one of the most
		// common real complaints and reads nothing like "broken", so it needs
		// its own bucket rather than being folded into availability.
		id: "timing",
		label: "timing that does not work for students",
		re: /\b(?:too (?:early|late|short|long|quick|brief)|closes? too|opens? too|not enough (?:time|break|breaks)|no (?:break|breaks)|shorter (?:break|breaks|periods?|lunch))\b/i,
	},
	{
		id: "conduct",
		label: "how someone behaved",
		re: /\b(?:rude|misbehav(?:e|ed|ing|iour|ior)|shout(?:ed|ing|s)?|abus(?:e|ed|ing|ive)|bull(?:y|ied|ies|ying)|harass(?:ed|ing|ment)?|threaten(?:ed|ing)?|discriminat(?:e|ed|ing|ion)|unfair(?:ly)?|biased|ignored|neglect(?:ed|ing)?)\b/i,
	},
	{
		id: "request",
		label: "a request to fix or change something",
		re: /\b(?:please|kindly|request(?:ing|ed)?|needs? to be|should be|must be|fix|repair|replace|install|clean|improve|increase|reduce|provide|arrange)\b/i,
	},
	// Romanised Hinglish. Students write real complaints this way far more
	// often than in formal English ("sir, class ka fan kharab hai"), and a
	// layer that only reads English would call every one of them "unclear".
	// These are whole words, never substrings.
	{
		id: "hinglish_malfunction",
		label: "something is broken or not working",
		re: /\b(?:kharab|kharaab|toot(?:a|i|gaya)|kaam nahi kar(?:ta|ti|raha|rahi)?|chal nahi raha|band (?:hai|pada))\b/i,
	},
	{
		id: "hinglish_unclean",
		label: "cleanliness or hygiene",
		re: /\b(?:ganda|gandi|gandagi|safai nahi|safai theek nahi|badbu)\b/i,
	},
	{
		id: "hinglish_shortage",
		label: "a shortage of something needed",
		re: /\b(?:paani|pani|bijli|pankha|khana|kursi|bench)\s+(?:nahi|nhi)\b/i,
	},
];

/**
 * Someone may be in crisis. This bucket WINS over every other judgement:
 * relevance is not ours to decide when a student is telling us they are
 * not safe. The caller routes these to support, never to a verdict.
 */
const DISTRESS = [
	{
		id: "self_harm",
		label: "a possible crisis",
		re: /\b(?:suicide|suicidal|kill (?:my ?self|me)|end (?:my|it) (?:life|all)|self[- ]?harm|hurt(?:ing)? my ?self|cut(?:ting)? my ?self|want(?:ed)? to die|wanna die|better off dead|no reason to live|can'?t go on|give up on life|hopeless|worthless|depress(?:ed|ion)|anxiety|panic attack|nobody (?:loves|cares about) me)\b/i,
	},
];

/** Off-topic for a school: fatalism, romance, entertainment, venting. */
const OFF_TOPIC = [
	{
		id: "fatalism",
		label: "fate or luck, which a school cannot act on",
		re: /\b(?:fate|destiny|kismat|kismet|bhagya|naseeb|horoscope|astrolog(?:y|er)|zodiac|luck|unlucky|lucky|karma|cursed|curse)\b/i,
	},
	{
		id: "romance",
		label: "romance or personal relationships",
		re: /\b(?:crush|girl ?friend|boy ?friend|love|propos(?:e|al)|dating|married|marriage|break ?up|flirt|relationship)\b/i,
	},
	{
		id: "entertainment",
		label: "entertainment or games",
		re: /\b(?:movie|film|actor|actress|celebrity|cricket match|netflix|instagram|tiktok|reels?|pubg|free ?fire|minecraft|video game)\b/i,
	},
];

/** Verdicts. `unclear` is the honest fallback, never an accusation. */
export const VERDICTS = ["school_problem", "unclear", "not_school_related"];
/** Advisory route for the caller. None of these block anything. */
export const ROUTES = ["post", "post_with_note", "support"];

/** Run a bucket, returning the patterns that matched, with their evidence. */
function matchBucket(text, bucket) {
	const hits = [];
	for (const entry of bucket) {
		const m = entry.re.exec(text);
		if (m) {
			hits.push({
				signal: entry.id,
				label: entry.label,
				// The EXACT text matched, so the UI can show the student what
				// it reacted to instead of a vague "our AI thought…".
				evidence: String(m[0]).slice(0, 60),
			});
		}
	}
	return hits;
}

/**
 * Heuristics, not truth. Published with every verdict so the UI can be
 * honest about what this can and cannot see.
 */
export const LIMITS = [
	"Reads wording only — it cannot know your school's context.",
	"Understands English and common Hinglish words, not every language.",
	"It is advice, not a rule: you can always post.",
];

/**
 * Assess how actionable a submission is as a school problem.
 *
 * @param {string} rawText
 * @returns {{
 *   policyVersion: string,
 *   verdict: string,
 *   route: string,
 *   confidence: string,
 *   schoolHits: object[], problemHits: object[], distressHits: object[],
 *   offTopicHits: object[],
 *   reasons: object[],
 *   explanation: string,
 *   askUserToConfirm: boolean,
 *   limits: string[],
 * }}
 */
export function assessRelevance(rawText) {
	const text = String(rawText || "").slice(0, 8000);

	const schoolHits = matchBucket(text, SCHOOL_CONTEXT);
	const problemHits = matchBucket(text, PROBLEM);
	const distressHits = matchBucket(text, DISTRESS);
	const offTopicHits = matchBucket(text, OFF_TOPIC);

	const hasSchool = schoolHits.length > 0;
	const hasProblem = problemHits.length > 0;

	let verdict;
	let route;
	let confidence;
	let explanation;

	if (distressHits.length > 0) {
		// Never judge relevance when someone may be unsafe. Hand it to the
		// support path and say so plainly.
		verdict = "unclear";
		route = "support";
		confidence = "low";
		explanation =
			"This might be about how you are feeling rather than a school issue. Support is available, and you can still post this.";
	} else if (hasProblem && hasSchool) {
		verdict = "school_problem";
		route = "post";
		confidence = schoolHits.length + problemHits.length >= 3 ? "high" : "medium";
		explanation =
			"This reads like a specific school problem someone can act on. Posting it as-is gives staff what they need.";
	} else if (hasProblem && !hasSchool) {
		verdict = "unclear";
		route = "post_with_note";
		confidence = "low";
		explanation =
			"There is a problem here, but no school place or person is named. Adding where it is would help staff act on it.";
	} else if (hasSchool && !hasProblem) {
		verdict = "unclear";
		route = "post_with_note";
		confidence = "low";
		explanation =
			"This mentions school, but not yet what is wrong. Saying what you want fixed makes it actionable.";
	} else if (offTopicHits.length > 0) {
		verdict = "not_school_related";
		route = "post_with_note";
		confidence = "medium";
		explanation =
			"We could not find anything a school can act on here. If this is a personal matter, it may fit better elsewhere — but posting it is your call.";
	} else {
		verdict = "unclear";
		route = "post_with_note";
		confidence = "low";
		explanation =
			"We could not tell whether this is a school issue. You can post it anyway, or add what is wrong and where.";
	}

	return {
		policyVersion: POLICY_VERSION,
		verdict,
		route,
		confidence,
		schoolHits,
		problemHits,
		distressHits,
		offTopicHits,
		// Flat, evidence-carrying list — this is what the UI renders.
		reasons: [
			...distressHits.map((h) => ({ kind: "distress", ...h })),
			...problemHits.map((h) => ({ kind: "problem", ...h })),
			...schoolHits.map((h) => ({ kind: "school", ...h })),
			...offTopicHits.map((h) => ({ kind: "off_topic", ...h })),
		],
		explanation,
		// Only an unqualified "this is a school problem" skips the prompt.
		// Everything else invites the student to double-check — an invitation,
		// never a requirement, and never a rejection.
		askUserToConfirm: verdict !== "school_problem",
		limits: LIMITS,
	};
}

/** One-line summary for logs and admin surfaces. */
export function summarizeRelevance(result) {
	if (!result) return "unknown";
	return `${result.verdict}/${result.confidence}`;
}
