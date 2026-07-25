import { useMemo, useState } from 'react';

const STOP = new Set(['the', 'and', 'for', 'this', 'that', 'with', 'have', 'has', 'been', 'are', 'was', 'were', 'they', 'them', 'their', 'there', 'from', 'would', 'could', 'should', 'about', 'after', 'before', 'during', 'every', 'almost', 'also', 'because', 'but', 'not', 'you', 'your', 'our', 'ours', 'its', 'it\u2019s', 'into', 'over', 'under', 'more', 'most', 'some', 'any', 'all', 'can', 'cant', 'like', 'just', 'get', 'gets', 'make', 'makes', 'need', 'needs', 'even', 'still', 'very', 'too', 'than', 'then', 'when', 'where', 'while', 'who', 'what', 'why', 'how', 'does', 'doesnt', 'dont', 'isnt', 'wont']);

/**
 * Theme word cloud — extracts the most frequent meaningful words across posts.
 * Words animate in with staggered pops; click a word to filter by it.
 */
export default function WordCloud({ posts, onWordClick }: { posts: any[]; onWordClick?: (word: string) => void }) {
  const [activeWord, setActiveWord] = useState<string | null>(null);

  const words = useMemo(() => {
    const freq: Record<string, number> = {};
    posts.forEach((p) => {
      `${p.title} ${p.description} ${(p.tags || []).join(' ')}`.toLowerCase()
        .split(/[^a-z\u00c0-\u024f]+/)
        .filter((w) => w.length > 3 && !STOP.has(w))
        .forEach((w) => { freq[w] = (freq[w] || 0) + 1; });
    });
    return Object.entries(freq)
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 28);
  }, [posts]);

  if (!words.length) return <p className="text-xs text-ink3 text-center py-6">Not enough posts yet to detect themes.</p>;

  const first = words[0];
  if (!first) return <p className="text-xs text-ink3 text-center py-6">Not enough posts yet to detect themes.</p>;
  const max = first[1];
  const COLORS = ['var(--vb-accent)', '#d98a0b', '#16a06a', '#dc4b4b', 'var(--vb-accent2)'];

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 py-2" role="list" aria-label="Common themes">
      {words.map(([word, n], i) => {
        const scale = 0.72 + (n / max) * 1.1; // 0.72rem → 1.82rem
        const active = activeWord === word;
        return (
          <button key={word} role="listitem"
            onClick={() => { const next = active ? null : word; setActiveWord(next); onWordClick?.(next || ''); }}
            className={`vb-rise font-display font-semibold leading-none transition-all hover:scale-110 active:scale-95 ${active ? 'underline' : ''}`}
            style={{
              fontSize: `${scale}rem`,
              color: active ? 'var(--vb-accent)' : COLORS[i % COLORS.length],
              opacity: active || !activeWord ? 0.55 + (n / max) * 0.45 : 0.25,
              animationDelay: `${i * 40}ms`,
            }}
            title={`“${word}” appears in ${n} posts — click to filter`}>
            {word}
          </button>
        );
      })}
    </div>
  );
}
