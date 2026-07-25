// Evidence Management — upload and manage evidence files for complaints.
// POST /api/evidence/upload   →  upload evidence (multipart form data with base64)
// GET  /api/evidence?post_id=X →  get evidence for a post
// DELETE /api/evidence { evidence_id }  →  delete evidence
// POST /api/evidence/scan { evidence_id, text }  →  AI scan evidence content
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog, clean } from './_auth.js';

function evidenceKey(postId) { return `evidence:${postId}`; }

function detectContentFlags(text) {
  if (!text) return [];
  const flags = [];
  const lower = text.toLowerCase();
  if (/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/.test(text)) flags.push({ type: 'pii', detail: 'Phone number detected' });
  if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/.test(text)) flags.push({ type: 'pii', detail: 'Email address detected' });
  const bullyingWords = ['stupid', 'idiot', 'loser', 'ugly', 'fat', 'dumb', 'pathetic'];
  if (bullyingWords.some((w) => lower.includes(w))) flags.push({ type: 'bullying', detail: 'Potential bullying language' });
  if (['i will kill', 'gonna hurt', 'death threat', 'bomb', 'shoot'].some((w) => lower.includes(w))) {
    flags.push({ type: 'threat', detail: 'Potential threat detected' });
  }
  if (['nude', 'naked', 'porn', 'xxx', 'send nudes'].some((w) => lower.includes(w))) {
    flags.push({ type: 'explicit', detail: 'Explicit content detected' });
  }
  return flags;
}

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // GET: fetch evidence for a post (requires auth)
    if (req.method === 'GET') {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData?.user) return res.status(401).json({ error: 'Unauthorized' });

      const postId = req.query.post_id;
      if (!postId) return res.status(400).json({ error: 'post_id required' });
      const { data } = await supabase.from('settings').select('value').eq('key', evidenceKey(postId)).maybeSingle();
      return res.status(200).json({ evidence: data?.value?.evidence || [], post_id: postId });
    }

    // POST: upload evidence or scan (requires auth)
    if (req.method === 'POST') {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData?.user) return res.status(401).json({ error: 'Unauthorized' });

      const b = req.body || {};

      // AI scan evidence content
      if (b.action === 'scan') {
        const flags = detectContentFlags(b.text || '');
        return res.status(200).json({ flags, risk: flags.some((f) => f.type === 'threat') ? 'critical' : flags.some((f) => f.type === 'bullying') ? 'high' : flags.length > 0 ? 'medium' : 'safe' });
      }

      // Upload evidence
      if (!b.post_id) return res.status(400).json({ error: 'post_id required' });

      const evidence = {
        id: `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        post_id: b.post_id,
        type: b.type || 'text',  // text, image, file
        content: b.content || b.text || '',
        filename: b.filename || null,
        description: clean(b.description || '', 500),
        uploaded_by: b.author_id || 'anonymous',
        created_at: new Date().toISOString(),
      };

      // Scan content for flags
      evidence.content_flags = detectContentFlags(evidence.content);
      evidence.flagged = evidence.content_flags.length > 0;

      // Store in settings
      const { data: existing } = await supabase.from('settings').select('value').eq('key', evidenceKey(b.post_id)).maybeSingle();
      const existingEvidence = existing?.value?.evidence || [];
      existingEvidence.push(evidence);
      await supabase.from('settings').upsert(
        { key: evidenceKey(b.post_id), value: { evidence: existingEvidence, updated_at: new Date().toISOString() } },
        { onConflict: 'key' },
      );

      if (evidence.flagged) {
        await auditLog('admin', 'evidence_flagged', `Evidence ${evidence.id} on post ${b.post_id} flagged: ${evidence.content_flags.map((f) => f.type).join(', ')}`);
      }

      return res.status(201).json(evidence);
    }

    // DELETE: remove evidence
    if (req.method === 'DELETE') {
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
      const b = req.body || {};
      if (!b.evidence_id || !b.post_id) return res.status(400).json({ error: 'evidence_id and post_id required' });

      const { data: existing } = await supabase.from('settings').select('value').eq('key', evidenceKey(b.post_id)).maybeSingle();
      const evidenceList = (existing?.value?.evidence || []).filter((e) => e.id !== b.evidence_id);
      await supabase.from('settings').upsert(
        { key: evidenceKey(b.post_id), value: { evidence: evidenceList, updated_at: new Date().toISOString() } },
        { onConflict: 'key' },
      );

      await auditLog('admin', 'evidence_delete', `Deleted evidence ${b.evidence_id} from post ${b.post_id}`);
      return res.status(200).json({ success: true, deleted: b.evidence_id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('evidence error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
