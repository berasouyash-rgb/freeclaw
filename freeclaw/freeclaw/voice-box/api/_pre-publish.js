// AI Pre-Publish Agent — Mandatory content gate for ALL user submissions.
// Every complaint, suggestion, poll, comment, and reply goes through this BEFORE publishing.
// Uses NVIDIA Nemotron 3 Ultra 550B for real AI content moderation.
//
// POST /api/pre-publish
//   { content_type: 'post'|'comment'|'poll', title?, description?, body?, category?, options?, author_id }
//
// Returns:
//   { decision: 'safe'|'revision'|'high_risk', risk_score, checks, analysis, ... }

import supabase from './_db-client.js';
import { cors, auditLog, clean, rateLimited, rateLimitResponse } from './_auth.js';

// ─── NVIDIA NIM API ──────────────────────────────────────────────
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '';
const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_MODEL = 'meta/llama-3.1-8b-instruct';

async function callNvidiaLLM(systemPrompt, userPrompt, maxTokens = 2000) {
  // Try direct NVIDIA call first — 6s timeout for fast response
  if (NVIDIA_API_KEY) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch(NVIDIA_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${NVIDIA_API_KEY}`,
        },
        body: JSON.stringify({
          model: NVIDIA_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.15,
          max_tokens: maxTokens,
          top_p: 0.7,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error('NVIDIA API error:', response.status, errText.slice(0, 300));
      } else {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try { return JSON.parse(jsonMatch[0]); } catch (e) {
              console.error('Failed to parse NVIDIA JSON:', e.message);
            }
          }
          console.error('No JSON found in NVIDIA response:', text.slice(0, 300));
        } else {
          console.error('NVIDIA API empty response:', JSON.stringify(data).slice(0, 300));
        }
      }
    } catch (err) {
      clearTimeout(timeout);
      console.error('NVIDIA direct call failed:', err.message);
    }
  }

  // NO provider chain fallback — it has no timeout and can hang the whole function.
  // If NVIDIA fails, the caller falls back to emergencyRegex() which is instant.
  return null;
}

// ─── AI Content Moderation Prompt ────────────────────────────────
const MODERATION_SYSTEM_PROMPT = `You are a school content moderation AI. Analyze user-submitted content for a school complaint platform.

CRITICAL RULE — DISTINGUISH REPORTING FROM DOING:
The user is SUBMITTING A COMPLAINT or REPORT about something that happened. They are DESCRIBING a problem, not COMMITTING it.

REPORTS ARE SAFE (the user is describing what someone else did):
- "Student uses profanity and abusive language toward staff" → REPORT. SAFE.
- "Teacher calls students names like idiot and loser" → REPORT. SAFE.
- "Someone said the n-word in class" → REPORT. SAFE.
- "A kid told me to kill myself" → REPORT (user is victim). SAFE.
- "Students are using homophobic slurs" → REPORT. SAFE.
- "There is bullying and name-calling in the hallway" → REPORT. SAFE.
- "A student made racist comments" → REPORT. SAFE.
- "Someone threatened me with a knife" → REPORT (user is victim). SAFE.
- "Teacher shouts and screams at students" → REPORT. SAFE.
- "The canteen food is terrible and disgusting" → OPINION about food. SAFE.
- "This school is garbage" → OPINION. SAFE.
- "No cap, the bus is always late" → CASUAL SPEECH. SAFE.
- "Bruh, the wifi sucks" → CASUAL SPEECH. SAFE.
- "The test was mid" → SLANG/OPINION. SAFE.
- "That teacher is lowkey scary" → SLANG/OPINION. SAFE.
- "The principal is sus" → SLANG/OPINION. SAFE.

ACTUAL VIOLATIONS (the POST AUTHOR is doing it):
- "You are an idiot and everyone hates you" → DIRECT ABUSE. UNSAFE.
- "I will kill you" → DIRECT THREAT. UNSAFE.
- "Shut up you loser" → DIRECT ABUSE. UNSAFE.
- "You're so stupid, nobody likes you" → DIRECT ABUSE. UNSAFE.
- "Kill yourself kys" → DIRECT THREAT. UNSAFE.
- "My phone number is 555-1234567" → PII. UNSAFE.
- "Buy my merch at coolstuff.com" → SPAM. UNSAFE.
- "I'll post your nudes" → BLACKMAIL/EXPLICIT. UNSAFE.
- "All [racial group] are terrible" → HATE SPEECH. UNSAFE.

SLANG THAT IS NOT ABUSE (when used as opinions or casual speech):
- "no cap" = no lie/truth → SAFE
- "bruh" = informal exclamation → SAFE
- "sus" = suspicious → SAFE
- "mid" = mediocre/average → SAFE
- "slay" = do well/amazing → SAFE
- "bet" = okay/agreed → SAFE
- "lowkey/highkey" = somewhat/very → SAFE
- "vibe" = feeling/atmosphere → SAFE
- "ghosting" = ignoring someone → SAFE (when describing behavior)
- "simp" = someone who tries too hard → SAFE (when describing)
- "Karen" = entitled person → SAFE (when describing)
- "NPC" = basic/unoriginal person → SAFE (when describing)
- "touch grass" = go outside → SAFE
- "rent free" = can't stop thinking → SAFE
- "main character" = self-centered → SAFE (when describing)
- "ick" = turn off → SAFE
- "delulu" = delusional → SAFE (when describing)
- "cringe" = embarrassing → SAFE
- "based" = good/authentic → SAFE
- "W/L" = win/loss → SAFE
- "ratio" = more likes on reply → SAFE
- "cope" = dealing with something → SAFE
- "seethe" = be angry → SAFE
- "mald" = very angry → SAFE
- "rekt" = destroyed → SAFE
- "big yikes" = very embarrassing → SAFE
- "oof" = expression of discomfort → SAFE
- "fam" = friends → SAFE
- "yeet" = throw → SAFE
- "tea" = gossip → SAFE
- "shade" = disrespect → SAFE (when describing)
- "read" = criticize → SAFE (when describing)
- "yas queen" = enthusiastic support → SAFE
- "green flag/red flag" = good/bad signs → SAFE
- "ick" = turn off → SAFE
- "breadcrumbing" = leading someone on → SAFE (when describing)
- "gaslighting" = manipulating reality → SAFE (when describing)
- "love bombing" = overwhelming affection → SAFE (when describing)
- "situationship" = undefined relationship → SAFE
- "rizz" = charisma → SAFE
- "sigma" = lone wolf → SAFE
- "alpha" = dominant → SAFE
- "normie" = normal person → SAFE
- "chad" = successful person → SAFE
- "clout" = influence → SAFE
- "stan" = obsessive fan → SAFE
- "salty" = upset → SAFE
- "thot" = promiscuous person → SAFE (when describing)
- "slut" = promiscuous person → SAFE (when describing)
- "whore" = promiscuous person → SAFE (when describing)

RULE: Only flag content that ACTUALLY CONTAINS threats, abuse, hate speech, PII, or spam IN THE POST ITSELF. Do NOT flag posts that are REPORTING or DESCRIBING such behavior by others. Do NOT flag casual slang, opinions, or informal speech.

Return ONLY this JSON (no other text, no markdown fences):
{
  "risk_score": 0-100,
  "personal_info_detected": true/false,
  "threats_detected": true/false,
  "bullying_detected": true/false,
  "hate_speech_detected": true/false,
  "doxxing_detected": true/false,
  "blackmail_detected": true/false,
  "explicit_detected": true/false,
  "spam_detected": true/false,
  "privacy_issues": ["specific issues found"],
  "safety_issues": ["specific issues found"],
  "spam_issues": ["specific issues found"],
  "quality_issues": ["specific issues found"],
  "summary": "one sentence summary",
  "suggested_category": "Academics|Facilities|Canteen|Transport|Discipline|Sports|IT|Administration|Events",
  "suggested_priority": "low|medium|high|critical",
  "decision": "safe|revision|high_risk",
  "reason": "brief explanation"
}

SCORING RULES:
- Clean legitimate complaint/report → risk = 0, decision = "safe"
- Phone/email/address/name/student ID found in POST → risk >= 50, personal_info_detected = true
- POST AUTHOR makes threats/violence → risk >= 80, threats_detected = true, decision = "high_risk"
- POST AUTHOR bullies/harasses → risk >= 65, bullying_detected = true, decision = "high_risk"
- POST AUTHOR uses hate speech/slurs → risk >= 80, hate_speech_detected = true, decision = "high_risk"
- Doxxing someone's personal info → risk >= 80, doxxing_detected = true, decision = "high_risk"
- POST AUTHOR blackmails → risk >= 75, blackmail_detected = true, decision = "high_risk"
- Explicit/sexual content in POST → risk >= 70, explicit_detected = true, decision = "high_risk"
- Spam in POST → risk >= 45, spam_detected = true, decision = "revision"
- Gibberish/too short → risk >= 25, decision = "revision"

REPORTING is not a violation. A post saying "someone bullied me" or "a student uses profanity" is a REPORT and should be marked SAFE. Slang like "no cap", "bruh", "sus", "mid", "slay" is NOT abuse.`;

// ─── DB Spam Check (5s timeout) ─────────────────────────────────
async function checkSpamDB(text, authorId) {
  return Promise.race([
    (async () => {
      const issues = [];
      const tenMinAgo = new Date(Date.now() - 600000).toISOString();
      const { count } = await supabase.from('posts').select('id', { count: 'exact', head: true })
        .eq('author_id', authorId).gte('created_at', tenMinAgo);
      if (count && count > 5) issues.push(`Flooding: ${count} posts in last 10 minutes`);

      const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
      const { data: recentPosts } = await supabase.from('posts').select('title,description')
        .eq('author_id', authorId).gte('created_at', oneHourAgo).limit(10);
      if (recentPosts?.length) {
        const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        for (const rp of recentPosts) {
          const existing = `${rp.title || ''} ${rp.description || ''}`.toLowerCase();
          const overlap = words.filter(w => existing.includes(w)).length;
          const similarity = words.length > 0 ? overlap / words.length : 0;
          if (similarity > 0.7) {
            issues.push('Duplicate: very similar post from you in the last hour');
            break;
          }
        }
      }
      return { pass: issues.length === 0, issues };
    })(),
    new Promise(resolve => setTimeout(() => resolve({ pass: true, issues: [] }), 5000)),
  ]);
}

// ─── Duplicate Detection (5s timeout) ─────────────────────────────
async function detectDuplicates(title, description) {
  return Promise.race([
    (async () => {
      const combined = `${title} ${description || ''}`.toLowerCase();
      const words = combined.split(/\s+/).filter(w => w.length > 3);
      if (words.length < 2) return [];

      const { data: existing } = await supabase.from('posts')
        .select('id,title,description,category,status').eq('deleted', false).limit(200);

      const similar = [];
      if (existing?.length) {
        for (const post of existing) {
          const otherWords = `${post.title || ''} ${post.description || ''}`.toLowerCase().split(/\s+/).filter(w => w.length > 3);
          const overlap = words.filter(w => otherWords.includes(w)).length;
          const similarity = words.length > 0 ? Math.round((overlap / words.length) * 100) : 0;
          if (similarity > 50) similar.push({ id: post.id, title: post.title, category: post.category, status: post.status, similarity });
        }
      }
      return similar.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
    })(),
    new Promise(resolve => setTimeout(() => resolve([]), 5000)),
  ]);
}

// ─── Emergency Regex Fallback (when NVIDIA API is down) ───────────
function emergencyRegex(text) {
  const lower = String(text || '').slice(0, 10000).toLowerCase(); // FIX-M4: cap input length to prevent ReDoS
  const safetyIssues = [];
  const privacyIssues = [];
  const qualityIssues = [];
  let riskScore = 0;

  // CRITICAL: Check if this is a REPORT/COMPLAINT about abuse (not actual abuse)
  // If the post is describing someone else's behavior, it's likely a report
  const isReporting = /\b(reports?|reported|complains?|complained|describes?|described|mentions?|mentioned|tells?|told|says?|said|claims?|claimed| witnessed?|saw| noticed?|observed?|experienced?|dealing with|facing|problem with|issue with|incident|occurred|happened|keeps?|always|every day|every time|daily|regularly|habitually|pattern of)\b/i.test(text)
    || /\b(student|teacher|staff|person|someone|they|he|she|bully|bullying|abusive|abuse|profanity|swearing|threats?|threatening|harassment|harassing)\b/i.test(text);
  
  // If it's a report about abuse BY someone else, reduce risk significantly
  // Reports use phrases like "uses profanity", "is abusive", "threatens students"
  const isDescribingOthers = /\b(uses?\s+(profanity|abusive|vulgar|offensive|inappropriate|threatening)|is\s+(abusive|bullying|aggressive|hostile|threatening|disruptive)|engages?\s+in|participates?\s+in|directed\s+at\s+(staff|students|teachers|others))\b/i.test(text);
  
  // Only flag if the post ITSELF contains actual abuse directed at someone
  // "you are X" = actual abuse; "student is X" = report about someone else
  const isDirectAbuse = /\b(you\s+are|you're|you\s+will|you\s+should|you\s+ deserve)\s+(a\s+)?(idiot|stupid|loser|ugly|fat|disgusting|pathetic|worthless|trash|moron|dumb|terrible|horrible|worst)/i.test(text);

  // Casual slang that is NOT abuse (when used as opinions)
  const isCasualSlang = /\b(no\s*cap|bruh|sus|mid|slay|bet|lowkey|highkey|vibe|ghosting|simp|karen|npc|touch\s*grass|rent\s*free|main\s*character|ick|delulu|cringe|based|w\s*rizz|l\s*rizz|sigma|alpha|beta|normie|chad|clout|stan|salty|tea|shade|yas\s*queen|green\s*flag|red\s*flag|breadcrumbing|gaslighting|love\s*bombing|situationship|rizz|thot|yeet|oof|fam|big\s*yikes|cope|seethe|mald|rekt|kekw|poggers|copium|hopium|doomer)\b/i.test(text);

  // PII — always flag regardless of context
  if (/\+?\d[\d\s\-()]{7,}/.test(text)) { privacyIssues.push('Phone number detected'); riskScore += 25; }
  if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text)) { privacyIssues.push('Email detected'); riskScore += 25; }
  if (/\b\d{1,5}\s+[a-zA-Z\s]+(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|place|pl)\b/i.test(text)) { privacyIssues.push('Address detected'); riskScore += 30; }

  // Direct threats — only if POST AUTHOR is making threats (not reporting them)
  if (/\b(kill yourself|kys|i will find you|i will hurt you|watch your back|shoot|stab|bomb|burn down)\b/i.test(text)) {
    // Check if this is a report about threats vs actual threats
    const reportingThreats = /\b(reported?|says?|said|claims?|claimed|told|describes?|mentioned|witnessed?|saw|heard|threatening|threatens?|used?\s+threats?)\b/i.test(text);
    if (!reportingThreats && !isDescribingOthers) {
      safetyIssues.push('DIRECT THREATS'); riskScore += 60;
    }
  }

  // Direct abuse — only if POST AUTHOR is being abusive (not reporting)
  if (/\b(idiot|loser|ugly|fat|disgusting|pathetic|worthless|trash|moron|dumb|no one likes you|everyone hates you|you suck|shut up)\b/i.test(text)) {
    if (isDirectAbuse || (/\byou\b/i.test(text) && !isReporting && !isCasualSlang)) {
      safetyIssues.push('BULLYING LANGUAGE'); riskScore += 40;
    }
  }

  // Name-based bullying — only if targeting someone directly
  if (/\b(is|was)\s+(a\s+)?(bad|ugly|stupid|dumb|annoying|terrible|horrible|disgusting)\s+(girl|boy|student|teacher|person|kid|child)\b/i.test(text)) {
    // If it's a report ("student is disruptive"), it's likely describing someone else's behavior
    const isReportAboutOthers = /\b(student|teacher|staff|someone|they|he|she|person)\s+(is|was)\s+(a\s+)?(bad|ugly|stupid|dumb|annoying|terrible|horrible|disgusting)\b/i.test(text);
    if (!isReportAboutOthers && !isReporting) {
      safetyIssues.push('BULLYING: targeting a specific person'); riskScore += 45;
    }
  }

  // Hate speech — always flag (slurs are never acceptable in a report)
  if (/\b(nigger|faggot|kike|spic|chink|retard|slur)\b/i.test(text)) {
    safetyIssues.push('HATE SPEECH'); riskScore += 60;
  }

  // Harassment/blackmail — only if POST AUTHOR is doing it
  if (/\b(i know where you live|i will get you|meet me after school|send me money|i'll tell everyone|i'll post your|or else|if you don't)\b/i.test(text)) {
    safetyIssues.push('HARASSMENT/BLACKMAIL'); riskScore += 55;
  }

  // Explicit content — only if POST AUTHOR is sharing it
  if (/\b(nude|naked|sex tape|porn|xxx|onlyfans|explicit)\b/i.test(text)) {
    safetyIssues.push('EXPLICIT CONTENT'); riskScore += 50;
  }

  // Quality
  if (text.trim().length < 5) { qualityIssues.push('Too short'); riskScore += 10; }

  riskScore = Math.min(100, riskScore);
  let decision = 'safe';
  if (riskScore >= 70) decision = 'high_risk';
  else if (riskScore >= 30) decision = 'revision';

  return {
    riskScore, decision,
    reason: safetyIssues.length ? safetyIssues.join('; ') : privacyIssues.length ? privacyIssues.join('; ') : 'Regex fallback analysis',
    checks: {
      privacy: { pass: privacyIssues.length === 0, issues: privacyIssues },
      safety: { pass: safetyIssues.length === 0, issues: safetyIssues },
      spam: { pass: true, issues: [] },
      quality: { pass: qualityIssues.length === 0, issues: qualityIssues },
      duplicates: { count: 0, items: [] },
    },
    personal_info_detected: privacyIssues.length > 0,
    threats_detected: safetyIssues.some(i => i.includes('THREAT')),
    bullying_detected: safetyIssues.some(i => i.includes('BULLY')),
    hate_speech_detected: safetyIssues.some(i => i.includes('HATE')),
    doxxing_detected: false,
    blackmail_detected: safetyIssues.some(i => i.includes('BLACKMAIL')),
    explicit_detected: safetyIssues.some(i => i.includes('EXPLICIT')),
    spam_detected: false,
    suggested_priority: riskScore >= 70 ? 'critical' : riskScore >= 40 ? 'high' : 'medium',
    suggested_category: 'Other',
    summary: `Regex fallback: risk ${riskScore}`,
  };
}

// ─── Run Checks (called by handler, must complete within budget) ─
async function runChecks(combinedText, contentType, title, description, category, authorId, startTime) {
  // ── Call NVIDIA Nemotron + DB checks in parallel ─────────────
  const [aiResult, spamDB, duplicates] = await Promise.all([
    callNvidiaLLM(MODERATION_SYSTEM_PROMPT, `Analyze this ${contentType}:\n\n"${combinedText}"`),
    checkSpamDB(combinedText, authorId),
    contentType === 'post' ? detectDuplicates(title, description) : Promise.resolve([]),
  ]);

  // ── If NVIDIA API failed, use emergency regex ────────────────
  if (!aiResult) {
    console.error('NVIDIA LLM unavailable — using emergency regex fallback');
    const fallback = emergencyRegex(combinedText);
    const checks = {
      ...fallback.checks,
      spam: { pass: spamDB.pass, issues: spamDB.issues },
      duplicates: { count: duplicates.length, items: duplicates },
    };
    return { ...fallback, checks, spamDB, duplicates, contentType, authorId, startTime, llmAnalyzed: false };
  }

  // ── NVIDIA succeeded — use its analysis ─────────────────────
  const allPrivacy = [...(aiResult.privacy_issues || [])];
  if (aiResult.personal_info_detected && !allPrivacy.some(i => /personal|pii|info/i.test(i))) allPrivacy.push('Personal information detected by AI');

  const allSafety = [...(aiResult.safety_issues || [])];
  if (aiResult.threats_detected) allSafety.push('⚠️ THREATS DETECTED');
  if (aiResult.bullying_detected) allSafety.push('⚠️ BULLYING DETECTED');
  if (aiResult.hate_speech_detected) allSafety.push('⚠️ HATE SPEECH DETECTED');
  if (aiResult.doxxing_detected) allSafety.push('⚠️ DOXXING DETECTED');
  if (aiResult.blackmail_detected) allSafety.push('⚠️ BLACKMAIL DETECTED');
  if (aiResult.explicit_detected) allSafety.push('⚠️ EXPLICIT CONTENT DETECTED');

  const allSpam = [...(aiResult.spam_issues || [])];
  if (aiResult.spam_detected) allSpam.push('Spam detected by AI');
  if (!spamDB.pass) allSpam.push(...spamDB.issues);

  const allQuality = [...(aiResult.quality_issues || [])];

  let riskScore = aiResult.risk_score || 0;
  if (!spamDB.pass) riskScore = Math.max(riskScore, 45);
  riskScore = Math.min(100, riskScore);

  let decision = aiResult.decision || 'safe';
  if (riskScore >= 70 || aiResult.threats_detected || aiResult.hate_speech_detected || aiResult.doxxing_detected) {
    decision = 'high_risk';
  } else if (riskScore >= 30 || !spamDB.pass) {
    decision = 'revision';
  }

  const reason = aiResult.reason || (allSafety.length ? allSafety.join('; ') : allPrivacy.length ? allPrivacy.join('; ') : 'Content passed all checks');

  const checks = {
    privacy: { pass: allPrivacy.length === 0, issues: allPrivacy },
    safety: { pass: allSafety.length === 0, issues: allSafety },
    spam: { pass: allSpam.length === 0, issues: allSpam },
    quality: { pass: allQuality.length === 0, issues: allQuality },
    duplicates: { count: duplicates.length, items: duplicates },
  };

  return {
    riskScore, decision, reason, checks,
    priority: aiResult.suggested_priority || 'medium',
    department: aiResult.suggested_category || category || 'Other',
    category: aiResult.suggested_category || category || 'Other',
    summary: aiResult.summary || `${contentType} submitted`,
    resolutionTime: { critical: '1-2 hours', high: '4-8 hours', medium: '1-3 days', low: '3-7 days' }[aiResult.suggested_priority || 'medium'] || '1-3 days',
    duplicates, contentType, authorId, startTime, llmAnalyzed: true,
    title, description, body: combinedText, options: null, aiResult,
  };
}

// ─── Main Handler ───────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const startTime = Date.now();
  const b = req.body || {};

  // Rate limit: max 10 pre-publish checks per 5 minutes per author
  const authorId = b.author_id || 'anonymous';
  if (await rateLimited('pre_publish_log', authorId, 300, 10)) {
    return rateLimitResponse(res, 300, 'Too many submissions — please wait a few minutes.');
  }

  const title = clean(b.title || '', 140);
  const description = clean(b.description || '', 500);
  const body = clean(b.body || '', 500);
  const contentType = b.content_type || 'post';
  const category = b.category || '';
  const options = Array.isArray(b.options) ? b.options.join(', ') : '';

  const combinedText = [title, description, body, options].filter(Boolean).join(' ');
  if (!combinedText.trim()) {
    return res.status(400).json({ error: 'No content to analyze' });
  }

  try {
    // ── Overall 10s timeout — must return within budget ───────────
    const result = await Promise.race([
      runChecks(combinedText, contentType, title, description, category, authorId, startTime),
      new Promise(resolve => setTimeout(() => resolve({
        timedOut: true,
        fallback: emergencyRegex(combinedText),
      }), 10000)),
    ]);

    if (result.timedOut) {
      console.error('pre-publish timed out after 10s — using emergency regex');
      const fb = result.fallback;
      return finish(res, {
        ...fb,
        checks: { ...fb.checks, spam: { pass: true, issues: [] }, duplicates: { count: 0, items: [] } },
        contentType, authorId, startTime, llmAnalyzed: false,
      });
    }
    return finish(res, result);
  } catch (err) {
    console.error('pre-publish error:', err);
    // FAIL-CLOSED: content moderation failure = hold for review, never auto-approve.
    return finish(res, {
      riskScore: 75, decision: 'high_risk',
      reason: 'Content moderation system unavailable — held for admin review',
      checks: { privacy: { pass: false, issues: ['Moderation unavailable'] }, safety: { pass: false, issues: ['Moderation unavailable'] }, spam: { pass: false, issues: ['Moderation unavailable'] }, quality: { pass: false, issues: ['Moderation unavailable'] }, duplicates: { count: 0, items: [] } },
      priority: 'high', department: 'Other', category: 'Other', summary: 'Moderation system error — held for review', resolutionTime: '4-8 hours',
      duplicates: [], contentType, authorId, startTime, llmAnalyzed: false,
      title, description, body, options: b.options, aiResult: null,
    });
  }
}

// ─── Build Final Response + Audit ────────────────────────────────
async function finish(res, opts) {
  const { riskScore, decision, reason, checks, priority, department, category, summary, resolutionTime, duplicates, contentType, authorId, startTime, llmAnalyzed, title: t, description: d, body: b, options: o, aiResult } = opts;

  let reviewId = null;
  if (decision === 'high_risk') {
    // Store with 5s timeout — don't let DB hang the response
    try {
      const reviewItem = {
        content_type: contentType,
        title: t || '[No title]',
        description: d || null,
        body: b || null,
        category: category || 'Other',
        options: Array.isArray(o) ? o : null,
        author_id: authorId,
        checks,
        risk_score: riskScore,
        priority: aiResult?.suggested_priority || priority || 'medium',
        department: aiResult?.suggested_category || category || 'Other',
        summary: aiResult?.summary || summary || 'Content flagged by AI',
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      const { data: ins } = await Promise.race([
        supabase.from('settings').insert({
          key: `pre_publish_review:${Date.now().toString(36)}`,
          value: reviewItem,
        }).select('key').maybeSingle(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('DB timeout')), 5000)),
      ]);
      reviewId = ins?.key || null;
    } catch (err) {
      console.error('pre-publish review insert failed:', err.message);
    }
  }

  const elapsed = Date.now() - startTime;
  // Audit log with 3s timeout
  try {
    await Promise.race([
      auditLog(authorId, `pre_publish_${decision}`, `${contentType} risk=${riskScore} llm=${llmAnalyzed} ${elapsed}ms${reviewId ? ` review=${reviewId}` : ''}`),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Audit timeout')), 3000)),
    ]);
  } catch (err) {
    console.error('pre-publish audit log failed:', err.message);
  }

  return res.status(200).json({
    decision, risk_score: riskScore, reason, checks,
    analysis: { priority, department, category, summary, estimated_resolution_time: resolutionTime, llm_analyzed: llmAnalyzed },
    review_id: reviewId, elapsed_ms: elapsed,
  });
}
