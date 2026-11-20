#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// VERIFY SOAK CONTENT — evidence before load, not assertions after it
// ═══════════════════════════════════════════════════════════════════
// Replays the exact corpus the lifecycle soak will submit through the REAL
// server predicates and reports the observed result:
//
//   • isStaffComplaint(title + description)   must be true  every time
//   • HARM_VERB(test) === false                (implied, asserted directly)
//   • SECOND_PERSON_MENACE absent              (implied by isStaffComplaint)
//   • isTestArtifact(title)                   must be false every time
//   • title uniqueness across the whole run   must be exact
//   • SPACE >= users                          so indexes never wrap
//
// If this fails, the soak would be testing the wrong thing: a submission the
// server considers something other than an ordinary staff complaint, or a row
// the artifact filter hides after accepting it.
//
// Usage:
//   node scripts/verify-soak-content.mjs --users 5000
// ═══════════════════════════════════════════════════════════════════

import { isStaffComplaint, HARM_VERB } from "../api/_context-moderation.js";
import { isTestArtifact } from "../api/_artifact-filter.js";
import { complaintFor, SPACE, POOLS } from "./soak-content.mjs";

const argv = process.argv.slice(2);
function arg(name, fallback) {
	const i = argv.indexOf(`--${name}`);
	if (i === -1) return fallback;
	const v = argv[i + 1];
	return v && !v.startsWith("--") ? v : true;
}

const USERS = Math.max(1, parseInt(arg("users", "5000"), 10));
const SECOND_PERSON =
	/\b(?:dekh\s*l[uo]nga|chhod?unga\s*nahi|nahi\s*chhod?unga|watch\s+your\s+back|you\s+will\s+pay|you'?re\s+dead|you\s+are\s+dead|i\s+know\s+where\s+you\s+live|i(?:'ll|\s+will)\s+get\s+you|done\s+with\s+you)\b/i;

const failures = [];
const titles = new Set();
const staffSeen = new Set();
let tooShortTitle = 0;
let tooShortBody = 0;
let withDigit = 0;

for (let i = 0; i < USERS; i++) {
	const { title, description, parts } = complaintFor(i);
	const text = `${title} ${description}`;
	staffSeen.add(parts.staff);

	if (titles.has(title)) failures.push(`duplicate title at idx ${i}: ${title}`);
	else titles.add(title);

	if (!isStaffComplaint(text)) failures.push(`not a staff complaint at idx ${i}: ${title}`);
	if (isTestArtifact(title)) failures.push(`artifact-shape title at idx ${i}: ${title}`);
	if (HARM_VERB.test(text)) failures.push(`harm verb at idx ${i}: ${title}`);
	if (SECOND_PERSON.test(text)) failures.push(`second-person menace at idx ${i}: ${title}`);

	if (title.length < 24) tooShortTitle++;
	if (description.length < 80) tooShortBody++;
	if (/\d/.test(title)) withDigit++;
}

console.log(`\nvoice flow — soak corpus verification`);
console.log(`  corpus space      : ${SPACE.toLocaleString()} distinct titles`);
console.log(`  users requested   : ${USERS.toLocaleString()}`);
console.log(`  titles generated  : ${titles.size.toLocaleString()}`);
console.log(`  staff complaints  : ${USERS - failures.filter((f) => f.startsWith("not a staff")).length}/${USERS}`);
console.log(`  artifact titles   : ${failures.filter((f) => f.startsWith("artifact")).length}`);
console.log(`  harm verbs        : ${failures.filter((f) => f.startsWith("harm verb")).length}`);
console.log(`  menaces           : ${failures.filter((f) => f.startsWith("second-person")).length}`);
console.log(`  duplicate titles  : ${failures.filter((f) => f.startsWith("duplicate")).length}`);
console.log(`  staff phrases hit  : ${staffSeen.size} of ${POOLS.STAFF.length}`);
console.log(`  titles with digit : ${withDigit}`);
console.log(`  short title (<24) : ${tooShortTitle}`);
console.log(`  short body (<80)  : ${tooShortBody}`);

console.log(`\n  sample:`);
for (const i of [0, 1, 100, Math.min(1234, USERS - 1), USERS - 1]) {
	const { title, description } = complaintFor(i);
	console.log(`    [${i}] ${title}`);
	console.log(`         ${description}`);
}

const gate = [];
if (USERS > SPACE) gate.push(`users ${USERS} > corpus space ${SPACE} (titles would repeat)`);
if (failures.length) gate.push(`${failures.length} content violations`);

if (gate.length) {
	console.log(`\n  CONTENT GATE FAILED:`);
	for (const f of gate) console.log(`    ✗ ${f}`);
	for (const f of failures.slice(0, 10)) console.log(`    · ${f}`);
	process.exitCode = 1;
} else {
	console.log(`\n  CONTENT GATE PASSED — every submission is an ordinary staff complaint, unique, and not an artifact`);
}
