#!/usr/bin/env node
// ─── Admin password reset ────────────────────────────────────────
// Lets the project owner set the admin password to anything they choose,
// without editing code or going through the console.
//
// Usage:
//   node scripts/reset-admin-password.mjs "YourNewPassword"
//   node scripts/reset-admin-password.mjs            # generates one for you
//
// What it does: writes { hash: sha256(password) } into the `settings` table
// (key "admin_password") — the exact record /api/admin login compares against.
// It also clears all existing admin sessions, so any token minted with the
// old password stops working immediately.
//
// Requires VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env loader (no dependency needed)
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
	const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
	if (m && process.env[m[1]] === undefined) {
		process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
	}
}

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key =
	process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
	console.error(
		"Missing Supabase config: set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env",
	);
	process.exit(1);
}

// The owner chooses ANY password — no length floor, no blocklist. This
// matches the change-password form in AdminSettings, which applies the same
// policy. The only guard left is "must not be empty".
const password = process.argv[2] || randomBytes(12).toString("base64url");

if (!password || !password.trim()) {
	console.error("Refusing: password cannot be empty.");
	process.exit(1);
}

const hash = createHash("sha256").update(password).digest("hex");

const headers = {
	apikey: key,
	Authorization: `Bearer ${key}`,
	"Content-Type": "application/json",
	Prefer: "return=minimal",
};

async function upsertSetting(key_, value) {
	// Match api/_admin.js setSetting(): the table stores JSONB in a `value`
	// column, so the payload is { key, value } — NOT a bare column map. (A
	// body like { hash } makes PostgREST look for a literal 'hash' column
	// and fail with PGRST204.) Update if the key exists, else insert.
	const r = await fetch(
		`${url}/rest/v1/settings?select=key&key=eq.${encodeURIComponent(key_)}`,
		{ headers: { apikey: key, Authorization: `Bearer ${key}` } },
	);
	const rows = await r.json();
	const exists = Array.isArray(rows) && rows.length > 0;
	const endpoint = exists
		? `${url}/rest/v1/settings?key=eq.${encodeURIComponent(key_)}`
		: `${url}/rest/v1/settings`;
	const res = await fetch(endpoint, {
		method: exists ? "PATCH" : "POST",
		headers,
		body: JSON.stringify(exists ? { value } : { key: key_, value }),
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		console.error(`Failed to write "${key_}": HTTP ${res.status} ${detail}`);
		process.exit(1);
	}
}

await upsertSetting("admin_password", { hash });
await upsertSetting("admin_sessions", { tokens: [] });

console.log("Admin password updated.");
console.log(`  New password: ${password}`);
console.log(
	"  All existing admin sessions were revoked — sign in fresh with this password.",
);
console.log("Store it somewhere safe; it is not shown again.");
