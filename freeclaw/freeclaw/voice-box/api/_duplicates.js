// Smart Duplicate Complaint Detection — finds similar complaints and suggests merging.
// POST /api/duplicates { post_id }         →  check a specific post for duplicates
// GET  /api/duplicates                     →  list all duplicate groups
// POST /api/duplicates/merge { group_id, keep_post_id, merge_ids }  →  merge duplicates
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog } from './_auth.js';

/** Tokenize text into meaningful words (min 3 chars, lowercase) */
function tokenize(text) {
  return (text || '').toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
}

/** Jaccard similarity between two word sets */
function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((w) => setB.has(w));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

/** Calculate similarity between two posts */
function postSimilarity(a, b) {
  const wordsA = tokenize(`${a.title} ${a.description || ''}`);
  const wordsB = tokenize(`${b.title} ${b.description || ''}`);

  // Title similarity (weighted higher)
  const titleA = tokenize(a.title);
  const titleB = tokenize(b.title);
  const titleSim = jaccard(titleA, titleB);

  // Description similarity
  const descSim = jaccard(wordsA, wordsB);

  // Same category bonus
  const categoryMatch = a.category && b.category && a.category === b.category ? 0.15 : 0;

  // Weighted score: 50% title + 35% description + 15% category
  return Math.round((titleSim * 0.50 + descSim * 0.35 + categoryMatch) * 100);
}

/** Find all potential duplicates for a given post */
async function findDuplicatesForPost(postId) {
  const { data: targetPost } = await supabase.from('posts').select('*').eq('id', postId).maybeSingle();
  if (!targetPost) return null;

  const { data: candidates } = await supabase.from('posts')
    .select('id, title, description, category, status, priority, created_at')
    .eq('deleted', false).neq('id', postId)
    .order('created_at', { ascending: false }).limit(200);

  if (!candidates || candidates.length === 0) return { post: targetPost, duplicates: [], groups: [] };

  const results = candidates.map((c) => ({
    ...c,
    similarity: postSimilarity(targetPost, c),
  })).filter((c) => c.similarity >= 30).sort((a, b) => b.similarity - a.similarity);

  return { post: targetPost, duplicates: results.slice(0, 20) };
}

/** Find all duplicate clusters across the entire platform */
async function findAllDuplicateClusters() {
  const { data: posts } = await supabase.from('posts')
    .select('id, title, description, category, status, priority, created_at')
    .eq('deleted', false)
    .order('created_at', { ascending: false }).limit(300);

  if (!posts || posts.length < 2) return [];

  // Enrich with comment counts from separate table
  const postIds = posts.map((p) => p.id);
  const { data: allComments } = await supabase.from('comments').select('post_id').in('post_id', postIds.length ? postIds : ['_']);
  const cMap = {};
  (allComments || []).forEach((c) => { cMap[c.post_id] = (cMap[c.post_id] || 0) + 1; });
  const enriched = posts.map((p) => ({ ...p, comment_count: cMap[p.id] || 0 }));

  const clusters = [];
  const processed = new Set();

  for (let i = 0; i < enriched.length; i++) {
    if (processed.has(enriched[i].id)) continue;
    const cluster = [enriched[i]];
    processed.add(enriched[i].id);

    for (let j = i + 1; j < enriched.length; j++) {
      if (processed.has(enriched[j].id)) continue;
      const sim = postSimilarity(enriched[i], enriched[j]);
      if (sim >= 35) {
        cluster.push({ ...enriched[j], similarity: sim });
        processed.add(enriched[j].id);
      }
    }

    if (cluster.length > 1) {
      clusters.push({
        group_id: `group_${cluster[0].id}`,
        primary: { id: cluster[0].id, title: cluster[0].title, category: cluster[0].category, status: cluster[0].status, comment_count: cluster[0].comment_count },
        duplicates: cluster.slice(1).map((d) => ({ id: d.id, title: d.title, similarity: d.similarity, category: d.category, status: d.status })),
        total_count: cluster.length,
        avg_similarity: Math.round(cluster.slice(1).reduce((sum, d) => sum + d.similarity, 0) / Math.max(cluster.length - 1, 1)),
      });
    }
  }

  return clusters.sort((a, b) => b.total_count - a.total_count);
}

/** Merge duplicate complaints into one */
async function mergeDuplicates(keepPostId, mergeIds, reason) {
  // Update the kept post with merged count
  const { error: updateErr } = await supabase.from('posts').update({
    merged_into: keepPostId,
    status: 'in_progress',
    updated_at: new Date().toISOString(),
  }).in('id', mergeIds);
  if (updateErr) throw updateErr;

  // Move comments from merged posts to the kept post
  for (const mergeId of mergeIds) {
    const { data: comments } = await supabase.from('comments').select('id').eq('post_id', mergeId).eq('deleted', false);
    if (comments && comments.length > 0) {
      await supabase.from('comments').update({ post_id: keepPostId }).in('id', comments.map((c) => c.id));
    }
  }

  // Create a merge note on the kept post
  const { data: keptPost } = await supabase.from('posts').select('title, description').eq('id', keepPostId).maybeSingle();
  const mergeNote = `\n\n[Merged ${mergeIds.length} duplicate complaint(s) into this post on ${new Date().toLocaleDateString()}]`;
  await supabase.from('posts').update({
    description: (keptPost?.description || keptPost?.title || '') + mergeNote,
    updated_at: new Date().toISOString(),
  }).eq('id', keepPostId);

  return { merged: mergeIds.length, kept: keepPostId };
}

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // GET: list all duplicate clusters
    if (req.method === 'GET') {
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
      const clusters = await findAllDuplicateClusters();
      return res.status(200).json({ clusters, total_groups: clusters.length });
    }

    // POST
    if (req.method === 'POST') {
      if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
      const b = req.body || {};

      // Merge action
      if (b.action === 'merge') {
        if (!b.keep_post_id || !b.merge_ids?.length) {
          return res.status(400).json({ error: 'keep_post_id and merge_ids required' });
        }
        const result = await mergeDuplicates(b.keep_post_id, b.merge_ids, b.reason || '');
        await auditLog('admin', 'duplicates_merge', `Merged ${result.merged} posts into ${result.kept}`);
        return res.status(200).json(result);
      }

      // Check duplicates for a specific post
      if (!b.post_id) return res.status(400).json({ error: 'post_id required' });
      const result = await findDuplicatesForPost(b.post_id);
      if (!result) return res.status(404).json({ error: 'Post not found' });
      return res.status(200).json(result);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('duplicates error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
