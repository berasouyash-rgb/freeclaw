/**
 * Vercel AI Gateway + AI SDK — runnable example.
 *
 * Run with:  npm run example:ai-gateway
 *
 * Configuration:
 *   The Gateway provider reads AI_GATEWAY_API_KEY from the environment, so the
 *   key never appears in this file. It is loaded from .env.local, which is
 *   gitignored (see .gitignore: `.env*`) and must never be committed.
 *
 * Model: `nvidia/…` routes through Vercel's Gateway to NVIDIA's Nemotron
 * models — the same family this app's `api/_providers.js` already calls
 * (super-120b / ultra-550b), so there is one model family, not two.
 * Override with AI_GATEWAY_MODEL without editing this file.
 */
import { config } from "dotenv";
import { generateText, gateway } from "ai";

// Load .env.local BEFORE anything reads the environment. `config({ path })`
// does not override an already-set variable, so a real env var always wins.
config({ path: ".env.local" });

const MODEL = process.env.AI_GATEWAY_MODEL || "nvidia/nemotron-3-super-120b-a12b";

const { text, usage, finishReason } = await generateText({
	model: gateway(MODEL),
	system: "You are concise and vivid. Answer in under 150 words, in plain prose.",
	prompt: [
		"Invent a brand new public holiday that does not exist in any country.",
		"Give it a short name and describe three traditions people would do on it.",
	].join(" "),
});

console.log(`model: ${MODEL}`);
console.log(`finishReason: ${finishReason}`);
console.log(
	`tokens: ${usage.totalTokens ?? 0} total ` +
		`(in ${usage.inputTokens ?? 0} / out ${usage.outputTokens ?? 0})`,
);
console.log("---");
console.log(text);
