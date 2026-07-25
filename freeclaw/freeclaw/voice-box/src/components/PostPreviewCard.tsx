/**
 * PostPreviewCard — Renders a visual preview of a post exactly as it would appear
 * on the published feed. Used by the pre-publish review queue so admins can see
 * the actual content before approving/rejecting flagged submissions.
 */
import { Image as ImageIcon, Clock, AlertTriangle, Shield } from 'lucide-react';
import { timeAgo } from '../lib/utils';

interface PostPreviewCardProps {
  title?: string;
  description?: string;
  body?: string;
  category?: string;
  priority?: string;
  content_type?: string;
  risk_score?: number;
  checks?: {
    privacy?: { pass: boolean; issues: string[] };
    safety?: { pass: boolean; issues: string[] };
    spam?: { pass: boolean; issues: string[] };
    quality?: { pass: boolean; issues: string[] };
  };
  summary?: string;
  author_id?: string;
  created_at?: string;
  image_url?: string;
  /** If true, show a red "BLOCKED" banner */
  blocked?: boolean;
}

const categoryColors: Record<string, string> = {
  Academics: '#3b82f6',
  Facilities: '#f59e0b',
  Food: '#10b981',
  Bullying: '#ef4444',
  Teachers: '#8b5cf6',
  Events: '#06b6d4',
  Transport: '#f97316',
  Sports: '#22c55e',
  Technology: '#6366f1',
  Library: '#a855f7',
  Hostel: '#ec4899',
  Security: '#dc2626',
  Cleanliness: '#14b8a6',
  Medical: '#e11d48',
  Other: '#6b7280',
};

const priorityColors: Record<string, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  medium: '#6b7280',
  low: '#22c55e',
};

export default function PostPreviewCard({
  title, description, body, category, priority, content_type,
  risk_score, checks, summary, author_id, created_at, image_url, blocked,
}: PostPreviewCardProps) {
  const catColor = categoryColors[category || ''] || categoryColors.Other;
  const priColor = priorityColors[priority || ''] || priorityColors.medium;

  // Count issues from checks
  const allIssues = [
    ...(checks?.privacy?.issues || []),
    ...(checks?.safety?.issues || []),
    ...(checks?.spam?.issues || []),
    ...(checks?.quality?.issues || []),
  ];
  const issueCount = allIssues.length;

  return (
    <div className="relative rounded-xl border border-border bg-surface overflow-hidden" style={{ maxWidth: 400 }}>
      {/* BLOCKED banner */}
      {blocked && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-3 py-1.5 flex items-center gap-1.5">
          <Shield size={12} className="text-red-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-red-400">
            Blocked by AI — Review Required
          </span>
        </div>
      )}

      {/* Image preview */}
      {image_url && (
        <div className="relative h-36 bg-surface2 overflow-hidden">
          <img
            src={image_url}
            alt={title || 'Post image'}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <span className="absolute top-2 left-2 chip !text-[9px] !py-0.5 !px-1.5 bg-black/60 text-white backdrop-blur-sm">
            <ImageIcon size={9} /> screenshot
          </span>
        </div>
      )}

      <div className="p-3.5">
        {/* Category + Priority badges */}
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {category && (
            <span
              className="chip !text-[9px] !py-0.5"
              style={{ color: catColor, borderColor: catColor + '44' }}
            >
              {category}
            </span>
          )}
          {priority && priority !== 'medium' && (
            <span
              className="chip !text-[9px] !py-0.5"
              style={{ color: priColor, borderColor: priColor + '44' }}
            >
              {priority}
            </span>
          )}
          {content_type && content_type !== 'post' && (
            <span className="chip !text-[9px] !py-0.5 text-ink3">
              {content_type}
            </span>
          )}
        </div>

        {/* Title */}
        <p className="text-sm font-semibold leading-snug mb-1">
          {title || '(no title)'}
        </p>

        {/* Description */}
        {description && (
          <p className="text-xs text-ink2 leading-relaxed line-clamp-4 mb-1.5">
            {description}
          </p>
        )}

        {/* Body (for comments/replies) */}
        {body && !description && (
          <p className="text-xs text-ink2 leading-relaxed line-clamp-4 mb-1.5">
            {body}
          </p>
        )}

        {/* AI Summary */}
        {summary && (
          <div className="mt-2 p-2 rounded-lg bg-blue-500/5 border border-blue-500/10">
            <p className="text-[10px] text-blue-400 font-medium uppercase tracking-wide mb-0.5">AI Summary</p>
            <p className="text-xs text-ink2">{summary}</p>
          </div>
        )}

        {/* Risk score bar */}
        {typeof risk_score === 'number' && (
          <div className="mt-2.5 flex items-center gap-2">
            <span className="text-[10px] text-ink3">Risk</span>
            <div className="flex-1 h-1.5 rounded-full bg-surface2 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, risk_score)}%`,
                  background: risk_score >= 70 ? '#ef4444' : risk_score >= 30 ? '#f59e0b' : '#22c55e',
                }}
              />
            </div>
            <span className="text-[10px] font-mono font-semibold" style={{ color: risk_score >= 70 ? '#ef4444' : risk_score >= 30 ? '#f59e0b' : '#22c55e' }}>
              {risk_score}
            </span>
          </div>
        )}

        {/* Issues list */}
        {issueCount > 0 && (
          <div className="mt-2 space-y-0.5">
            {allIssues.slice(0, 5).map((issue, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <AlertTriangle size={10} className="text-amber-400 mt-0.5 shrink-0" />
                <span className="text-[10px] text-ink2 leading-tight">{issue}</span>
              </div>
            ))}
            {issueCount > 5 && (
              <span className="text-[10px] text-ink3">+{issueCount - 5} more issue(s)</span>
            )}
          </div>
        )}

        {/* Meta row */}
        <div className="flex items-center gap-3 text-[10px] text-ink3 mt-2.5 pt-2 border-t border-border">
          {author_id && <span>by {author_id.slice(0, 12)}…</span>}
          {created_at && (
            <span className="flex items-center gap-0.5">
              <Clock size={9} /> {timeAgo(created_at)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
