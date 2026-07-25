// Persona System — AI personality and system prompt management.
// Ported from Ada-SI's scout_persona.py pattern. Stores persona in Supabase settings.
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog } from './_auth.js';
import { sanitizeError } from './_error.js';
import { ENTERPRISE_ADMIN_SYSTEM_PROMPT } from './_enterprise-admin-prompt.js';

const PERSONA_KEY = 'admin_persona';

// ─── Default Persona ──────────────────────────────────────────────
// Uses the enterprise admin system prompt as the default persona.
const DEFAULT_PERSONA = {
  name: 'Voice Box Admin Agent',
  personality: 'Expert, decisive, and helpful. Speaks with authority and precision.',
  expertise: [
    'Platform moderation and content management',
    'User management and community safety',
    'Analytics and trend analysis',
    'Poll creation and engagement',
    'SQL queries and data analysis',
  ],
  communication_style: 'Direct, specific, and action-oriented. No hedging. Uses markdown for clarity.',
  system_prompt: ENTERPRISE_ADMIN_SYSTEM_PROMPT,
  constraints: [
    'Always verify before destructive actions',
    'Never expose raw SQL errors to users',
    'Log all administrative actions',
    'Respect rate limits and timeouts',
  ],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// ─── Persona CRUD ─────────────────────────────────────────────────
export async function loadPersona() {
  try {
    const { data, error } = await supabase.from('settings').select('value').eq('key', PERSONA_KEY).single();
    if (error || !data) return DEFAULT_PERSONA;
    const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    return { ...DEFAULT_PERSONA, ...parsed };
  } catch {
    return DEFAULT_PERSONA;
  }
}

export async function savePersona(persona) {
  const current = await loadPersona();
  const updated = {
    ...current,
    ...persona,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('settings').upsert(
    { key: PERSONA_KEY, value: JSON.stringify(updated) },
    { onConflict: 'key' }
  );
  if (error) throw error;
  return updated;
}

export async function resetPersona() {
  const { error } = await supabase.from('settings').upsert(
    { key: PERSONA_KEY, value: JSON.stringify(DEFAULT_PERSONA) },
    { onConflict: 'key' }
  );
  if (error) throw error;
  return DEFAULT_PERSONA;
}

// ─── System Prompt Builder ────────────────────────────────────────
export function buildPersonaSystemPrompt(persona) {
  const p = persona || DEFAULT_PERSONA;
  const expertise = Array.isArray(p.expertise) ? p.expertise.join('\n- ') : (p.expertise || '');
  const constraints = Array.isArray(p.constraints) ? p.constraints.join('\n- ') : (p.constraints || '');

  return `${p.system_prompt || DEFAULT_PERSONA.system_prompt}

## YOUR IDENTITY
Name: ${p.name}
Personality: ${p.personality}
Communication Style: ${p.communication_style}

## YOUR EXPERTISE
- ${expertise}

## YOUR CONSTRAINTS
- ${constraints}`;
}

// ─── HTTP Handler ────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // GET — read persona
    if (req.method === 'GET') {
      const persona = await loadPersona();
      return res.status(200).json({ persona });
    }

    // POST requires admin
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

    const action = req.body?.action || 'save';

    // Save persona
    if (action === 'save') {
      const { persona } = req.body || {};
      if (!persona) return res.status(400).json({ error: 'Missing persona data' });
      const updated = await savePersona(persona);
      await auditLog('persona', 'save', 'Persona updated');
      return res.status(200).json({ ok: true, persona: updated });
    }

    // Reset persona
    if (action === 'reset') {
      const reset = await resetPersona();
      await auditLog('persona', 'reset', 'Persona reset to defaults');
      return res.status(200).json({ ok: true, persona: reset });
    }

    // Get system prompt preview
    if (action === 'preview') {
      const persona = await loadPersona();
      const prompt = buildPersonaSystemPrompt(persona);
      return res.status(200).json({ prompt });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return sanitizeError(res, err, 'persona');
  }
}
