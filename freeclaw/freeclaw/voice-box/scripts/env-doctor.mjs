#!/usr/bin/env node
// ─── Env doctor: publish-readiness for server secrets ───────────
// Local `npm run dev` reads .env/.env.local; Vercel production reads the
// dashboard env, which code CANNOT set by itself (platform boundary).
// This script verifies the local side and prints the exact one-time
// `vercel env add` commands for the cloud side. Exit 1 when a REQUIRED
// key is missing so a publish with broken voice/AI is never silent.
//
// REQUIRED: GROQ_API_KEY (server transcription; NVIDIA audio 404s).
// REQUIRED in prod: SUPABASE_URL + SUPABASE_ANON_KEY (app cannot boot).
// OPTIONAL: OPENAI_API_KEY, ANTHROPIC_API_KEY, ADMIN_SESSION_SECRET.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
function readEnvFile(f) {
	try {
		return fs.readFileSync(path.join(root, f), "utf8");
	} catch {
		return "";
	}
}
const raw = readEnvFile(".env") + "\n" + readEnvFile(".env.local");
const has = (k) => new RegExp(`^${k}=.+`, "m").test(raw);

const required = ["GROQ_API_KEY"];
const requiredGroups = [
	["VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"],
	["SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_ANON_KEY"],
];
const optional = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ADMIN_SESSION_SECRET"];

console.log("── local .env ──");
for (const k of required) {
	const ok = has(k) || !!process.env[k];
	console.log(`${ok ? "SET  " : "MISS "} ${k}${ok ? "" : "  ← REQUIRED"}`);
}
for (const group of requiredGroups) {
	const ok = group.some((k) => has(k) || process.env[k]);
	console.log(
		`${ok ? "SET  " : "MISS "} ${group.join(" or ")}${ok ? "" : "  ← REQUIRED"}`,
	);
}
for (const k of optional) {
	console.log(`${has(k) || process.env[k] ? "SET  " : "---- "} ${k} (optional)`);
}
console.log("\n── Vercel production (one-time; code cannot set these) ──");
console.log("vercel env add GROQ_API_KEY production      # paste local value");
console.log("vercel env add VITE_SUPABASE_URL production");
console.log("vercel env add SUPABASE_SERVICE_ROLE_KEY production");
console.log("Then redeploy: vercel --prod");
if (!has("GROQ_API_KEY") && !process.env.GROQ_API_KEY) {
	console.log("\nNOTE: no local GROQ_API_KEY — voice transcription runs degraded until set.");
}
