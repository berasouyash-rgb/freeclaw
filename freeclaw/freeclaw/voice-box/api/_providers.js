// Multi-provider API key management with 50+ providers and failover chain.
// Keys stored in DB (settings.api_providers) with env vars as fallback.
// is_default provider goes FIRST in chain, then priority order.

import { auditLog, cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { maskPII } from "./_moderation.js";

// ─── OpenAI-compatible factory ─────────────────────────────────────
function openaiCompat(name, baseUrl, defaultModel, envKey) {
	return {
		name,
		defaultModel,
		baseUrl: baseUrl.endsWith("/") ? baseUrl + "chat/completions" : baseUrl,
		buildHeaders: (key) => ({
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		}),
		buildBody: (model, messages) => ({
			model,
			max_tokens: 2048,
			temperature: 0.2,
			messages,
		}),
		parseResponse: (data) => data?.choices?.[0]?.message?.content,
		envKey,
		compat: "openai",
	};
}

// ─── Anthropic-compatible factory ──────────────────────────────────
function anthropicCompat(name, baseUrl, defaultModel, envKey) {
	return {
		name,
		defaultModel,
		baseUrl,
		buildHeaders: (key) => ({
			"x-api-key": key,
			"anthropic-version": "2023-06-01",
			"Content-Type": "application/json",
		}),
		buildBody: (model, messages) => {
			const sys = messages.find((m) => m.role === "system");
			const user = messages.filter((m) => m.role !== "system");
			return {
				model,
				max_tokens: 2048,
				...(sys ? { system: sys.content } : {}),
				messages: user,
			};
		},
		parseResponse: (data) => data?.content?.[0]?.text,
		envKey,
		compat: "anthropic",
	};
}

// ─── Provider Registry (50+) ──────────────────────────────────────
// Categories: major, chinese, cloud, inference, self-hosted, custom
const PROVIDER_DEFS = {
	// ── Major ──────────────────────────────────────────────────────
	openai: openaiCompat(
		"OpenAI",
		"https://api.openai.com/v1/",
		"gpt-4o",
		"OPENAI_API_KEY",
	),
	anthropic: anthropicCompat(
		"Anthropic",
		"https://api.anthropic.com/v1/messages",
		"claude-sonnet-4-6",
		"ANTHROPIC_API_KEY",
	),
	gemini: openaiCompat(
		"Google Gemini",
		"https://generativelanguage.googleapis.com/v1beta/openai/",
		// gemini-2.5-flash was shut down Oct 16 2026 / 404s for new users —
		// point at the current cheap, stable Flash model.
		"gemini-3.5-flash",
		"GEMINI_API_KEY",
	),
	groq: openaiCompat(
		"Groq",
		"https://api.groq.com/openai/v1/",
		"llama-3.3-70b-versatile",
		"GROQ_API_KEY",
	),
	deepseek: openaiCompat(
		"DeepSeek",
		"https://api.deepseek.com/",
		"deepseek-chat",
		"DEEPSEEK_API_KEY",
	),
	mistral: openaiCompat(
		"Mistral",
		"https://api.mistral.ai/v1/",
		"mistral-large-latest",
		"MISTRAL_API_KEY",
	),
	nvidia: {
		...openaiCompat(
			"NVIDIA NIM",
			"https://integrate.api.nvidia.com/v1/",
			"nvidia/nemotron-3-ultra-550b-a55b",
			"NVIDIA_API_KEY",
		),
		// The free-tier shared worker is frequently congested (503/timeout);
		// a 4.5s default would make the PRIMARY nvidia entry fail on every
		// patrol while the fallback chain (7s+) succeeded. This value is the
		// requested budget — callProviderInner caps it at 30s (see below), so
		// the honest effective ceiling is 30s; the field is kept high so the
		// cap (not the default) is what governs.
		timeout: 30000,
		// Ultra is a REASONING model — enable thinking so every agent call
		// gets real analysis (measured: 6.8s @ budget 4096, 10.7s @ 8192).
		// 16k output budget matches the NIM reference client config.
		buildBody: (model, messages) => ({
			model,
			max_tokens: 16384,
			temperature: 1,
			top_p: 0.95,
			chat_template_kwargs: { enable_thinking: true },
			reasoning_budget: 4096,
			messages,
		}),
	},
	xai: openaiCompat("xAI", "https://api.x.ai/v1/", "grok-3", "XAI_API_KEY"),
	cohere: {
		name: "Cohere",
		defaultModel: "command-r-plus",
		baseUrl: "https://api.cohere.ai/v2/chat",
		buildHeaders: (key) => ({
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		}),
		buildBody: (model, messages) => ({
			model,
			messages: messages.filter((m) => m.role !== "system"),
			preamble: messages.find((m) => m.role === "system")?.content,
		}),
		parseResponse: (data) => data?.message?.content?.[0]?.text,
		envKey: "COHERE_API_KEY",
		compat: "cohere",
	},
	perplexity: openaiCompat(
		"Perplexity",
		"https://api.perplexity.ai/",
		"sonar",
		"PERPLEXITY_API_KEY",
	),
	together: openaiCompat(
		"Together AI",
		"https://api.together.xyz/v1/",
		"meta-llama/Llama-3-70b-chat-hf",
		"TOGETHER_API_KEY",
	),
	fireworks: openaiCompat(
		"Fireworks AI",
		"https://api.fireworks.ai/inference/v1/",
		"accounts/fireworks/models/llama-v3p3-70b-instruct",
		"FIREWORKS_API_KEY",
	),
	openrouter: openaiCompat(
		"OpenRouter",
		"https://openrouter.ai/api/v1/",
		"openai/gpt-4o",
		"OPENROUTER_API_KEY",
	),
	cerebras: openaiCompat(
		"Cerebras",
		"https://api.cerebras.ai/v1/",
		"llama-3.3-70b",
		"CEREBRAS_API_KEY",
	),
	// ── Chinese providers ──────────────────────────────────────────
	alibaba: openaiCompat(
		"Alibaba (DashScope)",
		"https://dashscope.aliyuncs.com/compatible-mode/v1/",
		"qwen-max",
		"DASHSCOPE_API_KEY",
	),
	zhipu: openaiCompat(
		"Zhipu AI",
		"https://open.bigmodel.cn/api/paas/v4/",
		"glm-4",
		"ZHIPU_API_KEY",
	),
	moonshot: openaiCompat(
		"Moonshot AI",
		"https://api.moonshot.ai/v1/",
		"moonshot-v1-128k",
		"MOONSHOT_API_KEY",
	),
	siliconflow: openaiCompat(
		"SiliconFlow",
		"https://api.siliconflow.cn/v1/",
		"Qwen/Qwen2.5-72B-Instruct",
		"SILICONFLOW_API_KEY",
	),
	modelscope: openaiCompat(
		"ModelScope",
		"https://api-inference.modelscope.cn/v1/",
		"Qwen/Qwen2.5-72B-Instruct",
		"MODELSCOPE_API_KEY",
	),
	sarvam: openaiCompat(
		"Sarvam AI",
		"https://api.sarvam.ai/",
		"saarika-2b",
		"SARVAM_API_KEY",
	),
	bailing: openaiCompat(
		"Bailing",
		"https://api.bailing.com/v1/",
		"bailing-chat",
		"BAILING_API_KEY",
	),
	// ── Cloud providers ────────────────────────────────────────────
	bedrock: {
		name: "Amazon Bedrock",
		defaultModel: "anthropic.claude-3-sonnet-20240229-v1:0",
		baseUrl: "",
		buildHeaders: () => ({}),
		buildBody: () => ({}),
		parseResponse: () => null,
		envKey: "AWS_BEDROCK_KEY",
		compat: "bedrock",
		note: "Requires AWS SDK — configure via AWS_BEDROCK_KEY env var",
	},
	azure_openai: {
		name: "Azure OpenAI",
		defaultModel: "gpt-4o",
		baseUrl: "",
		buildHeaders: () => ({}),
		buildBody: () => ({}),
		parseResponse: () => null,
		envKey: "AZURE_OPENAI_KEY",
		compat: "azure",
		note: "Requires {resource}.openai.azure.com endpoint",
	},
	azure_cognitive: {
		name: "Azure Cognitive Services",
		defaultModel: "gpt-4o",
		baseUrl: "",
		buildHeaders: () => ({}),
		buildBody: () => ({}),
		parseResponse: () => null,
		envKey: "AZURE_COGNITIVE_KEY",
		compat: "azure",
		note: "Requires {resource}.cognitiveservices.azure.com endpoint",
	},
	vertex_ai: {
		name: "Vertex AI",
		defaultModel: "gemini-3.5-flash",
		baseUrl: "",
		buildHeaders: () => ({}),
		buildBody: () => ({}),
		parseResponse: () => null,
		envKey: "VERTEX_AI_KEY",
		compat: "vertex",
		note: "Google Cloud regional endpoint",
	},
	cloudflare_ai: openaiCompat(
		"Cloudflare Workers AI",
		"https://api.cloudflare.com/client/v4/accounts/",
		"@cf/meta/llama-3.3-70b-instruct-fp16",
		"CLOUDFLARE_API_KEY",
	),
	snowflake: {
		name: "Snowflake Cortex",
		defaultModel: "snowflake-arctic",
		baseUrl: "",
		buildHeaders: () => ({}),
		buildBody: () => ({}),
		parseResponse: () => null,
		envKey: "SNOWFLAKE_KEY",
		compat: "snowflake",
		note: "Requires Snowflake Account URL",
	},
	scaleway: openaiCompat(
		"Scaleway",
		"https://api.scaleway.com/v1/",
		"llama-3.3-70b-instruct",
		"SCALEWAY_API_KEY",
	),
	digitalocean: openaiCompat(
		"DigitalOcean",
		"https://api.digitalocean.com/v1/",
		"llama-3.3-70b",
		"DIGITALOCEAN_API_KEY",
	),
	// ── Inference platforms ────────────────────────────────────────
	deepinfra: openaiCompat(
		"Deep Infra",
		"https://api.deepinfra.com/v1/openai/",
		"meta-llama/Meta-Llama-3.1-70B-Instruct",
		"DEEPINFRA_API_KEY",
	),
	huggingface: openaiCompat(
		"Hugging Face",
		"https://api-inference.huggingface.co/v1/",
		"meta-llama/Llama-3.3-70B-Instruct",
		"HF_API_KEY",
	),
	friendli: openaiCompat(
		"Friendli",
		"https://api.friendli.ai/serverless/v1/",
		"meta-llama-3.1-70b-instruct",
		"FRIENDLI_API_KEY",
	),
	baseten: openaiCompat(
		"Baseten",
		"https://app.baseten.co/v1/",
		"meta-llama-3.1-70b-instruct",
		"BASETEN_API_KEY",
	),
	novita: openaiCompat(
		"NovitaAI",
		"https://api.novita.ai/v3/openai/",
		"meta-llama-3.1-70b-instruct",
		"NOVITA_API_KEY",
	),
	venice: openaiCompat(
		"Venice AI",
		"https://api.venice.ai/api/v1/",
		"llama-3.3-70b",
		"VENICE_API_KEY",
	),
	nebius: openaiCompat(
		"Nebius",
		"https://api.studio.nebius.ai/v1/",
		"meta-llama-3.1-70b-instruct",
		"NEBIUS_API_KEY",
	),
	io_net: openaiCompat(
		"IO.NET",
		"https://api.io.net/v1/",
		"meta-llama-3.1-70b-instruct",
		"IONET_API_KEY",
	),
	inference_ai: openaiCompat(
		"Inference",
		"https://api.inference.ai/v1/",
		"meta-llama-3.1-70b-instruct",
		"INFERENCE_API_KEY",
	),
	inferx: openaiCompat(
		"InferX",
		"https://api.inferx.com/v1/",
		"default",
		"INFERX_API_KEY",
	),
	// ── 302.AI ecosystem ──────────────────────────────────────────
	h302: openaiCompat(
		"302.AI",
		"https://api.302.ai/v1/",
		"gpt-4o",
		"H302_API_KEY",
	),
	aihubmix: openaiCompat(
		"AIHubMix",
		"https://aihubmix.com/v1/",
		"gpt-4o",
		"AIHUBMIX_API_KEY",
	),
	ablit: openaiCompat(
		"abliteration.ai",
		"https://api.abliteration.ai/v1/",
		"default",
		"ABLIT_API_KEY",
	),
	anyapi: openaiCompat(
		"AnyAPI",
		"https://api.anyapi.com/v1/",
		"default",
		"ANYAPI_API_KEY",
	),
	atomic_chat: openaiCompat(
		"Atomic Chat",
		"https://api.atomicchat.com/v1/",
		"default",
		"ATOMIC_CHAT_API_KEY",
	),
	auriko: openaiCompat(
		"Auriko",
		"https://api.auriko.com/v1/",
		"default",
		"AURIKO_API_KEY",
	),
	berget: openaiCompat(
		"Berget.AI",
		"https://api.berget.ai/v1/",
		"default",
		"BERGET_API_KEY",
	),
	chutes: openaiCompat(
		"Chutes",
		"https://api.chutes.ai/v1/",
		"default",
		"CHUTES_API_KEY",
	),
	clarifai: {
		name: "Clarifai",
		defaultModel: "general",
		baseUrl: "https://api.clarifai.com/v2/models/",
		buildHeaders: () => ({}),
		buildBody: () => ({}),
		parseResponse: () => null,
		envKey: "CLARIFAI_API_KEY",
		compat: "clarifai",
		note: "Uses Clarifai prediction API format",
	},
	cortecs: openaiCompat(
		"Cortecs",
		"https://api.cortecs.ai/v1/",
		"default",
		"CORTECS_API_KEY",
	),
	github_models: openaiCompat(
		"GitHub Models",
		"https://models.inference.ai.azure.com/",
		"gpt-4o",
		"GITHUB_TOKEN",
	),
	poolside: openaiCompat(
		"Poolside",
		"https://api.poolside.ai/v1/",
		"default",
		"POOLSIDE_API_KEY",
	),
	requesty: openaiCompat(
		"Requesty",
		"https://router.requesty.ai/v1/",
		"gpt-4o",
		"REQUESTY_API_KEY",
	),
	sakana: openaiCompat(
		"Sakana AI",
		"https://api.sakana.ai/v1/",
		"default",
		"SAKANA_API_KEY",
	),
	upstage: openaiCompat(
		"Upstage",
		"https://api.upstage.ai/v1/",
		"solar-pro-2",
		"UPSTAGE_API_KEY",
	),
	z_ai: openaiCompat(
		"Z.AI",
		"https://api.z.ai/api/paas/v4/",
		"default",
		"ZAI_API_KEY",
	),
	wandb: openaiCompat(
		"Weights & Biases",
		"https://api.wandb.ai/v1/",
		"default",
		"WANDB_API_KEY",
	),
	vercel_ai: openaiCompat(
		"Vercel AI Gateway",
		"https://ai-gateway.vercel.sh/v1/",
		"gpt-4o",
		"VERCEL_AI_KEY",
	),
	// ── Self-hosted ────────────────────────────────────────────────
	ollama: openaiCompat(
		"Ollama",
		"http://localhost:11434/v1/",
		"llama3.1",
		"OLLAMA_HOST",
	),
	lmstudio: openaiCompat(
		"LM Studio",
		"http://localhost:1234/v1/",
		"default",
		"LMSTUDIO_HOST",
	),
	// ── Other custom ──────────────────────────────────────────────
	cf_gateway: openaiCompat(
		"Cloudflare AI Gateway",
		"https://gateway.ai.cloudflare.com/v1/",
		"default",
		"CF_AI_GATEWAY_KEY",
	),
	ambient: openaiCompat(
		"Ambient",
		"https://api.ambient.com/v1/",
		"default",
		"AMBIENT_API_KEY",
	),
	sap_ai_core: {
		name: "SAP AI Core",
		defaultModel: "gpt-4o",
		baseUrl: "",
		buildHeaders: () => ({}),
		buildBody: () => ({}),
		parseResponse: () => null,
		envKey: "SAP_AI_KEY",
		compat: "sap",
		note: "SAP AI Core Customer Endpoint",
	},
	gitlab_duo: {
		name: "GitLab Duo",
		defaultModel: "default",
		baseUrl: "",
		buildHeaders: () => ({}),
		buildBody: () => ({}),
		parseResponse: () => null,
		envKey: "GITLAB_DUO_KEY",
		compat: "gitlab",
		note: "GitLab Instance URL required",
	},
	poe: {
		name: "Poe",
		defaultModel: "default",
		baseUrl: "",
		buildHeaders: () => ({}),
		buildBody: () => ({}),
		parseResponse: () => null,
		envKey: "POE_API_KEY",
		compat: "poe",
		note: "No public API — requires Quora access",
	},
	meta: {
		name: "Meta",
		defaultModel: "llama-3.3-70b",
		baseUrl: "",
		buildHeaders: () => ({}),
		buildBody: () => ({}),
		parseResponse: () => null,
		envKey: "META_API_KEY",
		compat: "meta",
		note: "No public API endpoint",
	},
	ovhcloud: openaiCompat(
		"OVHcloud AI Endpoints",
		"https://endpoints.ai.cloud.ovh.net/v1/",
		"meta-llama-3.1-70b-instruct",
		"OVHCLOUD_API_KEY",
	),
};

// ─── Category map for frontend grouping ────────────────────────────
export const PROVIDER_CATEGORIES = {
	major: [
		"openai",
		"anthropic",
		"gemini",
		"groq",
		"deepseek",
		"mistral",
		"nvidia",
		"xai",
		"cohere",
		"perplexity",
		"together",
		"fireworks",
		"openrouter",
		"cerebras",
	],
	chinese: [
		"alibaba",
		"zhipu",
		"moonshot",
		"siliconflow",
		"modelscope",
		"sarvam",
		"bailing",
	],
	cloud: [
		"bedrock",
		"azure_openai",
		"azure_cognitive",
		"vertex_ai",
		"cloudflare_ai",
		"snowflake",
		"scaleway",
		"digitalocean",
	],
	inference: [
		"deepinfra",
		"huggingface",
		"friendli",
		"baseten",
		"novita",
		"venice",
		"nebius",
		"io_net",
		"inference_ai",
		"inferx",
	],
	ecosystem_302: [
		"h302",
		"aihubmix",
		"ablit",
		"anyapi",
		"atomic_chat",
		"auriko",
		"berget",
		"chutes",
		"clarifai",
		"cortecs",
		"github_models",
		"poolside",
		"requesty",
		"sakana",
		"upstage",
		"z_ai",
		"wandb",
		"vercel_ai",
	],
	selfhosted: ["ollama", "lmstudio"],
	other: [
		"cf_gateway",
		"ambient",
		"sap_ai_core",
		"gitlab_duo",
		"poe",
		"meta",
		"ovhcloud",
	],
};

// Category display names
export const CATEGORY_NAMES = {
	major: "Major Providers",
	chinese: "Chinese Providers",
	cloud: "Cloud Platforms",
	inference: "Inference Platforms",
	ecosystem_302: "302.AI Ecosystem",
	selfhosted: "Self-Hosted",
	other: "Other / Custom",
};

// ─── DB helpers ───────────────────────────────────────────────────
// Providers are read from the DB on every LLM call (several times per
// chat run). Cache briefly to avoid a DB round-trip per iteration;
// invalidated on save so admin edits take effect immediately.
const PROVIDERS_CACHE_TTL = 2000;
let _providersCache = { at: 0, value: null };

async function getProviders() {
	const now = Date.now();
	if (
		_providersCache.value !== null &&
		now - _providersCache.at < PROVIDERS_CACHE_TTL
	) {
		return _providersCache.value;
	}
	const { data, error } = await supabase
		.from("settings")
		.select("value")
		.eq("key", "api_providers")
		.maybeSingle();
	// Never cache on DB error — a transient blip must not mask configured providers
	if (error) return data?.value || {};
	_providersCache = { at: now, value: data?.value || {} };
	return _providersCache.value;
}

async function saveProviders(providers) {
	_providersCache = { at: 0, value: null }; // invalidate cache first
	invalidateChainCache();
	invalidateLLMStatus(); // LLM availability may change now — never serve a stale degraded/fine verdict
	const { data } = await supabase
		.from("settings")
		.select("key")
		.eq("key", "api_providers")
		.maybeSingle();
	let error = null;
	if (data) {
		const res = await supabase
			.from("settings")
			.update({ value: providers })
			.eq("key", "api_providers");
		error = res.error;
	} else {
		const res = await supabase
			.from("settings")
			.insert({ key: "api_providers", value: providers });
		error = res.error;
	}
	// Only warm the cache when the write actually succeeded
	if (!error) _providersCache = { at: Date.now(), value: providers };
}

function maskKey(key) {
	if (!key || key.length < 8) return "";
	return "••••••" + key.slice(-4);
}

// ─── Degraded fast-guard ─────────────────────────────────────────
// Zero usable keys means every callLLMChain iteration would burn the
// full per-provider timeout chain (seconds per provider × dozens of
// providers) before failing — a multi-minute hang for every agent
// execution. Instead we detect "no key anywhere" cheaply and let
// callers fail fast with an honest AI PROVIDER DEGRADED signal.
let _llmStatusCache = { at: 0, usable: null };
const LLM_STATUS_TTL = 30000; // 30s TTL (keys can be added in admin)

/** True when at least one provider has a usable key (DB or env). */
export async function hasUsableLLM() {
	const now = Date.now();
	if (
		_llmStatusCache.usable !== null &&
		now - _llmStatusCache.at < LLM_STATUS_TTL
	)
		return _llmStatusCache.usable;
	try {
		const chain = await buildChain();
		const nimUsable = NIM_FALLBACK_CHAIN.some((p) => p.key && p.baseUrl);
		_llmStatusCache = { at: now, usable: chain.length > 0 || nimUsable };
	} catch {
		_llmStatusCache = { at: now, usable: false };
	}
	return _llmStatusCache.usable;
}

/** Force the next hasUsableLLM() call to re-check (after saving a key). */
export function invalidateLLMStatus() {
	_llmStatusCache = { at: 0, usable: null };
}

// ─── Circuit breaker (cooldown) ──────────────────────────────────
// After a provider fails, skip it for COOLDOWN_MS so the failover
// chain doesn't re-try a known-dead provider on every single call
// (previously this wasted 5s+ on every request). 60s so one saturated
// burst (a whole patrol) doesn't re-try the dead provider per task —
// a task takes 20-45s, so the old 15s window always expired first.
const COOLDOWN_MS = 60000;
const _cooldowns = new Map();

function isOnCooldown(id) {
	const until = _cooldowns.get(id);
	return !!until && until > Date.now();
}
function markCooldown(id) {
	_cooldowns.set(id, Date.now() + COOLDOWN_MS);
}
function clearCooldown(id) {
	_cooldowns.delete(id);
}

// ─── Get default provider ID ──────────────────────────────────────
export async function getDefaultProviderId() {
	const db = await getProviders();
	for (const [id, cfg] of Object.entries(db)) {
		if (cfg.is_default && cfg.enabled && cfg.key) return id;
	}
	const sorted = Object.entries(db)
		.filter(([, cfg]) => cfg.enabled && cfg.key)
		.sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99));
	return sorted[0]?.[0] || null;
}

// FIX #19: Cache provider chain 60s to avoid DB hit per LLM call
let _chainCache = null;
let _chainExpiry = 0;
const CHAIN_TTL_MS = 60_000;
export function invalidateChainCache() { _chainCache = null; _chainExpiry = 0; }

// ─── Build failover chain ─────────────────────────────────────────
export async function buildChain() {
	const now = Date.now();
	if (_chainCache && _chainExpiry > now) return _chainCache;
	const db = await getProviders();
	const chain = [];
	let defaultId = null;
	for (const [id, cfg] of Object.entries(db)) {
		if (cfg.is_default && cfg.enabled && cfg.key) {
			defaultId = id;
			break;
		}
	}
	const dbEntries = Object.entries(db)
		.filter(([id, cfg]) => cfg.enabled && cfg.key)
		.sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99));
	if (defaultId && PROVIDER_DEFS[defaultId]) {
		const cfg = db[defaultId];
		chain.push({
			id: defaultId,
			...PROVIDER_DEFS[defaultId],
			key: cfg.key,
			model: cfg.model || PROVIDER_DEFS[defaultId].defaultModel,
			isDefault: true,
		});
	}
	for (const [id, cfg] of dbEntries) {
		if (id === defaultId) continue;
		const def = PROVIDER_DEFS[id];
		if (!def) continue;
		chain.push({
			id,
			...def,
			key: cfg.key,
			model: cfg.model || def.defaultModel,
		});
	}
	const dbIds = new Set(dbEntries.map(([id]) => id));
	for (const [id, def] of Object.entries(PROVIDER_DEFS)) {
		if (dbIds.has(id)) continue;
		const key = process.env[def.envKey];
		if (key) chain.push({ id, ...def, key, model: def.defaultModel });
	}
	_chainCache = chain;
	_chainExpiry = Date.now() + CHAIN_TTL_MS;
	return chain;
}

// ─── Get provider config ──────────────────────────────────────────
export async function getProviderConfig(id) {
	const db = await getProviders();
	const cfg = db[id] || {};
	const def = PROVIDER_DEFS[id];
	if (!def) return null;
	return {
		id,
		name: def.name,
		model: cfg.model || def.defaultModel,
		enabled: !!cfg.enabled,
		key: cfg.key || process.env[def.envKey] || null,
		isDefault: !!cfg.is_default,
		baseUrl: def.baseUrl,
		buildHeaders: def.buildHeaders,
		buildBody: def.buildBody,
		parseResponse: def.parseResponse,
	};
}

// ─── Call one provider ────────────────────────────────────────────
// ─── NIM concurrency cap ──────────────────────────────────────────
// Free-tier NIM runs on shared cluster workers with a ~32-request queue.
// A workforce of 111 agents firing parallel LLM calls can exhaust the
// worker and trigger 503s for everyone (and each other). Cap concurrent
// NIM requests so bursts serialize instead of saturating the shared worker.
const NIM_MAX_CONCURRENCY = 1; // Free-tier NIM worker handles ~1 inference at a time. >1 saturates it: ultra times out (30s) and every call degrades to the llama fallback. Patrols run agents sequentially anyway, so serializing costs nothing and each ultra call gets the whole worker (measured 2.5–10s solo).
const NIM_MAX_QUEUE = 8; // beyond this, new calls fail fast instead of queueing
let nimActive = 0;
const nimQueue = [];
function isNimProvider(provider) {
	return !!(
		provider &&
		(String(provider.id || "").startsWith("nvidia") ||
			String(provider.baseUrl || "").includes("api.nvidia.com"))
	);
}
const NIM_QUEUE_WAIT_MS = 20000; // max time a call may park waiting for a slot
function acquireNimSlot() {
	if (nimActive < NIM_MAX_CONCURRENCY) {
		nimActive++;
		return Promise.resolve(true);
	}
	// Overload guard: deep queue = worker congestion. Fail fast (caller skips)
	// rather than parking a request indefinitely — preserves the fail-fast
	// behavior the whole redesign targets.
	if (nimQueue.length >= NIM_MAX_QUEUE) return Promise.resolve(false);
	return new Promise((resolve) => {
		const entry = () => resolve(true);
		// A queued call must never wait forever (e.g. a streaming chat holding
		// the single slot while a patrol needs it) — bail out after a bounded
		// wait so the caller's failover chain can move on.
		const timer = setTimeout(() => {
			const i = nimQueue.indexOf(entry);
			if (i >= 0) nimQueue.splice(i, 1);
			resolve(false);
		}, NIM_QUEUE_WAIT_MS);
		nimQueue.push(() => {
			clearTimeout(timer);
			entry();
		});
	});
}
function releaseNimSlot() {
	nimActive--;
	const next = nimQueue.shift();
	if (next) {
		nimActive++;
		next();
	}
}

async function callProvider(provider, messages, timeoutMs) {
	const nimSlot = isNimProvider(provider);
	if (nimSlot) {
		const ok = await acquireNimSlot();
		if (!ok)
			return {
				ok: false,
				error: "NIM worker saturated — skipped (queue full)",
			};
	}
	try {
		return await callProviderInner(provider, messages, timeoutMs);
	} finally {
		if (nimSlot) releaseNimSlot();
	}
}

async function callProviderInner(provider, messages, timeoutMs) {
	if (!provider.baseUrl)
		return {
			ok: false,
			error: `Provider ${provider.name} requires manual configuration (${provider.note || "no endpoint"})`,
		};
	// Shorter, smarter timeouts: use the caller's explicit timeout,
	// fall back to the provider's declared timeout, else 4.5s default.
	// Cap at 30s: a REASONING model (thinking enabled) can legitimately take
	// 10-25s on the batch path; 20s still caused occasional false-failover
	// under free-tier congestion. Still bounded so a hung provider can
	// never stall the chain beyond one shared budget.
	const effective = Math.max(
		1500,
		Math.min(timeoutMs || provider.timeout || 4500, 30000),
	);
	const controller = new AbortController();
	let timer = setTimeout(() => controller.abort(), effective);
	try {
		// Outbound PII scrub — never send raw emails/phones/addresses to the
		// provider (NIM or any other). Placeholders keep structure for the model.
		const safeMessages = messages.map((m) => ({
			...m,
			content: maskPII(m.content),
		}));

		// Retry/backoff on transient 429/503 (NIM free tier returns
		// "ResourceExhausted" while a shared worker is momentarily saturated
		// — it frees up within seconds). Two bounded retries with backoff; the
		// overall budget stays capped so a persistent outage fails fast and
		// the failover chain moves on.
		let resp = null;
		let lastErr = "";
		// SHARED total budget across all attempts: the whole provider call
		// (retries included) must finish within `effective` ms. Refreshing the
		// abort timer per attempt previously multiplied the budget by the
		// retry count (3×20s = 60s per provider per call) — that's what made
		// a 6-agent patrol burn 170-230s instead of ~20s.
		const deadline = Date.now() + effective;
		// Two attempts max for transient 429/503: a saturated NIM worker
		// won't free up in 3s, so a third retry just burns budget before
		// the failover chain moves on.
		for (let attempt = 0; attempt < 2; attempt++) {
			const backoff = attempt > 0 ? 1000 : 0; // 0, 1s
			if (backoff > 0) {
				await new Promise((r) => setTimeout(r, backoff));
				clearTimeout(timer);
				const remaining = deadline - Date.now();
				if (remaining <= 0) { lastErr = "Timeout"; break; }
				timer = setTimeout(() => controller.abort(), remaining);
			}
			try {
				resp = await fetch(provider.baseUrl, {
					method: "POST",
					headers: provider.buildHeaders(provider.key),
					body: JSON.stringify(provider.buildBody(provider.model, safeMessages)),
					signal: controller.signal,
				});
				if (resp.ok || (resp.status !== 429 && resp.status !== 503)) break;
				lastErr = `HTTP ${resp.status}`;
				console.warn(
					`[LLM] ${provider.id} transient ${resp.status} — retry ${attempt + 1}/2 (${backoff}ms backoff)`,
				);
			} catch (e) {
				// AbortError means the shared budget was consumed — the controller
				// is one-shot, so retrying would fail instantly. Break immediately.
				resp = null;
				lastErr = e.name === "AbortError" ? "Timeout" : e.message;
				break;
			}
		}
		if (!resp)
			return {
				ok: false,
				error: lastErr || "Request failed",
			};
		if (!resp.ok) {
			const err = await resp.text().catch(() => "");
			return {
				ok: false,
				status: resp.status,
				error: `HTTP ${resp.status}: ${err.slice(0, 200)}`,
			};
		}
		const data = await resp.json();
		const text = provider.parseResponse(data);
		if (!text) return { ok: false, error: "Empty response from provider" };
		return { ok: true, text, provider: provider.id, model: provider.model };
	} catch (e) {
		return {
			ok: false,
			error: e.name === "AbortError" ? "Timeout" : e.message,
		};
	} finally {
		clearTimeout(timer);
	}
}

// ─── Hardcoded NIM fallback chain ────────────────────────────────
// Used when DB-stored provider chain is empty (no keys configured).
// These keys are user-provided and specific to this deployment.
const NIM_FALLBACK_CHAIN = [
	// Tier 1: Llama 3.1 8B -- always-available, ultra-fast congestion escape hatch
	{
		id: "nvidia-llama-8b",
		name: "Llama 3.1 8B Fast",
		defaultModel: "meta/llama-3.1-8b-instruct",
		baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
		model: "meta/llama-3.1-8b-instruct",
		key: process.env.NVIDIA_API_KEY || "",
		buildHeaders: (key) => ({
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		}),
		buildBody: (model, messages) => ({
			model,
			max_tokens: 4096,
			temperature: 0.2,
			messages,
		}),
		parseResponse: (data) => data?.choices?.[0]?.message?.content,
		timeout: 12000,
	},
	// Tier 2: Nemotron Nano 30B -- very fast emergency fallback
	{
		id: "nvidia-nemotron-nano",
		name: "NVIDIA Nemotron Nano 30B",
		defaultModel: "nvidia/nemotron-3-nano-30b-a3b",
		baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
		model: "nvidia/nemotron-3-nano-30b-a3b",
		key: process.env.NVIDIA_API_KEY || "",
		buildHeaders: (key) => ({
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		}),
		buildBody: (model, messages) => ({
			model,
			max_tokens: 2048,
			temperature: 0.2,
			messages,
		}),
		parseResponse: (data) => data?.choices?.[0]?.message?.content,
		timeout: 12000,
	},
	// Tier 3: Llama 3.3 Nemotron Super 49B -- high quality, fast when its worker is free
	{
		id: "nvidia-nemotron-super-49b",
		name: "NVIDIA Llama 3.3 Nemotron Super 49B",
		defaultModel: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
		baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
		model: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
		key: process.env.NVIDIA_API_KEY || "",
		buildHeaders: (key) => ({
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		}),
		buildBody: (model, messages) => ({
			model,
			max_tokens: 4096,
			temperature: 0.3,
			top_p: 0.9,
			messages,
		}),
		parseResponse: (data) => data?.choices?.[0]?.message?.content,
		timeout: 8000,
	},
	// Tier 4: Nemotron 3 Ultra 550B -- flagship quality, often congested on free tier
	{
		id: "nvidia-nemotron-ultra",
		name: "NVIDIA Nemotron 3 Ultra 550B",
		defaultModel: "nvidia/nemotron-3-ultra-550b-a55b",
		baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
		model: "nvidia/nemotron-3-ultra-550b-a55b",
		key: process.env.NVIDIA_API_KEY || "",
		buildHeaders: (key) => ({
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		}),
		buildBody: (model, messages) => ({
			model,
			max_tokens: 4096,
			temperature: 0.3,
			top_p: 0.9,
			messages,
		}),
		parseResponse: (data) => data?.choices?.[0]?.message?.content,
		timeout: 9000,
	},
	// Tier 5: Nemotron 3 Super 120B -- strong reasoning, may need higher access tier (kept last)
	{
		id: "nvidia-nemotron-super",
		name: "NVIDIA Nemotron 3 Super 120B",
		defaultModel: "nvidia/nemotron-3-super-120b-a12b",
		baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
		model: "nvidia/nemotron-3-super-120b-a12b",
		key: process.env.NVIDIA_API_KEY || "",
		buildHeaders: (key) => ({
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		}),
		buildBody: (model, messages) => ({
			model,
			max_tokens: 4096,
			temperature: 0.3,
			top_p: 0.9,
			messages,
		}),
		parseResponse: (data) => data?.choices?.[0]?.message?.content,
		timeout: 8000,
	},
];

// ─── Failover chain call ─────────────────────────────────────────
export async function callLLMChain(system, user, extraMessages = []) {
	const messages = [
		{ role: "system", content: system },
		...extraMessages,
		{ role: "user", content: user },
	];

	// Degraded fast-guard: no key configured anywhere → fail immediately
	// with an explicit marker instead of timing out across the whole chain.
	if (!(await hasUsableLLM())) {
		return {
			ok: false,
			degraded: true,
			error: "AI PROVIDER DEGRADED — no API key configured",
		};
	}

	// 1. Try DB-configured providers first (skip recently-failed ones)
	const chain = await buildChain();
	const freshChain = chain.filter((p) => !isOnCooldown(p.id));
	for (const provider of freshChain.length > 0 ? freshChain : chain) {
		const result = await callProvider(provider, messages);
		if (result.ok) {
			clearCooldown(provider.id);
			return {
				provider: result.provider,
				model: result.model,
				text: result.text,
			};
		}
		markCooldown(provider.id);
		console.warn(`[LLM] DB provider ${provider.id} failed:`, result.error);
	}

	// 2. Hardcoded NIM fallback (skip recently-failed ones)
	if (chain.length === 0) {
		console.log("[LLM] No DB providers configured — using NIM fallback chain");
	}
	const freshNim = NIM_FALLBACK_CHAIN.filter((p) => !isOnCooldown(p.id));
	for (const provider of freshNim.length > 0 ? freshNim : NIM_FALLBACK_CHAIN) {
		const result = await callProvider(provider, messages);
		if (result.ok) {
			clearCooldown(provider.id);
			console.log(
				`[LLM] NIM fallback ${provider.id} succeeded (${provider.model})`,
			);
			return {
				provider: provider.id,
				model: provider.model,
				text: result.text,
			};
		}
		markCooldown(provider.id);
		console.warn(`[LLM] NIM fallback ${provider.id} failed:`, result.error);
	}

	console.error(
		"[LLM] ALL providers failed — returning null (built-in fallback will be used)",
	);
	return null;
}

// ─── Streaming call (SSE) ────────────────────────────────────────
// Calls providers with stream:true and pipes tokens to callback.
// Returns { ok, text, provider, model } when done.
export async function callProviderStream(
	messages,
	{ onToken, onDone, onError } = {},
) {
	// Degraded fast-guard — same rule as the batch path: no key → no hang.
	if (!(await hasUsableLLM())) {
		if (onError)
			onError(new Error("AI PROVIDER DEGRADED — no API key configured"));
		return { ok: false, degraded: true, text: "", provider: null, model: null };
	}
	// Streaming shares the same NIM slot pool as batch calls, so an admin
	// chat stream + a workforce burst can never exceed the worker cap.
	const nimSlot = await acquireNimSlot();
	if (!nimSlot) {
		if (onError) onError(new Error("NIM worker saturated — try again shortly"));
		return { ok: false, degraded: true, text: "", provider: null, model: null };
	}
	try {
		const providers = [];

		// Build chain: DB providers first, then NIM fallback
		const dbChain = await buildChain();
		for (const p of dbChain) providers.push(p);
		for (const p of NIM_FALLBACK_CHAIN) providers.push(p);

		// Skip recently-failed providers so we don't re-hang on them
		const candidates = providers.filter((p) => !isOnCooldown(p.id));
		const chain = candidates.length > 0 ? candidates : providers;

		for (const provider of chain) {
			if (!provider.baseUrl) continue;

			// Shorter, smarter timeouts: fail over if the provider doesn't emit
			// its FIRST token within TTFB_MS (hung stream was the #1 cause of
			// "Admin AI feels slow"), and abort the whole stream after TOTAL_MS.
			// 10s TTFB avoids false failover on large prompts under NVIDIA queue load.
			const TTFB_MS = 10000;
			const TOTAL_MS = Math.min(provider.timeout || 25000, 25000);
			const controller = new AbortController();
			let gotFirstToken = false;
			const ttfbTimer = setTimeout(() => controller.abort(), TTFB_MS);
			const totalTimer = setTimeout(() => controller.abort(), TOTAL_MS);

			try {
				// Outbound PII scrub — same defense-in-depth as the batch path.
				const safeMessages = messages.map((m) => ({
					...m,
					content: maskPII(m.content),
				}));
				const body = provider.buildBody(provider.model, safeMessages);
				body.stream = true;

				const resp = await fetch(provider.baseUrl, {
					method: "POST",
					headers: provider.buildHeaders(provider.key),
					body: JSON.stringify(body),
					signal: controller.signal,
				});

				if (!resp.ok) {
					const errText = await resp.text().catch(() => "");
					console.warn(
						`[LLM-STREAM] ${provider.id} HTTP ${resp.status}: ${errText.slice(0, 200)}`,
					);
					markCooldown(provider.id);
					continue;
				}

				let fullText = "";
				const reader = resp.body?.getReader();
				if (!reader) continue;

				const decoder = new TextDecoder();
				let buffer = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					if (!gotFirstToken) {
						gotFirstToken = true;
						clearTimeout(ttfbTimer); // first token arrived — stream is alive
					}

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";

					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed || !trimmed.startsWith("data: ")) continue;
						const dataStr = trimmed.slice(6);
						if (dataStr === "[DONE]") continue;

						try {
							const chunk = JSON.parse(dataStr);
							const delta = chunk?.choices?.[0]?.delta;
							const content = delta?.content || "";
							if (content) {
								fullText += content;
								if (onToken) onToken(content);
							}
						} catch {
							/* skip malformed chunks */
						}
					}
				}

				if (fullText) {
					clearCooldown(provider.id);
					if (onDone) onDone();
					console.log(
						`[LLM-STREAM] ${provider.id} succeeded (${fullText.length} chars)`,
					);
					return {
						ok: true,
						text: fullText,
						provider: provider.id,
						model: provider.model,
					};
				}
			} catch (err) {
				const msg =
					err.name === "TimeoutError" || err.name === "AbortError"
						? "Timeout"
						: err.message;
				console.warn(`[LLM-STREAM] ${provider.id} failed:`, msg);
				markCooldown(provider.id);
				if (onError) onError(err);
			} finally {
				clearTimeout(ttfbTimer);
				clearTimeout(totalTimer);
			}
		}

		console.error("[LLM-STREAM] ALL providers failed");
		return { ok: false, text: "", provider: null, model: null };
	} finally {
		releaseNimSlot();
	}
}

// ─── HTTP Handler ────────────────────────────────────────────────
export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	try {
		const b = req.body || {};
		const action = req.method === "GET" ? req.query.action || "list" : b.action;

		// GET categories and list are public (no auth required) — frontend needs them
		if (req.method === "GET" && action === "categories") {
			return res
				.status(200)
				.json({
					categories: PROVIDER_CATEGORIES,
					names: CATEGORY_NAMES,
					total: Object.keys(PROVIDER_DEFS).length,
				});
		}

		if (req.method === "GET" && action === "list") {
			// FIX #7: Provider config (incl. masked keys) is admin-only — was public
			if (!(await isAdmin(req))) return res.status(403).json({ error: "Admin only" });
			const db = await getProviders();
			const filterCategory = req.query.category || null;
			const filterEnabledOnly =
				req.query.enabled_only === "true" || req.query.enabled_only === "1";
			// FIX #35: Pagination/filtering to avoid ~15KB payload — support limit/offset/category/enabled_only
			const hasPagination = req.query.limit !== undefined || req.query.offset !== undefined;
			const limit = Math.min(parseInt(req.query.limit) || 50, 50);
			const offset = Math.max(parseInt(req.query.offset) || 0, 0);
			const entries = Object.entries(PROVIDER_DEFS).filter(([id, def]) => {
				const cfg = db[id] || {};
				if (filterCategory && def.category !== filterCategory) return false;
				if (filterEnabledOnly && !cfg.enabled) return false;
				return true;
			});
			const paged = hasPagination ? entries.slice(offset, offset + limit) : entries;
			const result = {};
			for (const [id, def] of paged) {
				const cfg = db[id] || {};
				result[id] = {
					id,
					name: def.name,
					model: cfg.model || def.defaultModel,
					enabled: !!cfg.enabled,
					priority: cfg.priority || Object.keys(PROVIDER_DEFS).indexOf(id) + 1,
					is_default: !!cfg.is_default,
					status: cfg.status || "untested",
					last_tested: cfg.last_tested || null,
					key_masked: cfg.key
						? maskKey(cfg.key)
						: process.env[def.envKey]
							? maskKey(process.env[def.envKey])
							: "",
					has_env_key: !!process.env[def.envKey],
					compat: def.compat || "openai",
					note: def.note || null,
					category: def.category || "other",
				};
			}
			if (hasPagination) return res.status(200).json({ providers: result, total: entries.length, limit, offset });
			return res.status(200).json(result);
		}

		if (req.method !== "POST")
			return res.status(405).json({ error: "Method not allowed" });

		// All POST actions require admin auth
		if (!(await isAdmin(req)))
			return res.status(403).json({ error: "Admin only" });

		if (action === "set_default") {
			const { provider: pid } = b;
			if (!pid || !PROVIDER_DEFS[pid])
				return res.status(400).json({ error: "Invalid provider" });
			const db = await getProviders();
			for (const id of Object.keys(db)) {
				if (db[id].is_default) db[id].is_default = false;
			}
			if (!db[pid]) db[pid] = {};
			db[pid].is_default = true;
			await saveProviders(db);
			await auditLog("admin", "set_default_provider", `Default set to ${pid}`);
			return res.status(200).json({ ok: true, default: pid });
		}

		if (action === "update_provider") {
			const { provider: pid, config } = b;
			if (!pid || !PROVIDER_DEFS[pid])
				return res.status(400).json({ error: "Invalid provider" });
			const db = await getProviders();
			db[pid] = { ...(db[pid] || {}), ...config };
			if (config.key !== undefined) db[pid].status = "untested";
			await saveProviders(db);
			await auditLog("admin", "update_provider", `Updated ${pid}`);
			return res.status(200).json({ ok: true });
		}

		if (action === "test_provider") {
			const { provider: pid } = b;
			if (!pid || !PROVIDER_DEFS[pid])
				return res.status(400).json({ error: "Invalid provider" });
			const def = PROVIDER_DEFS[pid];
			const db = await getProviders();
			const cfg = db[pid] || {};
			const key = cfg.key || process.env[def.envKey];
			if (!key) return res.status(400).json({ error: "No API key configured" });
			const provider = {
				id: pid,
				...def,
				key,
				model: cfg.model || def.defaultModel,
			};
			const start = Date.now();
			const result = await callProvider(
				provider,
				[
					{ role: "system", content: "Respond with ONLY valid JSON." },
					{ role: "user", content: '{"response":"hello"}' },
				],
				10000,
			);
			const latency = Date.now() - start;
			db[pid] = {
				...(db[pid] || {}),
				status: result.ok ? "ok" : "failed",
				last_tested: new Date().toISOString(),
			};
			await saveProviders(db);
			return res
				.status(200)
				.json({
					success: result.ok,
					latency_ms: latency,
					model: provider.model,
					error: result.ok ? undefined : result.error,
				});
		}

		if (action === "test_all") {
			const db = await getProviders();
			// Collect providers that have keys
			const toTest = [];
			for (const [pid, def] of Object.entries(PROVIDER_DEFS)) {
				const cfg = db[pid] || {};
				const key = cfg.key || process.env[def.envKey];
				if (!key) {
					db[pid] = {
						...(db[pid] || {}),
						status: "no_key",
						last_tested: new Date().toISOString(),
					};
					continue;
				}
				toTest.push({ pid, def, cfg, key });
			}
			// Test in parallel batches of 10 to avoid Vercel function timeout
			const BATCH = 10;
			const results = {};
			for (let i = 0; i < toTest.length; i += BATCH) {
				const batch = toTest.slice(i, i + BATCH);
				const batchResults = await Promise.allSettled(
					batch.map(async ({ pid, def, cfg, key }) => {
						const provider = {
							id: pid,
							...def,
							key,
							model: cfg.model || def.defaultModel,
						};
						const start = Date.now();
						const result = await callProvider(
							provider,
							[
								{ role: "system", content: "Respond with ONLY valid JSON." },
								{ role: "user", content: '{"response":"hello"}' },
							],
							8000,
						);
						db[pid] = {
							...(db[pid] || {}),
							status: result.ok ? "ok" : "failed",
							last_tested: new Date().toISOString(),
						};
						return {
							pid,
							success: result.ok,
							latency_ms: Date.now() - start,
							model: provider.model,
							error: result.ok ? undefined : result.error,
						};
					}),
				);
				batchResults.forEach((r) => {
					if (r.status === "fulfilled") results[r.value.pid] = r.value;
				});
			}
			await saveProviders(db);
			await auditLog(
				"admin",
				"test_all_providers",
				`Tested ${toTest.length} providers`,
			);
			return res.status(200).json(results);
		}

		if (action === "reorder_providers") {
			const { order } = b;
			if (!Array.isArray(order))
				return res.status(400).json({ error: "order must be an array" });
			const db = await getProviders();
			order.forEach((pid, i) => {
				if (db[pid]) db[pid].priority = i + 1;
			});
			await saveProviders(db);
			await auditLog(
				"admin",
				"reorder_providers",
				`New order: ${order.join(", ")}`,
			);
			return res.status(200).json({ ok: true });
		}

		return res.status(400).json({ error: "Unknown action" });
	} catch (err) {
		return sanitizeError(res, err, "providers");
	}
}
