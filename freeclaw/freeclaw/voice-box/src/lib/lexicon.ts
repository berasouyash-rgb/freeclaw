/**
 * CLIENT MIRROR of api/_wordlists.js + api/_lexicon.js.
 *
 * The client must reach the SAME profanity/slang verdict as the server, or the
 * user gets an enabled Publish button followed by an unexplained 403. This file
 * is therefore a behavior-for-behavior port — same vocabulary, same folds
 * (de-leet, repeat collapse, interior separators, single-letter joining, NFKC,
 * invisible strip), same token-equality rule that keeps "class" from matching
 * "ass".
 *
 * DRIFT IS NOT ALLOWED TO SHIP: `tests/api/lexicon-parity.test.ts` imports both
 * this module and the server's and fails if the term sets or the match results
 * differ on a corpus. Adding an entry on one side without the other is a red
 * build, not a silent divergence.
 */

export type LexiconCategory = "profanity" | "slang";

export interface LexiconEntry {
	term: string;
	variants?: string[];
	category: LexiconCategory;
	severity: "high";
}

export interface TermHit {
	term: string;
	category: LexiconCategory;
	severity: string;
	matched: string;
	index: number;
}

/** Byte-mirror of LEXICON in api/_wordlists.js. */
export const LEXICON: LexiconEntry[] = [
	{ term: "fuck", category: "profanity", severity: "high", variants: ["fuk", "fux", "fuq", "fck", "phuck", "fook", "fukk", "fuxk", "fack"] },
	{ term: "fucking", category: "profanity", severity: "high", variants: ["fuking", "fcking", "phucking", "fukkin", "fuckin"] },
	{ term: "fucked", category: "profanity", severity: "high", variants: ["fuked", "fcked", "fukked"] },
	{ term: "fucker", category: "profanity", severity: "high", variants: ["fuker", "fckr", "fukr"] },
	{ term: "fuckers", category: "profanity", severity: "high", variants: ["fukers", "fckrs"] },
	{ term: "fucks", category: "profanity", severity: "high", variants: ["fuks", "fcks"] },
	{ term: "motherfucker", category: "profanity", severity: "high", variants: ["mothafucker", "mofucker", "motherfker"] },
	{ term: "motherfuckers", category: "profanity", severity: "high", variants: ["mothafuckers", "mofuckers"] },
	{ term: "motherfucking", category: "profanity", severity: "high", variants: ["mothafucking", "mofucking"] },
	{ term: "fuckface", category: "profanity", severity: "high" },
	{ term: "clusterfuck", category: "profanity", severity: "high" },
	{ term: "shit", category: "profanity", severity: "high", variants: ["sht", "shyt", "sheit", "shite", "shiit", "shiet"] },
	{ term: "shitting", category: "profanity", severity: "high", variants: ["shiting", "shtting"] },
	{ term: "shitty", category: "profanity", severity: "high", variants: ["shity", "shtty"] },
	{ term: "bullshit", category: "profanity", severity: "high", variants: ["bullshyt", "bullshiz"] },
	{ term: "horseshit", category: "profanity", severity: "high" },
	{ term: "dipshit", category: "profanity", severity: "high" },
	{ term: "shithead", category: "profanity", severity: "high", variants: ["shthead"] },
	{ term: "shitheads", category: "profanity", severity: "high" },
	{ term: "bitch", category: "profanity", severity: "high", variants: ["bish", "btch", "biatch", "beyotch", "beotch"] },
	{ term: "bitches", category: "profanity", severity: "high", variants: ["bishes", "btches"] },
	{ term: "bitchy", category: "profanity", severity: "high", variants: ["bitchi", "bishy"] },
	{ term: "asshole", category: "profanity", severity: "high", variants: ["ahole", "azzhole", "ashole"] },
	{ term: "assholes", category: "profanity", severity: "high", variants: ["aholes", "azzholes"] },
	{ term: "arsehole", category: "profanity", severity: "high" },
	{ term: "arseholes", category: "profanity", severity: "high" },
	{ term: "bastard", category: "profanity", severity: "high", variants: ["bstrd", "basturd", "bastid"] },
	{ term: "bastards", category: "profanity", severity: "high", variants: ["bstrds", "basturds"] },
	{ term: "cunt", category: "profanity", severity: "high", variants: ["cnt", "kunt", "kant"] },
	{ term: "cunts", category: "profanity", severity: "high", variants: ["kunts"] },
	{ term: "twat", category: "profanity", severity: "high", variants: ["twatt", "twot"] },
	{ term: "dick", category: "profanity", severity: "high", variants: ["dik", "dikk"] },
	{ term: "dicks", category: "profanity", severity: "high", variants: ["diks"] },
	{ term: "dickhead", category: "profanity", severity: "high", variants: ["dikhead", "dickhed"] },
	{ term: "dickheads", category: "profanity", severity: "high", variants: ["dikheads"] },
	{ term: "slut", category: "profanity", severity: "high", variants: ["sloot", "slutt"] },
	{ term: "sluts", category: "profanity", severity: "high", variants: ["sloots"] },
	{ term: "slutty", category: "profanity", severity: "high", variants: ["sluty", "slooty"] },
	{ term: "whore", category: "profanity", severity: "high", variants: ["hoar", "whor"] },
	{ term: "whores", category: "profanity", severity: "high", variants: ["hoars"] },
	{ term: "cock", category: "profanity", severity: "high", variants: ["cok", "kock"] },
	{ term: "cocks", category: "profanity", severity: "high", variants: ["coks"] },
	{ term: "prick", category: "profanity", severity: "high", variants: ["prik", "pric"] },
	{ term: "pussy", category: "profanity", severity: "high", variants: ["pussi", "pusy", "pussies"] },
	{ term: "wanker", category: "profanity", severity: "high", variants: ["wankr", "wankah"] },
	{ term: "wankers", category: "profanity", severity: "high", variants: ["wankrs"] },
	{ term: "tosser", category: "profanity", severity: "high", variants: ["tossers", "tossr"] },
	{ term: "retard", category: "profanity", severity: "high", variants: ["rtrd", "retrd"] },
	{ term: "retarded", category: "profanity", severity: "high", variants: ["retrdd", "rtrded", "retart"] },
	{ term: "retards", category: "profanity", severity: "high", variants: ["retrds"] },
	{ term: "bollocks", category: "profanity", severity: "high", variants: ["bollox", "bullocks"] },
	{ term: "douche", category: "profanity", severity: "high", variants: ["doosh", "douch"] },
	{ term: "douchebag", category: "profanity", severity: "high", variants: ["douchebags", "dooshbag"] },
	{ term: "asshat", category: "profanity", severity: "high", variants: ["ashat", "azzhat"] },
	{ term: "scumbag", category: "profanity", severity: "high", variants: ["scumbags", "scum"] },
	{ term: "piss", category: "profanity", severity: "high", variants: ["pis", "pissed", "pissing", "pissedoff"] },
	{ term: "tits", category: "profanity", severity: "high", variants: ["titties", "titty", "tittys"] },
	{ term: "boobs", category: "profanity", severity: "high", variants: ["boob", "boobies"] },
	{ term: "rape", category: "profanity", severity: "high", variants: ["raped", "raping", "rapist", "rapists"] },
	{ term: "rapist", category: "profanity", severity: "high", variants: ["rapists", "rapest"] },
	{ term: "molest", category: "profanity", severity: "high", variants: ["molester", "molested", "molesting", "molesation"] },
	{ term: "molester", category: "profanity", severity: "high", variants: ["molesters"] },
	{ term: "pervert", category: "profanity", severity: "high", variants: ["perv", "pervs", "perverted", "pervo"] },
	{ term: "stfu", category: "profanity", severity: "high", variants: ["stfuu"] },
	{ term: "gtfo", category: "profanity", severity: "high" },
	{ term: "wtf", category: "profanity", severity: "high", variants: ["wtff", "wth"] },
	{ term: "ass", category: "profanity", severity: "high", variants: ["azz", "arse", "arrse"] },
	{ term: "chutiya", category: "profanity", severity: "high", variants: ["chutya", "chutiye", "chutiyae", "chutiyaa", "chootiya", "chutiyapa"] },
	{ term: "chutiyapa", category: "profanity", severity: "high", variants: ["chutiyapanti"] },
	{ term: "bhenchod", category: "profanity", severity: "high", variants: ["behenchod", "bhenchodd", "behenchodd", "bhenchode", "behenchode", "bhenchood"] },
	{ term: "madarchod", category: "profanity", severity: "high", variants: ["madrchod", "madarchodd", "madarchode", "madarchood", "madarchot"] },
	{ term: "gandu", category: "profanity", severity: "high", variants: ["gaandu", "gandoo", "ganddu", "gando"] },
	{ term: "gand", category: "profanity", severity: "high", variants: ["gaand"] },
	{ term: "lodu", category: "profanity", severity: "high", variants: ["lode", "loda", "lauda", "laude", "lowda", "lawda"] },
	{ term: "randi", category: "profanity", severity: "high", variants: ["rndi", "randee"] },
	{ term: "saala", category: "profanity", severity: "high", variants: ["sala", "saale", "sali", "saali", "sale", "saley"] },
	{ term: "kutta", category: "profanity", severity: "high", variants: ["kutte", "kutti", "kuttay", "kuttiya", "kuttya", "kutha"] },
	{ term: "harami", category: "profanity", severity: "high", variants: ["haraami", "haramkhor", "haramzada", "haramzaade", "haramzade"] },
	{ term: "kaminey", category: "profanity", severity: "high", variants: ["kamina", "kamine", "kameena", "kameeni", "kamini"] },
	{ term: "bhosdi", category: "profanity", severity: "high", variants: ["bhosdike", "bhosda", "bhosdika", "bhosdiwala"] },
	{ term: "bhadwa", category: "profanity", severity: "high", variants: ["bhadwe", "bhadve", "bhadvay"] },
	{ term: "jhatu", category: "profanity", severity: "high", variants: ["jhaatu", "jhattu", "jhaat"] },
	{ term: "tatti", category: "profanity", severity: "high", variants: ["tati", "tatty"] },
	{ term: "damn", category: "slang", severity: "high", variants: ["damnn", "dman", "dayum"] },
	{ term: "dammit", category: "slang", severity: "high", variants: ["damnit", "damit", "dammnit"] },
	{ term: "hell", category: "slang", severity: "high", variants: ["helll"] },
	{ term: "crap", category: "slang", severity: "high", variants: ["crapie", "crapp"] },
	{ term: "crappy", category: "slang", severity: "high", variants: ["crapy"] },
	{ term: "dumb", category: "slang", severity: "high", variants: ["dum", "dumm"] },
	{ term: "dumbo", category: "slang", severity: "high", variants: ["dumboh"] },
	{ term: "idiot", category: "slang", severity: "high", variants: ["ediot"] },
	{ term: "idiotic", category: "slang", severity: "high", variants: ["ediotic"] },
	{ term: "idiots", category: "slang", severity: "high", variants: ["ediots"] },
	{ term: "stupid", category: "slang", severity: "high", variants: ["stupit", "stupidd", "stoopid", "stupido"] },
	{ term: "moron", category: "slang", severity: "high", variants: ["moran", "morron"] },
	{ term: "moronic", category: "slang", severity: "high" },
	{ term: "morons", category: "slang", severity: "high", variants: ["morans"] },
	{ term: "loser", category: "slang", severity: "high", variants: ["looser", "losser"] },
	{ term: "losers", category: "slang", severity: "high", variants: ["loosers", "lossers"] },
	{ term: "suck", category: "slang", severity: "high", variants: ["suk", "succ"] },
	{ term: "sucks", category: "slang", severity: "high", variants: ["suks", "succs"] },
	{ term: "sucky", category: "slang", severity: "high", variants: ["suki"] },
	{ term: "sucked", category: "slang", severity: "high", variants: ["suked"] },
	{ term: "jerk", category: "slang", severity: "high", variants: ["jerks", "jerkk"] },
	{ term: "jerks", category: "slang", severity: "high", variants: ["jerkks"] },
	{ term: "bloody", category: "slang", severity: "high", variants: ["bloddy", "blooddy"] },
	{ term: "bugger", category: "slang", severity: "high", variants: ["buggers", "buger"] },
	{ term: "buggers", category: "slang", severity: "high", variants: ["bugers"] },
	{ term: "sod", category: "slang", severity: "high" },
	{ term: "git", category: "slang", severity: "high" },
	{ term: "prat", category: "slang", severity: "high" },
	{ term: "twit", category: "slang", severity: "high", variants: ["twits"] },
	{ term: "nitwit", category: "slang", severity: "high", variants: ["nitwits"] },
	{ term: "dimwit", category: "slang", severity: "high", variants: ["dimwits"] },
	{ term: "airhead", category: "slang", severity: "high", variants: ["airheads"] },
	{ term: "bonehead", category: "slang", severity: "high", variants: ["boneheads"] },
	{ term: "jackass", category: "slang", severity: "high", variants: ["jackasss", "jakass"] },
	{ term: "smartass", category: "slang", severity: "high", variants: ["smartasses", "smartasss"] },
	{ term: "dumbass", category: "slang", severity: "high", variants: ["dumass", "dumbasses", "dumbazz"] },
	{ term: "fatso", category: "slang", severity: "high", variants: ["fatsoo"] },
	{ term: "bakwas", category: "slang", severity: "high", variants: ["bakwaas", "bakhwas"] },
	{ term: "bewakoof", category: "slang", severity: "high", variants: ["bewakouf", "bewaqoof", "bewaqouf", "bevakoof", "bewkoof", "bewakuf"] },
	{ term: "nalayak", category: "slang", severity: "high", variants: ["nalayk", "nalaayak"] },
	{ term: "nikamma", category: "slang", severity: "high", variants: ["nikama", "nikammay"] },
	{ term: "besharam", category: "slang", severity: "high", variants: ["besharamm", "besaram"] },
	{ term: "gadha", category: "slang", severity: "high", variants: ["gadhe", "gadhaa", "gadhi", "gada"] },
	{ term: "ullu", category: "slang", severity: "high", variants: ["ulu", "ulluu", "ullus"] },
	{ term: "chup kar", category: "slang", severity: "high", variants: ["chupkar", "chup karo", "chup raho"] },
	{ term: "chupkar", category: "slang", severity: "high", variants: ["chup karo", "chup raho"] },
	{ term: "shut up", category: "slang", severity: "high", variants: ["shutup", "shut upp", "shuddup"] },
	{ term: "duffer", category: "slang", severity: "high", variants: ["duffers"] },
	{ term: "buddhu", category: "slang", severity: "high", variants: ["budhu", "budhuu", "buddhuu"] },
	{ term: "chomu", category: "slang", severity: "high", variants: ["chomuu"] },
	{ term: "chapri", category: "slang", severity: "high", variants: ["chhapri", "chaprii"] },
	{ term: "gawar", category: "slang", severity: "high", variants: ["ganwar", "gawaar", "gawarr", "gaonwar"] },
	{ term: "tapori", category: "slang", severity: "high", variants: ["tapoori", "taporii", "tapor"] },
	{ term: "pagal", category: "slang", severity: "high", variants: ["pagla", "pagli", "paglu", "paagal"] },
	{ term: "kameeni", category: "slang", severity: "high", variants: ["kamini"] },
	{ term: "nikammay", category: "slang", severity: "high", variants: ["nikammey"] },
];

// ─── Flattened lists (mirror of api/_wordlists.js exports) ─────────

function flatten(category: LexiconCategory): string[] {
	const out = new Set<string>();
	for (const entry of LEXICON) {
		if (entry.category !== category) continue;
		out.add(entry.term.toLowerCase());
		for (const v of entry.variants || []) out.add(String(v).toLowerCase());
	}
	return [...out].sort((a, b) => b.length - a.length);
}

export const PROFANITY = flatten("profanity");
export const SLANG = flatten("slang");

const CANONICAL_TERMS = [
	...new Set(
		LEXICON.flatMap((e) => [e.term.toLowerCase(), ...(e.variants || []).map((v) => String(v).toLowerCase())]),
	),
];
const PHRASE_TERMS = CANONICAL_TERMS.filter((t) => /\s/.test(t));
const SINGLE_TOKEN_TERMS = new Set(CANONICAL_TERMS.filter((t) => !/\s/.test(t)));

// ─── Matcher (mirror of api/_lexicon.js) ───────────────────────────

const LEET_MAP: Record<string, string> = {
	"0": "o",
	"1": "i",
	"3": "e",
	"4": "a",
	"5": "s",
	"7": "t",
	"8": "b",
	$: "s",
	"@": "a",
	"!": "i",
	"+": "t",
};
const LEET_RE = /[0134578$@!+]/g;
const INVISIBLE_RE = /[\u200b-\u200d\ufeff\u00ad\u2060]/g;
const SEP_RE = /[\s.\-_*·•]+/g;
const TOKEN_RE = /[a-z0-9$@!+]+(?:[._*\-][a-z0-9$@!+]+)*/g;

export function collapseRepeats(value: string, to = 1): string {
	return String(value).replace(/(.)\1{2,}/g, (_m, ch: string) => ch.repeat(to));
}

export function normalizeForMatch(value: unknown): string {
	return String(value == null ? "" : value)
		.normalize("NFKC")
		.replace(INVISIBLE_RE, "")
		.toLowerCase();
}

export function foldLeet(value: string): string {
	return String(value).replace(LEET_RE, (c) => LEET_MAP[c] || c);
}

export function joinSeparatedLetters(value: string): string {
	return String(value).replace(/\b(?:[a-z0-9][\s.\-_*·•]{1,2}){2,}[a-z0-9]\b/g, (m) =>
		m.replace(SEP_RE, ""),
	);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CANONICAL_OF = new Map<string, string>();
const META_OF = new Map<string, { category: LexiconCategory; severity: string }>();
for (const entry of LEXICON) {
	const canonical = entry.term.toLowerCase();
	const meta = { category: entry.category, severity: entry.severity || "high" };
	CANONICAL_OF.set(canonical, canonical);
	META_OF.set(canonical, meta);
	for (const v of entry.variants || []) {
		const variant = String(v).toLowerCase();
		CANONICAL_OF.set(variant, canonical);
		META_OF.set(variant, meta);
	}
}

const PHRASE_RES = PHRASE_TERMS.map((t) => ({
	term: t,
	re: new RegExp(`\\b${escapeRe(t)}\\b`, "g"),
}));

function tokenForms(token: string): Set<string> {
	const forms = new Set<string>();
	const add = (v: string) => {
		if (v) forms.add(v);
	};
	const noSymbols = token.replace(/[^a-z0-9]/g, "");
	for (const base of [token, noSymbols]) {
		add(base);
		add(foldLeet(base));
		const c1 = collapseRepeats(base, 1);
		add(c1);
		add(foldLeet(c1));
		const c2 = collapseRepeats(base, 2);
		add(c2);
		add(foldLeet(c2));
	}
	return forms;
}

/** Every blocked term in `text`, mirroring the server matcher exactly. */
export function findTerms(rawText: unknown): TermHit[] {
	const hits: TermHit[] = [];
	if (rawText == null) return hits;
	const seen = new Set<string>();
	const push = (resolved: string, surface: string, index: number) => {
		const canonical = CANONICAL_OF.get(resolved) || resolved;
		const meta = META_OF.get(canonical);
		if (!meta) return;
		const key = `${canonical}@${index}`;
		if (seen.has(key)) return;
		seen.add(key);
		hits.push({ term: canonical, category: meta.category, severity: meta.severity, matched: surface, index });
	};

	const normalized = normalizeForMatch(rawText);
	if (!normalized) return hits;
	const joined = joinSeparatedLetters(normalized);
	const passes = joined !== normalized ? [normalized, joined] : [normalized];

	for (const pass of passes) {
		for (const { term, re } of PHRASE_RES) {
			re.lastIndex = 0;
			let m: RegExpExecArray | null;
			while ((m = re.exec(pass)) !== null) {
				push(term, m[0], m.index);
				if (!m[0].length) re.lastIndex += 1;
			}
		}
		TOKEN_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = TOKEN_RE.exec(pass)) !== null) {
			const surface = m[0];
			for (const form of tokenForms(surface)) {
				if (SINGLE_TOKEN_TERMS.has(form)) {
					push(form, surface, m.index);
					break;
				}
			}
			if (!surface.length) TOKEN_RE.lastIndex += 1;
		}
	}

	hits.sort((a, b) => a.index - b.index);
	return hits;
}

export function hasBlockedTerm(text: unknown): boolean {
	return findTerms(text).length > 0;
}
