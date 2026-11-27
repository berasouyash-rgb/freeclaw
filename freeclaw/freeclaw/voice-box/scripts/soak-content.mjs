// ═══════════════════════════════════════════════════════════════════
// SOAK CONTENT — the complaint corpus, in one place, and verifiable
// ═══════════════════════════════════════════════════════════════════
// The lifecycle soak (scripts/soak-complaints.mjs) submits ONLY ordinary
// staff-conduct complaints, because that is the exact content the release
// claims is no longer mislabelled as "a report of abuse". Generating that
// text inline in the harness made the claim untestable in isolation, so the
// corpus lives here and scripts/verify-soak-content.mjs replays it against
// the REAL predicate (api/_context-moderation.js) before any load is run.
//
// Every generated submission must satisfy four independent guards:
//
//   1. isStaffComplaint(title + " " + description) === true
//        a staff noun + an OPINION_ADJ word, with no HARM_VERB and no
//        SECOND_PERSON_MENACE. This is the predicate that decides "this is
//        educational feedback, not a report of abuse"; text that fails it
//        would make the soak exercise something other than the reported bug.
//        The opinion phrases below are drawn ONLY from OPINION_ADJ vocabulary
//        — inventing near-synonyms ("dismissive", "unhelpful") silently
//        breaks the predicate, which is how the previous corpus drifted.
//   2. isTestArtifact(title) === false
//        so the server does not accept a row and then hide it from every
//        surface (the artifact filter would make a passing run look clean
//        while the feed stayed empty).
//   3. title uniqueness across the whole run
//        so POST /api/posts never answers 200 {deduped:true}. The duplicate
//        rule is same-author-only, but unique titles also keep the spam
//        fingerprint map and the reviewer cache cold — which is what real
//        first-time complainant traffic looks like.
//   4. no weak-PII shapes (PIN codes, room numbers, addresses)
//        so privacy_weak never holds content that contains no private
//        information.
//
// Titles are derived from a mixed-radix decode over four dimensions, so the
// addressable space is the PRODUCT of the pool lengths (≫ 5,000) and every
// index inside it yields a distinct title. Description frames are rotated
// independently so the text does not read as 5,000 copies of one template
// (which would also inflate the spam similarity score).
// ═══════════════════════════════════════════════════════════════════

/** Staff descriptions — each contains a token matched by STAFF_NOUN. */
const STAFF = [
	"Kakuli mam",
	"our class teacher",
	"the physics teacher",
	"the maths teacher",
	"the chemistry teacher",
	"our English teacher",
	"the sports coach",
	"the lab instructor",
	"the biology teacher",
	"the history teacher",
	"our form teacher",
	"the computer teacher",
	"the Hindi teacher",
	"our games coach",
	"the class incharge",
	"the vice principal",
	"the headmistress",
	"the principal",
	"our hostel warden",
	"the counsellor",
	"the music teacher",
	"the art teacher",
	"the geography teacher",
	"the senior lecturer",
];

/** Opinion phrases — every one contains a word from OPINION_ADJ. */
const OPINION = [
	"very rude",
	"unfair",
	"openly biased",
	"quite lazy",
	"extremely strict",
	"pretty arrogant",
	"rather disrespectful",
	"totally unprofessional",
	"really annoying",
	"very boring",
	"always shouting",
	"constantly yelling",
	"completely useless",
	"fairly incompetent",
	"clearly partial",
	"quite negligent",
	"highly irresponsible",
	"a bit weird",
	"so mean",
	"plain toxic",
	"just pathetic",
	"downright awful",
	"honestly terrible",
	"kind of creepy",
];

/** Subject matter — all legitimate academic-feedback topics. */
const TOPIC = [
	"the revision schedule",
	"the homework load",
	"the lab instructions",
	"the exam pattern",
	"the marking scheme",
	"the project deadline",
	"the doubt-clearing session",
	"the practical record",
	"the internal assessment",
	"the extra classes",
	"the seating arrangement",
	"the question paper split",
	"the notebook correction",
	"the viva preparation",
	"the periodic test syllabus",
	"the assignment submission",
	"the class timetable",
	"the study material",
	"the monthly report",
	"the oral exam rounds",
];

/** When it happened. Kept low-cardinality and free of dates/numbers. */
const SLOT = [
	"this week",
	"last Monday",
	"before the test",
	"after lunch",
	"during period four",
	"in the morning",
	"yesterday afternoon",
	"on Friday",
	"before the assembly",
	"during the last period",
	"after the practical",
	"at the start of term",
	"during revision week",
	"before the half-day break",
	"before the holidays",
	"last Wednesday",
	"during the games hour",
	"after the unit test",
	"on the first day back",
	"throughout this term",
];

/**
 * Description frames. Rotated independently of the title tuple; each one
 * carries all four dimensions so the body is unique too. None of them
 * contains a harm verb, a menace, an accusation verb or a PII shape.
 */
const FRAMES = [
	({ staff, opinion, topic, slot }) =>
		`${cap(staff)} has been ${opinion} about ${topic} ${slot}. A few of us asked for help after the lesson and did not get a clear answer, so the class is falling behind.`,
	({ staff, opinion, topic, slot }) =>
		`I want to raise that ${staff} was ${opinion} about ${topic} ${slot}. The instructions changed twice and nobody explained why, which left the whole class guessing.`,
	({ staff, opinion, topic, slot }) =>
		`Several students feel ${staff} is ${opinion} about ${topic} ${slot}. We would appreciate a short written clarification before the next class instead of being told to manage on our own.`,
	({ staff, opinion, topic, slot }) =>
		`${cap(staff)} came across as ${opinion} about ${topic} ${slot}. Our questions were brushed aside and most of the class left confused about what to study.`,
	({ staff, opinion, topic, slot }) =>
		`Raising this politely: ${staff} was ${opinion} about ${topic} ${slot}. Please look into how that topic was handled, because the notes we received do not match what was taught.`,
	({ staff, opinion, topic, slot }) =>
		`${cap(staff)} seemed ${opinion} about ${topic} ${slot}. When we asked for the corrected notes we were told to figure it out ourselves, and that is not realistic before the test.`,
];

function cap(s) {
	const t = String(s || "");
	return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

export const POOLS = { STAFF, OPINION, TOPIC, SLOT, FRAMES };

/**
 * Number of distinct (staff, opinion, topic, slot) tuples. A run must stay
 * strictly below this or titles repeat; the verify script asserts the
 * requested user count fits.
 */
export const SPACE = STAFF.length * OPINION.length * TOPIC.length * SLOT.length;

/**
 * Deterministic complaint for a virtual user index.
 * `idx` is decoded as a mixed-radix number over the four pools, so any two
 * distinct indexes inside `[0, SPACE)` produce distinct titles.
 *
 * `staff` is the LEAST significant digit on purpose: the other three pools are
 * small, so making staff most-significant would mean a 5,000-user run submits
 * the same staff phrase every time and the other 23 forms (class teacher,
 * warden, counsellor, …) would never reach the server. Only one of them is the
 * literal "Kakuli mam" wording from the reported bug, so the run has to hit
 * all of them.
 */
export function complaintFor(idx) {
	const i = ((Math.trunc(idx) % SPACE) + SPACE) % SPACE;
	let n = i;
	const staff = STAFF[n % STAFF.length];
	n = Math.floor(n / STAFF.length);
	const opinion = OPINION[n % OPINION.length];
	n = Math.floor(n / OPINION.length);
	const topic = TOPIC[n % TOPIC.length];
	n = Math.floor(n / TOPIC.length);
	const slot = SLOT[n % SLOT.length];
	const frame = FRAMES[i % FRAMES.length];
	const title = `${cap(staff)} is ${opinion} about ${topic} ${slot}`;
	const description = frame({ staff, opinion, topic, slot });
	return { title, description, parts: { staff, opinion, topic, slot } };
}
