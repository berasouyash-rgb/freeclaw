// ═══════════════════════════════════════════════════════════════════
// DUPLICATE ISSUE CLUSTERING — group similar complaints into clusters
// ═══════════════════════════════════════════════════════════════════
// Instead of 50 identical complaints becoming 50 separate issues,
// cluster them into one underlying problem while preserving
// individual reports.
//
// Algorithm: simple text similarity using word overlap (no external
// dependencies). For production, this could use embeddings, but
// word-level Jaccard similarity is fast, deterministic, and works
// well for complaint-style text.
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";

const CLUSTER_KEY = "issue_clusters";

/**
 * Tokenize text into normalized words for comparison.
 */
function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can",
  "had", "her", "was", "one", "our", "out", "has", "have", "been",
  "from", "this", "that", "with", "they", "will", "each", "make",
  "about", "which", "their", "there", "than", "some", "them",
  "would", "could", "should", "just", "also", "into", "over",
  "such", "only", "other", "very", "when", "what", "your", "how",
  "its", "may", "too", "any",
]);

/**
 * Calculate Jaccard similarity between two word sets.
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Cluster an array of posts into groups of similar issues.
 * @param {Array<{id: string, title: string, description: string, category: string, status: string, created_at: string}>} posts
 * @param {number} threshold - minimum similarity to merge (0-1, default 0.35)
 * @returns {Array<{cluster_id: string, primary: object, members: object[], similarity: number, category: string, status_summary: object}>}
 */
export function clusterIssues(posts, threshold = 0.35) {
  if (!posts || posts.length === 0) return [];

  // Tokenize all posts
  const tokenized = posts.map((p) => ({
    post: p,
    tokens: new Set(tokenize(`${p.title} ${p.description || ""}`)),
  }));

  const clusters = [];
  const assigned = new Set();

  for (let i = 0; i < tokenized.length; i++) {
    if (assigned.has(i)) continue;

    const cluster = [tokenized[i]];
    assigned.add(i);

    for (let j = i + 1; j < tokenized.length; j++) {
      if (assigned.has(j)) continue;

      const sim = jaccardSimilarity(tokenized[i].tokens, tokenized[j].tokens);
      if (sim >= threshold) {
        cluster.push(tokenized[j]);
        assigned.add(j);
      }
    }

    // Only create cluster if it has 2+ members (actual duplicates)
    if (cluster.length >= 2) {
      const statuses = {};
      for (const c of cluster) {
        const s = c.post.status || "reported";
        statuses[s] = (statuses[s] || 0) + 1;
      }

      clusters.push({
        cluster_id: `cl_${cluster[0].post.id}`,
        primary: cluster[0].post,
        members: cluster.map((c) => c.post),
        count: cluster.length,
        similarity: threshold,
        category: cluster[0].post.category || "uncategorized",
        status_summary: statuses,
      });
    }
  }

  // Sort by cluster size (largest first)
  clusters.sort((a, b) => b.count - a.count);

  return clusters;
}

/**
 * Run clustering on open complaints and persist results.
 */
export async function runClustering() {
  const { data: posts } = await supabase
    .from("posts")
    .select("id, title, description, category, status, priority, author_id, created_at")
    .eq("type", "problem")
    .eq("deleted", false)
    .eq("hidden", false)
    .in("status", ["reported", "in_progress", "verified"])
    .order("created_at", { ascending: false })
    .limit(500);

  if (!posts || posts.length < 5) return { clusters: [], total: 0 };

  const clusters = clusterIssues(posts);

  // Persist
  try {
    await supabase.from("settings").upsert(
      {
        key: CLUSTER_KEY,
        value: {
          clusters,
          total: clusters.length,
          total_dupes: clusters.reduce((sum, c) => sum + c.count, 0),
          run_at: new Date().toISOString(),
        },
      },
      { onConflict: "key" },
    );
  } catch (err) {
    console.error("[cluster] persist failed:", err?.message);
  }

  return { clusters, total: clusters.length };
}

/**
 * Get persisted clusters.
 */
export async function getClusters() {
  try {
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", CLUSTER_KEY)
      .maybeSingle();
    return data?.value || { clusters: [], total: 0 };
  } catch {
    return { clusters: [], total: 0 };
  }
}
