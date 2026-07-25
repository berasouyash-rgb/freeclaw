// Approval-only AI Agent.
// The agent can DRAFT suggestions (status changes, replies, escalations, merges)
// but can NEVER act on the database itself. Every suggestion requires explicit
// admin approval; approving applies the change and writes a permanent audit log.
// Suggestions expire after 48 hours automatically.
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog, clean } from './_auth.js';
import { sanitizeError } from './_error.js';

const EXPIRY_MS = 48 * 60 * 60 * 1000;

/** Heuristic suggestion generator (deterministic; AI text optional upstream) */
function generateSuggestions(posts) {
  const out = [];
  const now = Date.now();
  const urgentWords = /\b(urgent|danger|unsafe|injur|threat|bully|harass|emergency|fire|leak|assault)\b/i;

  for (const p of posts) {
    if (p.deleted || p.hidden || p.type !== 'problem') continue;
    const support = p.reactions?.support || 0;
    const comments = p.comment_count || 0;
    const ageDays = (now - +new Date(p.created_at)) / 86400000;

    // 1. Escalation: safety language or safety category still unverified
    if (p.status === 'reported' && (urgentWords.test(p.title + ' ' + p.description) || ['Bullying', 'Security', 'Medical'].includes(p.category)) && p.priority !== 'critical') {
      out.push({
        kind: 'escalation', target_id: p.id, critical: true,
        title: `Escalate “${p.title}” to critical priority`,
        content: { field: 'priority', from: p.priority, to: 'critical' },
        confidence: 0.8,
        reasoning: `“${p.title}” is in a safety-sensitive category (${p.category}) or contains urgency language, but is still priority “${p.priority}” and unverified after ${ageDays.toFixed(1)} day(s). Recommend escalating to critical.`,
      });
    }

    // 2. Status change: high engagement but still 'reported'
    if (p.status === 'reported' && (support >= 3 || comments >= 3) && ageDays > 0.5) {
      out.push({
        kind: 'status_change', target_id: p.id, critical: false,
        title: `Mark “${p.title}” as Verified`,
        content: { field: 'status', from: p.status, to: 'verified' },
        confidence: 0.72,
        reasoning: `“${p.title}” has ${support} supports and ${comments} comments but hasn't been triaged in ${ageDays.toFixed(1)} day(s). Recommend marking as Verified to show the community it was seen.`,
      });
    }

    // 3. Reply draft: solved without an official reply
    if (p.status === 'solved' && !p.admin_reply) {
      out.push({
        kind: 'reply', target_id: p.id, critical: false,
        title: `Post an official reply on “${p.title}”`,
        content: { field: 'admin_reply', from: '', to: `This issue has been resolved. Thank you for reporting “${p.title}” — please let us know if it happens again.` },
        confidence: 0.75,
        reasoning: `“${p.title}” was marked solved but has no official reply. A short public reply closes the loop and builds trust.`,
      });
    }
  }

  // 4. Merge suggestions: strong word overlap in same category
  const words = (t) => new Set(String(t).toLowerCase().split(/\W+/).filter((w) => w.length > 4));
  const open = posts.filter((p) => !p.deleted && !p.hidden && !p.merged_into && p.type === 'problem');
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      if (open[i].category !== open[j].category) continue;
      const wi = words(open[i].title + ' ' + open[i].description);
      const wj = words(open[j].title + ' ' + open[j].description);
      const overlap = [...wi].filter((w) => wj.has(w)).length;
      if (overlap >= 4) {
        const [keep, dup] = (open[i].reactions?.support || 0) >= (open[j].reactions?.support || 0) ? [open[i], open[j]] : [open[j], open[i]];
        out.push({
          kind: 'merge', target_id: dup.id, critical: false,
          title: `Merge “${dup.title}” into “${keep.title}”`,
          content: { field: 'merged_into', from: '', to: keep.id, keep_title: keep.title },
          confidence: 0.65,
          reasoning: `“${dup.title}” appears to duplicate “${keep.title}” (${overlap} shared key words, same category). Merging combines their support.`,
        });
        break;
      }
    }
  }
  return out.slice(0, 10);
}

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

    if (req.method === 'GET') {
      // auto-expire old suggestions (48h)
      const cutoff = new Date(Date.now() - EXPIRY_MS).toISOString();
      await supabase.from('agent_suggestions').update({ status: 'expired' }).eq('status', 'pending').lt('created_at', cutoff);
      const { data, error } = await supabase.from('agent_suggestions').select('*').order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return res.status(200).json(data);
    }

    const b = req.body || {};

    if (req.method === 'POST' && b.action === 'generate') {
      const { data: posts } = await supabase.from('posts').select('*').limit(1000);
      // enrich with counts
      const ids = (posts || []).map((p) => p.id);
      const [{ data: reactions }, { data: comments }] = await Promise.all([
        supabase.from('reactions').select('target_id,kind').in('target_id', ids.length ? ids : ['_']),
        supabase.from('comments').select('post_id').in('post_id', ids.length ? ids : ['_']).eq('deleted', false),
      ]);
      const rMap = {}; const cMap = {};
      (reactions || []).forEach((r) => { rMap[r.target_id] = rMap[r.target_id] || {}; rMap[r.target_id][r.kind] = (rMap[r.target_id][r.kind] || 0) + 1; });
      (comments || []).forEach((c) => { cMap[c.post_id] = (cMap[c.post_id] || 0) + 1; });
      const enriched = (posts || []).map((p) => ({ ...p, reactions: rMap[p.id] || {}, comment_count: cMap[p.id] || 0 }));

      const suggestions = generateSuggestions(enriched);
      // skip ones already pending for the same target+kind
      const { data: existing } = await supabase.from('agent_suggestions').select('target_id,kind').eq('status', 'pending');
      const dupe = new Set((existing || []).map((e) => `${e.kind}:${e.target_id}`));
      const fresh = suggestions.filter((s) => !dupe.has(`${s.kind}:${s.target_id}`));
      if (fresh.length) {
        const { error } = await supabase.from('agent_suggestions').insert(fresh.map((s) => ({
          kind: s.kind, target_id: s.target_id, target_type: 'post', title: s.title,
          content: s.content, confidence: s.confidence,
          reasoning: s.reasoning, critical: s.critical, status: 'pending',
        })));
        if (error) throw error;
      }
      await auditLog('ai-agent', 'generate_suggestions', `${fresh.length} new suggestion(s) drafted (read-only; awaiting admin approval)`);
      return res.status(200).json({ created: fresh.length });
    }

    if (req.method === 'PUT') {
      const { data: sug } = await supabase.from('agent_suggestions').select('*').eq('id', b.id).maybeSingle();
      if (!sug) return res.status(404).json({ error: 'Suggestion not found' });
      if (sug.status !== 'pending') return res.status(400).json({ error: 'Suggestion already resolved' });

      if (b.action === 'dismiss') {
        await supabase.from('agent_suggestions').update({ status: 'dismissed', resolved_at: new Date().toISOString(), outcome: 'Dismissed by admin — no action was taken.' }).eq('id', b.id);
        await auditLog('admin', 'agent_dismiss', `Dismissed AI suggestion #${b.id} (${sug.kind}): ${String(sug.title || sug.reasoning).slice(0, 120)}`);
        return res.status(200).json({ ok: true });
      }

      if (b.action === 'approve') {
        // Critical suggestions require the confirmed flag (second-step confirmation)
        if (sug.critical && b.confirmed !== true) {
          return res.status(400).json({ error: 'This is a critical/safety suggestion — second-step confirmation required.' });
        }
        const p = sug.content || {};
        const patch = {};
        // Support both my schema and legacy suggestion kinds
        const targetStatus = p.to || p.status;
        if (sug.kind === 'status_change' || sug.kind === 'solved_confirm') {
          patch.status = targetStatus;
          const map = { reported: 5, verified: 20, in_progress: 50, waiting: 70, solved: 100, archived: 100 };
          patch.progress = map[targetStatus] ?? 20;
          const { data: post } = await supabase.from('posts').select('status_history').eq('id', sug.target_id).maybeSingle();
          patch.status_history = [...(post?.status_history || []), { status: targetStatus, at: new Date().toISOString(), note: p.status_note || 'Applied from AI suggestion (admin approved)' }];
        }
        if (sug.kind === 'escalation') patch.priority = p.to || 'critical';
        if (sug.kind === 'reply') patch.admin_reply = clean(b.edited_text, 1000) || p.to || p.reply;
        if (sug.kind === 'merge') { patch.merged_into = p.to || p.merge_into; patch.hidden = true; }
        patch.updated_at = new Date().toISOString();

        const { error } = await supabase.from('posts').update(patch).eq('id', sug.target_id);
        if (error) throw error;
        const outcome = `Approved by admin — applied ${sug.kind} on ${sug.target_id} (${p.from || '—'} → ${String(p.to || targetStatus).slice(0, 60)})`;
        await supabase.from('agent_suggestions').update({ status: 'approved', resolved_at: new Date().toISOString(), outcome }).eq('id', b.id);
        await auditLog('admin', 'agent_approve', `Approved AI suggestion #${b.id} (${sug.kind}) on ${sug.target_id}: ${p.from || '—'} → ${String(p.to || targetStatus).slice(0, 80)}`);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return sanitizeError(res, err, 'agent');
  }
}
