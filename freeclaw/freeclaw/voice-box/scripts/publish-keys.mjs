#!/usr/bin/env node
// publish-keys — one command to publish provider API keys from the LOCAL
// gitignored .env to Vercel environment variables (Production + Preview).
//
// Why this exists instead of keys in code: a key committed to the repo is
// compromised the instant it is pushed (git history never forgets, and any
// reader of the codebase can exfiltrate it). The app reads keys ONLY from
// process.env (api/_providers.js, api/_transcribe.js) — this script is the
// single supported bridge from your machine to hosted envs.
//
// Usage:
//   node scripts/publish-keys.mjs            # dry run: shows what WOULD be set (names only)
//   node scripts/publish-keys.mjs --apply    # token path if VERCEL_TOKEN is set,
//                                            # else `vercel env add` per key (needs CLI + login)
//   node scripts/publish-keys.mjs --apply --scope production
//
// Token path (no CLI, no disk cost): create a token once at
// vercel.com/account/tokens, then $env:VERCEL_TOKEN="..." and re-run.
// The project/org IDs come from the repo's .vercel/project.json.
//
// Source of truth: the KEY NAMES below. Values are read from .env at runtime
// and never printed, logged, or written anywhere by this script.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ENV_PATH = new URL("../.env", import.meta.url);
const KEY_NAMES = [
  "NVIDIA_API_KEY",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "MISTRAL_API_KEY",
];

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const scopeIdx = process.argv.indexOf("--scope");
const scope = scopeIdx >= 0 ? process.argv[scopeIdx + 1] || "production" : "production";

function loadLocalEnv() {
  let text = "";
  try {
    text = readFileSync(ENV_PATH, "utf8");
  } catch {
    console.error("No local .env found — add keys there first (it is gitignored).");
    process.exit(1);
  }
  const found = {};
  for (const name of KEY_NAMES) {
    const m = text.match(new RegExp(`^${name}=(.+)$`, "m"));
    if (m) found[name] = m[1].trim();
  }
  return found;
}

const found = loadLocalEnv();
const names = Object.keys(found);
if (names.length === 0) {
  console.error(`None of ${KEY_NAMES.join(", ")} present in local .env — nothing to publish.`);
  process.exit(1);
}

console.log(`Keys present locally (names only): ${names.join(", ")}`);
console.log(`Target: Vercel env (${scope}) — values travel encrypted, never echoed.`);
if (!apply) {
  console.log("Dry run. Re-run with --apply to publish.");
  console.log(
    "Needs ONE of: VERCEL_TOKEN env var (create at vercel.com/account/tokens), " +
      "or `vercel` CLI + `vercel login` (repo is already `vercel link`ed).",
  );
  process.exit(0);
}

if (process.env.VERCEL_TOKEN) {
  await publishViaApi(found, names, scope);
} else {
  publishViaCli(found, names, scope);
}
console.log("Done. Redeploy so the running functions pick the new env.");

async function publishViaApi(found, names, scope) {
  const token = process.env.VERCEL_TOKEN;
  const link = JSON.parse(readFileSync(new URL("../.vercel/project.json", import.meta.url), "utf8"));
  const base = `https://api.vercel.com/v10/projects/${link.projectId}/env?teamId=${link.orgId}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const existing = await (await fetch(base, { headers })).json();
  const rows = existing?.envs || [];
  for (const name of names) {
    const target = [scope];
    const same = rows.filter((e) => e.key === name && (e.target || []).some((t) => target.includes(t)));
    try {
      for (const e of same) {
        await fetch(`https://api.vercel.com/v9/projects/${link.projectId}/env/${e.id}?teamId=${link.orgId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      const res = await fetch(base, {
        method: "POST",
        headers,
        body: JSON.stringify({ key: name, value: found[name], type: "encrypted", target }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      console.log(`published ${name} → ${scope} (api)`);
    } catch (err) {
      console.error(`FAILED ${name}: ${String((err && err.message) || err).slice(0, 160)}`);
      process.exitCode = 1;
    }
  }
}

function publishViaCli(found, names, scope) {
  for (const name of names) {
    try {
      execFileSync("vercel", ["env", "add", name, scope], {
        input: found[name],
        stdio: ["pipe", "inherit", "inherit"],
      });
      console.log(`published ${name} → ${scope}`);
    } catch (err) {
      console.error(`FAILED ${name}: ${String((err && err.message) || err).slice(0, 160)}`);
      console.error("Hint: `npm i -g vercel` needs disk space (C: is full — clean first), then `vercel login`.");
      process.exitCode = 1;
    }
  }
}
