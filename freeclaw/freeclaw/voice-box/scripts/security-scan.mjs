// ═══════════════════════════════════════════════════════════════════
// SECURITY SCAN — static, offline, evidence-cited (spec §28, §57)
// ═══════════════════════════════════════════════════════════════════
// Checks that need no network and no credentials:
//   1. No secret-looking strings in client source (src/) or committed files
//   2. No .env files tracked by git
//   3. dangerouslySetInnerHTML / innerHTML / eval sinks listed for review
//   4. No service-role key outside server code and docs
// Exit 1 on HIGH findings, 0 otherwise. Findings print file:line.
// Run: npm run audit:security
// ═══════════════════════════════════════════════════════════════════

import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function sh(cmd) {
	try {
		return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "";
	}
}

const findings = []; // {sev, where, what}
function walkGitGrep(pattern, paths, label) {
	const out = sh(`git grep -n -E ${JSON.stringify(pattern)} -- ${paths}`);
	for (const line of out.split("\n").filter(Boolean)) {
		const m = line.match(/^([^:]+):(\d+):(.*)$/);
		if (m) findings.push({ where: `${m[1]}:${m[2]}`, what: `${label}: ${m[3].trim().slice(0, 140)}` });
	}
	return out;
}

// 1. Secret-looking strings anywhere tracked (exclude docs describing var names)
const SECRET_RE = "(sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|xox[bpas]-[A-Za-z0-9-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,})";
walkGitGrep(SECRET_RE, ". ':!*.md'", "possible secret");
walkGitGrep("SUPABASE_SERVICE_ROLE_KEY['\"]?\\s*[:=]\\s*['\"][^'\"]{8,}", "src", "service-role key in client source");
// 2. Tracked env files
const trackedEnv = sh("git ls-files | grep -E '(^|/)\\.env(\\.|$)' || true");
for (const f of trackedEnv.split("\n").filter(Boolean))
	if (!f.endsWith(".template") && !f.endsWith(".example"))
		findings.push({ where: f, what: "HIGH: env file tracked by git" });
// 3. XSS sinks (review list — not auto-fail; each must sanitize)
const sinks = sh("git grep -n -E 'dangerouslySetInnerHTML|\\.innerHTML\\s*=|\\beval\\(' -- src | head -30");
const sinkList = sinks.split("\n").filter(Boolean);
// 4. service-role key must not appear in client bundle source
walkGitGrep("SERVICE_ROLE", "src", "service-role reference in client");

const highs = findings.filter((f) => /HIGH|possible secret|service-role key in client/.test(f.what));
console.log(`SECURITY SCAN — ${findings.length} finding(s), ${highs.length} HIGH`);
for (const f of findings) console.log(`- [${/HIGH|possible secret|service-role key in client/.test(f.what) ? "HIGH" : "note"}] ${f.where} :: ${f.what}`);
if (sinkList.length) {
	console.log(`\nXSS sinks to review (${sinkList.length}):`);
	for (const s of sinkList) console.log(`- ${s.slice(0, 160)}`);
}
process.exit(highs.length ? 1 : 0);
