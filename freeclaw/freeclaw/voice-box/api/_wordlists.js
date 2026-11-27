// ═══════════════════════════════════════════════════════════════════
// WORD LISTS — the canonical profanity/slang vocabulary (leaf module)
// ═══════════════════════════════════════════════════════════════════
// Single source of truth for every moderation surface: the server gate
// (api/_moderation.js via api/_lexicon.js), the slang finder
// (api/_slang.js), masking (api/_auth.js moderateContent), and the client
// mirror (src/lib/moderation.ts).
//
// WHY THIS IS STRUCTURED, NOT A FLAT LIST
// A flat list can only match spelling for spelling. School users write
// "fuk", "f*ck", "f u c k", "fuuuck", "sh1t" and Hinglish forms that never
// appear verbatim, while `\bass\b` on the raw string happily matches inside
// nothing (word boundaries do the work) — so the SAME list was both too
// narrow for evasion and too crude for context. Each entry here therefore
// carries:
//   term      — the canonical spelling
//   variants  — real letter-spelling variants people actually type
//   category  — "profanity" | "slang" (the POLICY block class)
//   severity  — the flag severity the gate raises
// The MATCHER (api/_lexicon.js) owns the mechanical evasion layer —
// de-leet, repeated-letter collapse, single-letter separator joining —
// so variants only ever need to list genuine alternate SPELLINGS.
//
// Kept in a leaf module with NO imports so test doubles of _auth.js or
// _moderation.js never break the import graph — named imports of these
// lists must keep working under any partial mock.
//
// School policy: profanity AND slang BLOCK public writes (no stars are
// published); private support surfaces keep masking instead of blocking.
// ═══════════════════════════════════════════════════════════════════

/**
 * The lexicon. Order is irrelevant to matching (the matcher sorts by length),
 * but grouping by language keeps review sane.
 * @type {{ term: string, variants?: string[], category: "profanity"|"slang", severity: "high" }[]}
 */
export const LEXICON = [
	// ─── English profanity ────────────────────────────────────────
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

	// ─── South-Asian (Hinglish / Urdu / Bengali transliteration) profanity ──
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
	{ term: "bhosdi", category: "profanity", severity: "high", variants: ["bhosdike", "bhosda", "bhosdika", "bhosdika", "bhosdiwala"] },
	{ term: "bhadwa", category: "profanity", severity: "high", variants: ["bhadwe", "bhadve", "bhadvay"] },
	{ term: "jhatu", category: "profanity", severity: "high", variants: ["jhaatu", "jhattu", "jhaat"] },
	{ term: "tatti", category: "profanity", severity: "high", variants: ["tati", "tatty"] },

	// ─── Everyday slang / insult abuse (block class, same as profanity) ─────
	{ term: "damn", category: "slang", severity: "high", variants: ["damnn", "dman", "dayum"] },
	{ term: "dammit", category: "slang", severity: "high", variants: ["damnit", "damit", "dammnit"] },
	{ term: "hell", category: "slang", severity: "high", variants: ["helll"] },
	{ term: "crap", category: "slang", severity: "high", variants: ["crapie", "crapp"] },
	{ term: "crappy", category: "slang", severity: "high", variants: ["crapy", "crappy"] },
	{ term: "dumb", category: "slang", severity: "high", variants: ["dum", "dumm"] },
	{ term: "dumbo", category: "slang", severity: "high", variants: ["dumboh"] },
	{ term: "idiot", category: "slang", severity: "high", variants: ["idiot", "idiot", "ediot", "idiot"] },
	{ term: "idiotic", category: "slang", severity: "high", variants: ["idiotic", "ediotic"] },
	{ term: "idiots", category: "slang", severity: "high", variants: ["ediots"] },
	{ term: "stupid", category: "slang", severity: "high", variants: ["stupit", "stupidd", "stoopid", "stupido"] },
	{ term: "moron", category: "slang", severity: "high", variants: ["moran", "morron"] },
	{ term: "moronic", category: "slang", severity: "high", variants: ["moronic"] },
	{ term: "morons", category: "slang", severity: "high", variants: ["morans"] },
	{ term: "loser", category: "slang", severity: "high", variants: ["looser", "losser", "losers"] },
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
	{ term: "fatso", category: "slang", severity: "high", variants: ["fatso", "fatsoo"] },

	// ─── Hinglish / South-Asian slang ─────────────────────────────
	{ term: "bakwas", category: "slang", severity: "high", variants: ["bakwaas", "bakwas", "bakhwas", "bakwaas"] },
	{ term: "bewakoof", category: "slang", severity: "high", variants: ["bewakouf", "bewaqoof", "bewaqouf", "bevakoof", "bewkoof", "bewakuf"] },
	{ term: "nalayak", category: "slang", severity: "high", variants: ["nalayk", "nalaayak", "nalayak"] },
	{ term: "nikamma", category: "slang", severity: "high", variants: ["nikama", "nikammay"] },
	{ term: "besharam", category: "slang", severity: "high", variants: ["besharamm", "besaram"] },
	{ term: "gadha", category: "slang", severity: "high", variants: ["gadhe", "gadhaa", "gadhi", "gada"] },
	{ term: "ullu", category: "slang", severity: "high", variants: ["ulu", "ulluu", "ullus"] },
	{ term: "chup kar", category: "slang", severity: "high", variants: ["chupkar", "chup karo", "chup raho", "chupkar"] },
	{ term: "chupkar", category: "slang", severity: "high", variants: ["chup karo", "chup raho"] },
	{ term: "shut up", category: "slang", severity: "high", variants: ["shutup", "shut upp", "shuddup"] },
	{ term: "duffer", category: "slang", severity: "high", variants: ["duffers", "duffer"] },
	{ term: "buddhu", category: "slang", severity: "high", variants: ["budhu", "budhuu", "buddhuu"] },
	{ term: "chomu", category: "slang", severity: "high", variants: ["chomuu", "chomu"] },
	{ term: "chapri", category: "slang", severity: "high", variants: ["chapri", "chhapri", "chaprii"] },
	{ term: "gawar", category: "slang", severity: "high", variants: ["ganwar", "gawaar", "gawarr", "gaonwar"] },
	{ term: "tapori", category: "slang", severity: "high", variants: ["tapoori", "taporii", "tapor"] },
	{ term: "pagal", category: "slang", severity: "high", variants: ["pagla", "pagli", "paglu", "paagal"] },
	{ term: "kameeni", category: "slang", severity: "high", variants: ["kamini", "kameeni"] },
	{ term: "nikammay", category: "slang", severity: "high", variants: ["nikammey"] },

	// ─── Expanded block A: profanity compounds + evasions ────────────
	{ term: "frick", category: "profanity", severity: "high", variants: ["frik", "frickk"] },
	{ term: "fricking", category: "profanity", severity: "high", variants: ["frickin", "frikking", "frigging", "friggin"] },
	{ term: "effing", category: "profanity", severity: "high", variants: ["effin"] },
	{ term: "fuckwit", category: "profanity", severity: "high", variants: ["fuckwits", "fukwit", "fukwits"] },
	{ term: "fuckboy", category: "profanity", severity: "high", variants: ["fuckboys", "fukboy", "fukboys"] },
	{ term: "fucktard", category: "profanity", severity: "high", variants: ["fucktards", "fuktard", "fuktards"] },
	{ term: "fuckup", category: "profanity", severity: "high", variants: ["fuckups", "fukup"] },
	{ term: "shits", category: "profanity", severity: "high" },
	{ term: "shitshow", category: "profanity", severity: "high", variants: ["shitshows"] },
	{ term: "shitstorm", category: "profanity", severity: "high" },
	{ term: "shitstain", category: "profanity", severity: "high", variants: ["shitstains"] },
	{ term: "shithole", category: "profanity", severity: "high", variants: ["shitholes"] },
	{ term: "shitbrain", category: "profanity", severity: "high" },
	{ term: "bitchass", category: "profanity", severity: "high" },
	{ term: "bitchface", category: "profanity", severity: "high" },
	{ term: "asswipe", category: "profanity", severity: "high", variants: ["asswipes"] },
	{ term: "assclown", category: "profanity", severity: "high", variants: ["assclowns"] },
	{ term: "assface", category: "profanity", severity: "high" },
	{ term: "asskisser", category: "profanity", severity: "high", variants: ["asskissers", "ass kisser"] },
	{ term: "cockhead", category: "profanity", severity: "high" },
	{ term: "cocksucker", category: "profanity", severity: "high", variants: ["cocksuckers", "coksucker"] },
	{ term: "dickwad", category: "profanity", severity: "high", variants: ["dickwads"] },
	{ term: "dickweed", category: "profanity", severity: "high" },
	{ term: "dickface", category: "profanity", severity: "high" },
	{ term: "twats", category: "profanity", severity: "high" },
	{ term: "twatface", category: "profanity", severity: "high" },
	{ term: "wank", category: "profanity", severity: "high", variants: ["wanked", "wanking", "wanky"] },
	{ term: "slutface", category: "profanity", severity: "high" },
	{ term: "whorebag", category: "profanity", severity: "high" },
	{ term: "cuntface", category: "profanity", severity: "high" },
	{ term: "cuntish", category: "profanity", severity: "high" },
	{ term: "sonofabitch", category: "profanity", severity: "high", variants: ["sunofabitch", "sonofabitches"] },
	{ term: "bollock", category: "profanity", severity: "high", variants: ["bollocking", "bollocky"] },
	{ term: "pisshead", category: "profanity", severity: "high" },
	{ term: "skank", category: "profanity", severity: "high", variants: ["skanks", "skanky"] },
	{ term: "bimbo", category: "profanity", severity: "high", variants: ["bimbos"] },
	{ term: "hooker", category: "profanity", severity: "high", variants: ["hookers"] },

	// ─── Expanded block B: ableist / racial / homophobic slurs ───────
	{ term: "spastic", category: "profanity", severity: "high", variants: ["spaz", "spazz", "spazzy"] },
	{ term: "cripple", category: "profanity", severity: "high", variants: ["cripples"] },
	{ term: "midget", category: "profanity", severity: "high", variants: ["midgets"] },
	{ term: "schizo", category: "profanity", severity: "high", variants: ["schizos"] },
	{ term: "faggot", category: "profanity", severity: "high", variants: ["faggots", "fagot", "fagots", "fagg"] },
	{ term: "tranny", category: "profanity", severity: "high", variants: ["trannies"] },
	{ term: "nigger", category: "profanity", severity: "high", variants: ["nigga", "niggas", "niggaz", "niggah"] },
	{ term: "paki", category: "profanity", severity: "high", variants: ["pakis"] },
	{ term: "chink", category: "profanity", severity: "high", variants: ["chinks"] },
	{ term: "kike", category: "profanity", severity: "high", variants: ["kikes"] },
	{ term: "wetback", category: "profanity", severity: "high", variants: ["wetbacks"] },
	{ term: "gook", category: "profanity", severity: "high", variants: ["gooks"] },
	{ term: "raghead", category: "profanity", severity: "high", variants: ["ragheads"] },
	{ term: "towelhead", category: "profanity", severity: "high", variants: ["towelheads"] },
	{ term: "darkie", category: "profanity", severity: "high", variants: ["darky", "darkies"] },

	// ─── Expanded block C: Hinglish / Urdu profanity ─────────────────
	{ term: "bsdk", category: "profanity", severity: "high", variants: ["bkl"] },
	{ term: "mkl", category: "profanity", severity: "high" },
	{ term: "chodu", category: "profanity", severity: "high", variants: ["chodo", "choda", "chodna"] },
	{ term: "chutmarika", category: "profanity", severity: "high", variants: ["chutmarike", "chutmarikey"] },
	{ term: "raand", category: "profanity", severity: "high", variants: ["raands"] },
	{ term: "lund", category: "profanity", severity: "high", variants: ["loda", "lode"] },
	{ term: "tatte", category: "profanity", severity: "high", variants: ["tatta", "tattay"] },
	{ term: "gandfat", category: "profanity", severity: "high" },
	{ term: "gandmara", category: "profanity", severity: "high" },
	{ term: "bhen ke lode", category: "profanity", severity: "high", variants: ["bhenkelode", "behenkelode"] },
	{ term: "teri maa ki", category: "profanity", severity: "high", variants: ["terimaaki", "teri ma ki"] },
	{ term: "suar", category: "profanity", severity: "high", variants: ["sooar", "suwar", "soowar"] },

	// ─── Expanded block D: insult slang ──────────────────────────────
	{ term: "blockhead", category: "slang", severity: "high", variants: ["blockheads"] },
	{ term: "knucklehead", category: "slang", severity: "high", variants: ["knuckleheads"] },
	{ term: "meathead", category: "slang", severity: "high", variants: ["meatheads"] },
	{ term: "numbskull", category: "slang", severity: "high", variants: ["numbskulls", "numskull", "numskulls"] },
	{ term: "simpleton", category: "slang", severity: "high", variants: ["simpletons"] },
	{ term: "dork", category: "slang", severity: "high", variants: ["dorks", "dorky"] },
	{ term: "dweeb", category: "slang", severity: "high", variants: ["dweebs"] },
	{ term: "weirdo", category: "slang", severity: "high", variants: ["weirdos"] },
	{ term: "coward", category: "slang", severity: "high", variants: ["cowards", "cowardly"] },
	{ term: "snitch", category: "slang", severity: "high", variants: ["snitches", "snitched"] },
	{ term: "bootlicker", category: "slang", severity: "high", variants: ["bootlickers"] },
	{ term: "suckup", category: "slang", severity: "high", variants: ["suckups", "suck up", "suck ups"] },
	{ term: "kissass", category: "slang", severity: "high", variants: ["kiss ass", "kissasses"] },
	{ term: "brownnoser", category: "slang", severity: "high", variants: ["brownnosers"] },
	{ term: "buffoon", category: "slang", severity: "high", variants: ["buffoons"] },
	{ term: "oaf", category: "slang", severity: "high", variants: ["oafs"] },
	{ term: "lout", category: "slang", severity: "high", variants: ["louts"] },
	{ term: "yob", category: "slang", severity: "high", variants: ["yobs"] },

	// ─── Expanded block E: Hinglish / Urdu insult slang ──────────────
	{ term: "chamcha", category: "slang", severity: "high", variants: ["chamche", "chamchay", "chamchagiri"] },
	{ term: "chugli", category: "slang", severity: "high", variants: ["chuglikhor", "chugal"] },
	{ term: "jhootha", category: "slang", severity: "high", variants: ["jhutha", "jhoota", "jutha"] },
	{ term: "dhokebaaz", category: "slang", severity: "high", variants: ["dhokebaz", "dhokhebaaz"] },
	{ term: "ahmaq", category: "slang", severity: "high", variants: ["ehmaq"] },
	{ term: "khotay", category: "slang", severity: "high", variants: ["khota", "khotey"] },
	{ term: "chhichhora", category: "slang", severity: "high", variants: ["chhichora", "chichora"] },
	{ term: "kachra", category: "slang", severity: "high", variants: ["kachda", "kachraa"] },
	{ term: "badmash", category: "slang", severity: "high", variants: ["badmaash", "badmashs"] },
	{ term: "lafanga", category: "slang", severity: "high", variants: ["lafangey", "lafangay"] },
	{ term: "awara", category: "slang", severity: "high", variants: ["aawara", "awaraa"] },
	{ term: "mawali", category: "slang", severity: "high", variants: ["mavali"] },
	{ term: "gunda", category: "slang", severity: "high", variants: ["gunday", "gunde"] },
];

/**
 * Flatten one category into the `[term, ...variants]` set the older callers
 * expect. Sorted longest-first so masking/`includes` scans never match a
 * short form while a longer one is present ("bullshit" before "shit").
 */
function flatten(category) {
	const out = new Set();
	for (const entry of LEXICON) {
		if (entry.category !== category) continue;
		out.add(entry.term.toLowerCase());
		for (const v of entry.variants || []) out.add(String(v).toLowerCase());
	}
	return [...out].sort((a, b) => b.length - a.length);
}

/** Every profanity term + variant (the POLICY `profanity` block class). */
export const PROFANITY = flatten("profanity");

/** Every slang term + variant (also the `profanity` block class). */
export const SLANG = flatten("slang");

/**
 * Canonical single-token spellings only (no variants, no phrases). The
 * matcher builds its membership set from this plus PROFANITY/SLANG, so an
 * entry added above is picked up everywhere without a second edit.
 */
export const CANONICAL_TERMS = [
	...new Set(
		LEXICON.flatMap((e) => [e.term.toLowerCase(), ...(e.variants || []).map((v) => String(v).toLowerCase())]),
	),
];

/** Multi-word entries need phrase matching (`\b`-anchored) rather than token equality. */
export const PHRASE_TERMS = CANONICAL_TERMS.filter((t) => /\s/.test(t));

/** Single-token entries — the membership set token matching uses. */
export const SINGLE_TOKEN_TERMS = new Set(CANONICAL_TERMS.filter((t) => !/\s/.test(t)));
