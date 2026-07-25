/**
 * Client-side content moderation system
 * Detects profanity, slurs, dangerous content, blackmail, spam, and repeated words.
 * Returns structured results with severity levels for live UI feedback.
 */

export type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface ModerationFlag {
  category: string;
  severity: Severity;
  message: string;
  matched: string; // the word/phrase that triggered it
}

export interface ModerationResult {
  safe: boolean;
  overallSeverity: Severity;
  flags: ModerationFlag[];
  maskedText: string; // text with bad words masked
  score: number; // 0 = clean, 100 = worst
}

// ─── Word lists ───────────────────────────────────────────────────

// Profanity: common English slurs and vulgarities
const PROFANITY_WORDS = [
  'fuck', 'fucking', 'fucked', 'fucker', 'fucks', 'motherfucker', 'motherfucking',
  'shit', 'shitting', 'shitty', 'bullshit', 'horseshit', 'dipshit', 'douchebag',
  'bitch', 'bitches', 'bitchy', 'biting',
  'asshole', 'assholes', 'arsehole',
  'bastard', 'bastards',
  'cunt', 'cunts', 'twat',
  'dick', 'dicks', 'dickhead', 'dickheads',
  'slut', 'sluts', 'sluty',
  'whore', 'whores',
  'cock', 'cocks', 'prick',
  'pussy', 'pussies',
  'bollocks', 'bollock',
  'wanker', 'wankers',
  'tosser', 'tossers',
  'piss', 'pissed', 'pissing',
  'damn', 'dammit', 'goddamn',
  'crap', 'crappy',
  'retard', 'retarded', 'retards',
];

// Racial/ethnic slurs and hate speech
const SLUR_WORDS = [
  'nigger', 'nigga', 'niggas', 'niggers',
  'faggot', 'faggots', 'fag', 'fags', 'faggy',
  'kike', 'kikes',
  'spic', 'spics', 'spick',
  'chink', 'chinks',
  'wop', 'wops',
  'dago', 'dagos',
  'cracker', 'crackers',
  'honkey', 'honkies',
  'gook', 'gooks',
  'towelhead', 'towelheads',
  'raghead', 'ragheads',
  'darkie', 'darkies',
  'coon', 'coons',
  'jungle bunny',
  'wetback', 'wetbacks',
  'beaner', 'beaners',
  'gringo',
  'redskin', 'redskins',
  'injun',
  'hick', 'hicks',
  'tranny', 'trannies',
  'shemale',
  'dyke', 'dykes',
  'lesbo',
  'paki', 'pakis',
  'boche',
  'kraut', 'krauts',
  'nazi', 'nazis',
];

// Dangerous / threatening content patterns
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; message: string; severity: Severity }> = [
  // Self-harm
  { pattern: /\b(?:kill\s+(?:my\s+)?self|suicide|suicidal|end\s+(?:my\s+)?life|want\s+to\s+die|going\s+to\s+kill|overdose)\b/i, message: 'This content mentions self-harm. A counselor has been notified.', severity: 'critical' },
  // Violence threats — broad patterns
  { pattern: /\b(?:kill\s+(?:you|him|her|them|my|our|someone|anyone|everybody|nobody|people|person|friend|classmate|teacher|student|parent|family|brother|sister|nobody))\b/i, message: 'Threats of violence are taken seriously and will be reported.', severity: 'critical' },
  { pattern: /\b(?:gonna\s+kill|going\s+to\s+kill|will\s+kill|want\s+to\s+kill|wish\s+(?:you|he|she|they)\s+(?:were|was)\s+dead)\b/i, message: 'Threats of violence are taken seriously and will be reported.', severity: 'critical' },
  { pattern: /\b(?:murder\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend))\b/i, message: 'Threats of violence are taken seriously and will be reported.', severity: 'critical' },
  { pattern: /\b(?:shoot\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend))\b/i, message: 'Mentions of gun violence are flagged for immediate safety review.', severity: 'critical' },
  { pattern: /\b(?:stab\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend))\b/i, message: 'Threats of violence are taken seriously and will be reported.', severity: 'critical' },
  { pattern: /\b(?:beat\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend)\s+up)\b/i, message: 'Threats of violence are taken seriously and will be reported.', severity: 'critical' },
  { pattern: /\b(?:hurt\s+(?:you|him|her|them|my|our|someone|anyone|people|person|friend))\b/i, message: 'Threats of violence are taken seriously and will be reported.', severity: 'critical' },
  { pattern: /\b(?:burn\s+(?:you|him|her|them|my|our|the|this|a)\s*(?:school|building|house|home|classroom|bus|car)?)\b/i, message: 'Threats of arson are flagged for immediate safety review.', severity: 'critical' },
  { pattern: /\b(?:bomb\s+(?:you|him|her|them|my|our|the|this|a)\s*(?:school|building|house|home|classroom|bus|car)?)\b/i, message: 'Threats of bombing are flagged for immediate safety review.', severity: 'critical' },
  // Weapons
  { pattern: /\b(?:bring(?:ing)?\s+(?:a\s+)?(?:gun|knife|weapon|blade|bomb|explosive))\b/i, message: 'Mentions of weapons are flagged for safety review.', severity: 'high' },
  // Drugs
  { pattern: /\b(?:buying|selling|selling|trafficking|deal(?:ing)?\s+(?:in\s+)?)\s*(?:drugs|cocaine|heroin|meth|weed|marijuana|lsd|ecstasy|xanax|adderall|opioid|fentanyl)\b/i, message: 'Drug-related content is flagged for review.', severity: 'high' },
  // Blackmail / extortion
  { pattern: /\b(?:blackmail|extort|extortion|pay\s+(?:me|us)\s+or|i(?:'ll| will)\s+(?:post|share|send|upload|expose)\s+(?:your|the)\s+(?:photos?|pics?|pictures?|videos?|nudes?|secrets?))\b/i, message: 'Blackmail and extortion are serious offenses.', severity: 'critical' },
  { pattern: /\b(?:if\s+you\s+(?:don(?:'t|t)?|do\s+not)\s+(?:pay|give|send|do)\s+\w+.*?(?:i(?:'ll| will)|gonna|going\s+to)\s+(?:expose|share|post|leak|send))\b/i, message: 'Extortion attempts are automatically flagged.', severity: 'critical' },
  // Doxxing
  { pattern: /\b(?:dox(?:ing|ed)?|doxx(?:ing|ed)?|releasing?\s+(?:your|their|the)\s+(?:address|phone|real\s+name|info(?:rmation)?))\b/i, message: 'Sharing personal information without consent is forbidden.', severity: 'high' },
  // Generic threat patterns
  { pattern: /\b(?:i(?:'ll| will)\s+(?:get\s+you|destroy\s+you|end\s+you|ruin\s+your\s+life|make\s+your\s+life\s+(?:a\s+)?hell))\b/i, message: 'Threats and intimidation are taken seriously and will be reported.', severity: 'critical' },
  { pattern: /\b(?:you(?:'ll| will)\s+(?:regret\s+this|be\s+sorry|pay\s+for\s+this))\b/i, message: 'Intimidating language is flagged for review.', severity: 'high' },
];

// Spam patterns
const SPAM_PATTERNS: Array<{ pattern: RegExp; message: string; severity: Severity }> = [
  { pattern: /\b(?:buy\s+now|click\s+here|free\s+money|easy\s+cash|earn\s+\$|make\s+\$\d|work\s+from\s+home|limited\s+time\s+offer|act\s+now|congratulations\s+you(?:'ve| have)\s+won)\b/i, message: 'Looks like spam or advertising.', severity: 'medium' },
  { pattern: /https?:\/\/[^\s]+(?:bit\.ly|tinyurl|t\.co|shorturl|goo\.gl)/i, message: 'Shortened links are flagged for review.', severity: 'low' },
  { pattern: /(.)\1{5,}/, message: 'Excessive repeated characters detected.', severity: 'low' },
];

// ─── Helpers ──────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Check for repeated words (e.g., "bad bad bad bad bad") */
function detectRepeatedWords(text: string): ModerationFlag[] {
  const flags: ModerationFlag[] = [];
  const words = normalize(text).split(' ');
  let count = 1;
  for (let i = 1; i <= words.length; i++) {
    if (i < words.length && words[i] === words[i - 1] && words[i] && words[i]!.length > 2) {
      count++;
    } else {
      const prevWord = words[i - 1] ?? '';
      if (count >= 4) {
        flags.push({
          category: 'spam',
          severity: 'medium',
          message: `Word "${prevWord}" repeated ${count} times — this looks like spam.`,
          matched: prevWord,
        });
      }
      count = 1;
    }
  }
  return flags;
}

/** Check for ALL CAPS (shouting) */
function detectAllCaps(text: string): ModerationFlag[] {
  const flags: ModerationFlag[] = [];
  const stripped = text.replace(/[^a-zA-Z]/g, '');
  if (stripped.length < 10) return flags;
  const upperCount = (stripped.match(/[A-Z]/g) || []).length;
  if (upperCount / stripped.length > 0.85 && stripped.length > 15) {
    flags.push({
      category: 'quality',
      severity: 'low',
      message: 'Writing in ALL CAPS can feel like shouting. Consider using normal case.',
      matched: text.slice(0, 40),
    });
  }
  return flags;
}

/** Check for excessive exclamation marks */
function detectExcessivePunctuation(text: string): ModerationFlag[] {
  const flags: ModerationFlag[] = [];
  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations >= 5) {
    flags.push({
      category: 'quality',
      severity: 'low',
      message: `Excessive exclamation marks (${exclamations}) — try to keep punctuation minimal.`,
      matched: '!',
    });
  }
  return flags;
}

/** Check for email addresses or phone numbers (privacy leak) */
function detectPII(text: string): ModerationFlag[] {
  const flags: ModerationFlag[] = [];
  if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/.test(text)) {
    flags.push({
      category: 'privacy',
      severity: 'medium',
      message: 'Email addresses detected — this is an anonymous platform. Remove personal contact info.',
      matched: text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/)?.[0] || '',
    });
  }
  if (/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(text)) {
    flags.push({
      category: 'privacy',
      severity: 'medium',
      message: 'Phone number detected — this is an anonymous platform. Remove personal contact info.',
      matched: text.match(/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/)?.[0] || '',
    });
  }
  return flags;
}

/** Check for someone posting another person's name in a negative context (bullying) */
function detectBullyingPatterns(text: string): ModerationFlag[] {
  const flags: ModerationFlag[] = [];
  const _lower = normalize(text);
  // "Mr./Mrs./Ms./Teacher [Name] is" followed by insults
  if (/\b(?:mr|mrs|ms|miss|teacher|professor|coach|principal|sir|ma(?:'am|am))\s+\w+\s+(?:is|are|was)\s+(?:a\s+)?(?:bad|terrible|awful|horrible|worst|stupid|idiot|dumb|ugly|fat|disgusting|pathetic|useless)\b/i.test(text)) {
    flags.push({
      category: 'bullying',
      severity: 'high',
      message: 'Content appears to target a specific person with insults. Please keep feedback constructive.',
      matched: text.slice(0, 60),
    });
  }
  return flags;
}

// ─── Main moderation function ─────────────────────────────────────

const SEVERITY_ORDER: Record<Severity, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

function worstSeverity(flags: ModerationFlag[]): Severity {
  let worst: Severity = 'none';
  for (const f of flags) {
    if (SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[worst]) worst = f.severity;
  }
  return worst;
}

function severityScore(severity: Severity): number {
  switch (severity) {
    case 'none': return 0;
    case 'low': return 10;
    case 'medium': return 35;
    case 'high': return 70;
    case 'critical': return 100;
  }
}

/** Mask a word with asterisks, keeping first letter */
function maskWord(word: string): string {
  if (word.length <= 1) return '*';
  return word[0] + '*'.repeat(word.length - 1);
}

/** Replace profanity in text with masked version */
function maskText(text: string, words: string[]): string {
  let out = text;
  for (const w of words) {
    const regex = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    out = out.replace(regex, (m) => maskWord(m));
  }
  return out;
}

/**
 * Moderate content — returns flags, overall severity, and masked text.
 * Run this on the CLIENT for instant UI feedback before submission.
 */
export function moderateContent(text: string): ModerationResult {
  const flags: ModerationFlag[] = [];
  const _normalized = normalize(text);

  // 1. Profanity check
  for (const word of PROFANITY_WORDS) {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const match = text.match(regex);
    if (match) {
      flags.push({
        category: 'profanity',
        severity: 'high',
        message: `Profanity detected: "${match[0]}" — please remove or rephrase.`,
        matched: match[0],
      });
    }
  }

  // 2. Slur check
  for (const word of SLUR_WORDS) {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const match = text.match(regex);
    if (match) {
      flags.push({
        category: 'hate_speech',
        severity: 'critical',
        message: `Hate speech detected: "${match[0]}" — this is strictly prohibited.`,
        matched: match[0],
      });
    }
  }

  // 3. Dangerous content
  for (const { pattern, message, severity } of DANGEROUS_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      flags.push({ category: 'dangerous', severity, message, matched: match[0] });
    }
  }

  // 4. Spam patterns
  for (const { pattern, message, severity } of SPAM_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      flags.push({ category: 'spam', severity, message, matched: match[0] });
    }
  }

  // 5. Repeated words
  flags.push(...detectRepeatedWords(text));

  // 6. ALL CAPS
  flags.push(...detectAllCaps(text));

  // 7. Excessive punctuation
  flags.push(...detectExcessivePunctuation(text));

  // 8. PII (email/phone)
  flags.push(...detectPII(text));

  // 9. Bullying patterns
  flags.push(...detectBullyingPatterns(text));

  // Compute overall
  const overallSeverity = worstSeverity(flags);
  const score = flags.reduce((max, f) => Math.max(max, severityScore(f.severity)), 0);

  // Mask profanity in text
  let maskedText = text;
  maskedText = maskText(maskedText, PROFANITY_WORDS);
  maskedText = maskText(maskedText, SLUR_WORDS);

  return {
    safe: overallSeverity === 'none' || overallSeverity === 'low',
    overallSeverity,
    flags: [...new Map(flags.map(f => [f.message, f])).values()], // dedupe by message
    maskedText,
    score: Math.min(100, score),
  };
}

/**
 * Quick check: is this content blocked entirely? (critical severity = cannot submit)
 */
export function isBlocked(result: ModerationResult): boolean {
  return result.flags.some(f => f.severity === 'critical');
}

/**
 * Get human-readable summary of moderation issues
 */
export function getModerationSummary(result: ModerationResult): string {
  if (result.safe) return '';
  const critical = result.flags.filter(f => f.severity === 'critical');
  const high = result.flags.filter(f => f.severity === 'high');
  const medium = result.flags.filter(f => f.severity === 'medium');
  const parts: string[] = [];
  if (critical.length) parts.push(`${critical.length} critical issue(s)`);
  if (high.length) parts.push(`${high.length} serious issue(s)`);
  if (medium.length) parts.push(`${medium.length} warning(s)`);
  return parts.join(', ') || 'Content needs review';
}
