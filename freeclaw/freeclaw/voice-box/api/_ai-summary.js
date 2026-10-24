// ═══════════════════════════════════════════════════════════════════
// AI SUMMARY — auto-generate concise summaries for posts
// ═══════════════════════════════════════════════════════════════════
// POST /api/ai-summary
//   { post_id, title, description, category }
//
// Returns:
//   { summary: string, keywords: string[], category_suggestion: string }
//
// Uses deterministic extraction first, falls back to NVIDIA LLM only
// when the content is long enough to benefit from AI summarization.
// ═══════════════════════════════════════════════════════════════════

import { clientIp, cors, rateLimited, rateLimitResponse, clean } from "./_auth.js";
import supabase from "./_db-client.js";
import { callNvidiaFast } from "./_providers.js";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = "openai/gpt-oss-20b";

/**
 * Deterministic extractive summary — no AI needed.
 * Takes the first 2 meaningful sentences.
 */
function deterministicSummary(title, description) {
  const text = `${title}. ${description || ""}`.trim();
  if (!text || text.length < 20) return title || "";

  // Split into sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const meaningful = sentences.filter((s) => s.trim().length > 15);

  if (meaningful.length <= 1) return meaningful[0]?.trim() || title;
  return meaningful.slice(0, 2).join(" ").trim();
}

/**
 * Extract keywords from text using simple TF-like scoring.
 */
function extractKeywords(title, description) {
  const text = `${title} ${description || ""}`.toLowerCase();
  const words = text.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);

  const stopwords = new Set([
    "this", "that", "with", "from", "have", "been", "were", "they",
    "them", "their", "about", "which", "would", "could", "should",
    "there", "also", "just", "only", "very", "when", "what", "your",
    "some", "more", "than", "into", "over", "such", "each", "will",
  ]);

  const freq = {};
  for (const w of words) {
    if (stopwords.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

/**
 * Suggest category based on title/description keywords.
 */
function suggestCategory(title, description) {
  const text = `${title} ${description || ""}`.toLowerCase();
  const rules = [
    { cat: "Facilities", keywords: ["room", "building", "hvac", "ac", "heating", "water", "electric", "plumbing", "repair"] },
    { cat: "Academics", keywords: ["exam", "grade", "teacher", "class", "homework", "assignment", "course", "study", "lecture"] },
    { cat: "Food", keywords: ["cafeteria", "lunch", "food", "meal", "menu", "canteen", "dining", "nutrition"] },
    { cat: "Bullying", keywords: ["bully", "harass", "tease", "threat", "intimidate", "abuse"] },
    { cat: "Security", keywords: ["security", "safety", "theft", "stolen", "break-in", "camera", "guard"] },
    { cat: "Technology", keywords: ["computer", "wifi", "internet", "software", "hardware", "device", "laptop"] },
    { cat: "Library", keywords: ["library", "book", "borrow", "return", "catalog", "study space"] },
    { cat: "Transport", keywords: ["bus", "transport", "commute", "parking", "carpool", "route"] },
    { cat: "Cleanliness", keywords: ["clean", "dirty", "trash", "restroom", "bathroom", "hygiene"] },
    { cat: "Sports", keywords: ["sports", "gym", "team", "coach", "tournament", "field", "court"] },
    { cat: "Medical", keywords: ["nurse", "health", "medical", "medicine", "allergy", "first aid"] },
  ];

  for (const rule of rules) {
    if (rule.keywords.some((kw) => text.includes(kw))) return rule.cat;
  }
  return null;
}

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();
  // Throttle: 20 summaries/min per IP. Uses the shared (table, author,
  // seconds, limit) helper with the client IP as the author key.
  if (await rateLimited("ai-summary", clientIp(req), 60, 20))
    return rateLimitResponse(res, 60, "Too many summary requests. Please slow down.");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const { post_id, title, description, category } = req.body || {};
    const cleanTitle = clean(title || "");
    const cleanDesc = clean(description || "");

    if (!cleanTitle && !cleanDesc) {
      return res.status(400).json({ error: "title or description required" });
    }

    // Baseline summary + keywords
    let summary = deterministicSummary(cleanTitle, cleanDesc);
    let keywords = extractKeywords(cleanTitle, cleanDesc);
    let categorySuggestion = suggestCategory(cleanTitle, cleanDesc);
    let method = "deterministic";
    let model = null;

    // Real LLM call (Groq openai/gpt-oss-120b or NVIDIA NIM) for genuine AI summarization
    try {
      const systemPrompt = `You are an expert school complaint analyst. Generate a concise, objective 1-2 sentence executive summary of the issue, extract 3-5 key topical tags (keywords array), and suggest the best category among: Academics, Facilities, Canteen, Transport, Bullying, Security, Technology, Library, Cleanliness, Sports, Medical, Other. Return ONLY valid JSON in format: {"summary": "...", "keywords": ["..."], "category": "..."}`;
      const userPrompt = `Title: ${cleanTitle}\nDescription: ${cleanDesc || "None"}`;
      const aiRes = await callNvidiaFast(systemPrompt, userPrompt, 6000);
      if (aiRes?.text) {
        const jsonMatch = aiRes.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.summary && typeof parsed.summary === "string") {
            summary = parsed.summary.trim();
            method = "real_llm";
            model = `${aiRes.provider}:${aiRes.model}`;
          }
          if (Array.isArray(parsed.keywords) && parsed.keywords.length > 0) {
            keywords = parsed.keywords.map(String).slice(0, 5);
          }
          if (parsed.category && typeof parsed.category === "string") {
            categorySuggestion = parsed.category.trim();
          }
        }
      }
    } catch {
      /* fall back to deterministic if LLM times out */
    }

    // Store the summary if post_id is provided
    if (post_id) {
      try {
        await supabase
          .from("posts")
          .update({ ai_summary: summary })
          .eq("id", post_id);
      } catch {
        // Best effort — don't fail the request if DB update fails
      }
    }

    return res.status(200).json({
      summary,
      keywords,
      category_suggestion: categorySuggestion || category || "Other",
      method,
      model,
    });
  } catch (err) {
    console.error("[ai-summary] error:", err?.message);
    return res.status(500).json({ error: "Internal error" });
  }
}
