// Shared test/fuzz artifact filter.
// Test runs and fuzz testing have seeded the production DB with junk titles
// ("Fzqbn otsm8vjg lh2d3kil", "Wxcrp 9kgndw01 dv7eo9xu", "QA test post …",
// "Test poll …", "Content Type Test", "Full CRUD Test 210145", …). These rows
// stay intact in the DB — this predicate just excludes them from every content
// surface, public AND admin: posts feed, by-id/by-ids fetches, author listings,
// comments, polls, insights, trends, reports, inbox/chat threads, notifications,
// search, and leaderboard. Nothing is deleted; artifacts are only hidden.
//
// NOTE: this is deliberately title/body-only. Author-based signals are NOT used —
// seeded accounts also hold real content (e.g. "anon_test." authored the legit
// "Broken window in Science Lab B"; "qa-user-1." authored real registration
// questions), so keying off the author id would hide genuine posts.

const isTestArtifact = (title = "") => {
	const t = String(title || "").trim();
	// Empty/undefined text is NOT an artifact: threads with no messages yet,
	// rows whose body/title column was not selected, etc. must pass through.
	if (!t) return false;
	// Fuzz-generated gibberish. The generator produces a short capitalized
	// all-consonant nonsense word followed by two or more gibberish tokens, at
	// least one of which carries a digit, e.g.
	//   "Fzqbn otsm8vjg lh2d3kil", "Wxcrp 9kgndw01 dv7eo9xu",
	//   "Wxcrp qtwvlpuj b1uygot3", "Kjvwm z7evp978 pjosjdkh",
	//   "Xqvtm 4srdhkky mupsxdes".
	// No real English word of 5-6 letters is all consonants, so a leading
	// vowel-free token followed by at least two more tokens plus a digit
	// somewhere in the title is a safe fingerprint that cannot match a real
	// sentence (real capitalized words always contain a vowel).
	const fuzzShape = /^[A-Z][bcdfghjklmnpqrstvwxz]{4,5}\s+\S+\s+\S+/i;
	if (fuzzShape.test(t) && /\d/.test(t)) return true;
	// Explicit QA / test posts and polls
	if (/^qa\s+test\b/i.test(t)) return true;
	if (/^test\s+(post|poll|question|problem|suggestion)\b/i.test(t)) return true;
	// Yes/no polls auto-generated from a test post
	if (/^do you agree:\s*test\b/i.test(t)) return true;
	// Known seeded comment bodies from the original cleanup run. These are
	// explicit fixture signatures, not a rule that removes ordinary comments
	// merely because they use the word "test".
	if (/^(?:this is a test comment|test body text)$/i.test(t)) return true;
	// Known seeded harness titles. Do NOT use a broad /\btest\b/ rule here:
	// "test" is ordinary school vocabulary, and hiding every title containing it
	// makes a successfully published post disappear from My Activity. Only the
	// explicit harness prefixes below are safe to remove without risking real
	// student content (the DB row is still retained for audit/recovery).
	if (
		/^(?:content type|full crud|final workflow|workflow|fv|reaction comment)\s+test(?:\s+(?:post|poll|question|problem|suggestion))?(?:\s+\d+)?$/i.test(
			t,
		)
	)
		return true;
	return false;
};

// QA/fuzz runs also create chat/inbox threads with recognizable ids
// ("inbox-test", "thread_debug", "stress_chat", "e2e-flow", …). Admin thread
// listings (inbox/chat) hide matching thread ids so the queue reads clean.
// Word-boundary terms avoid false positives on real generated ids like
// "inbox_ml3x8k2" or "contest-chat".
const TEST_THREAD_ID_RE =
	/\b(test|dbg|e2e|smoke)\b|^(thread_debug|thread_crit|thread_anx|thread_neu|inbox-test|inbox-e2e|pos-test|crit-test|ai-test|anon_test|stress_chat|fulltest|live_test_|health-)/i;

export { isTestArtifact, TEST_THREAD_ID_RE };
