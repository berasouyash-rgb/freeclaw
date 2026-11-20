const fs = require('fs');
let content = fs.readFileSync('api/_posts.js', 'utf8');

const target1 = `async function fetchFeedRows({ type, cursor }) {
	let qq = supabase
		.from("posts")
		.select("*")
		.order("created_at", { ascending: false });
	if (type) qq = qq.eq("type", type);
	qq = qq.eq("hidden", false).eq("deleted", false).neq("status", "pending_review");
	if (validCursor(cursor)) qq = qq.lt("created_at", cursor);
	qq = qq.limit(2000);
	const r = await qq;
	if (r.error) throw r.error;
	return r.data || [];
}`;

const replacement1 = `let _lastGoodFeedRows = null;
async function fetchFeedRows({ type, cursor }) {
	try {
		let qq = supabase
			.from("posts")
			.select("*")
			.order("created_at", { ascending: false });
		if (type) qq = qq.eq("type", type);
		qq = qq.eq("hidden", false).eq("deleted", false).neq("status", "pending_review");
		if (validCursor(cursor)) qq = qq.lt("created_at", cursor);
		qq = qq.limit(2000);
		const r = await qq;
		if (r.error) throw r.error;
		const rows = r.data || [];
		if (rows.length > 0 && !cursor && !type) _lastGoodFeedRows = rows;
		return rows;
	} catch (err) {
		if (_lastGoodFeedRows && _lastGoodFeedRows.length > 0 && !cursor && !type) {
			console.warn("[posts] DB pool saturated, serving resilient feed cache:", err?.message || String(err));
			return _lastGoodFeedRows;
		}
		throw err;
	}
}`;

const target2 = `\tconst { rMap, cMap, pMap, pvMap } = await getRawCounts(ids);`;
const replacement2 = `\tlet rMap = {}, cMap = {}, pMap = {}, pvMap = {};
\ttry {
\t\tconst counts = await getRawCounts(ids);
\t\trMap = counts.rMap || {};
\t\tcMap = counts.cMap || {};
\t\tpMap = counts.pMap || {};
\t\tpvMap = counts.pvMap || {};
\t} catch (err) {
\t\tconsole.warn("[posts] DB counts busy, fail-open to empty maps:", err?.message || String(err));
\t}`;

// Normalize line endings for replacement
const normalize = (t) => t.replace(/\r\n/g, '\n');
const normalizedContent = normalize(content);

if (normalizedContent.includes(normalize(target1)) && normalizedContent.includes(normalize(target2))) {
	let patched = normalizedContent.replace(normalize(target1), normalize(replacement1));
	patched = patched.replace(normalize(target2), normalize(replacement2));
	// Preserve CRLF if original had it
	if (content.includes('\r\n')) {
		patched = patched.replace(/\n/g, '\r\n');
	}
	fs.writeFileSync('api/_posts.js', patched);
	console.log('SUCCESS: api/_posts.js patched with resilient caching');
} else {
	console.error('ERROR: targets not found in api/_posts.js');
	process.exit(1);
}
