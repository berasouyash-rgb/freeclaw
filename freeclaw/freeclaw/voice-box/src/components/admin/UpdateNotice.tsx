import { RefreshCw } from "lucide-react";

interface UpdateNoticeProps {
  count: number;
  onViewUpdates: () => void;
  refreshing?: boolean;
  lastUpdatedAt?: number | null;
}

function updatedLabel(timestamp: number | null | undefined): string | null {
  if (!timestamp) return null;
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `Updated ${minutes}m ago`;
}

export default function UpdateNotice({
  count,
  onViewUpdates,
  refreshing = false,
  lastUpdatedAt,
}: UpdateNoticeProps) {
  if (count <= 0) return null;

  const updated = updatedLabel(lastUpdatedAt);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/20 bg-accent/[0.05] px-3 py-2">
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="text-xs font-medium text-ink2"
      >
        {count} new {count === 1 ? "update" : "updates"} available
        {updated ? <span className="ml-2 font-normal text-ink3">{updated}</span> : null}
      </div>
      <button
        type="button"
        className="btn btn-soft !px-2.5 !py-1.5 !text-xs"
        onClick={onViewUpdates}
        disabled={refreshing}
        aria-label={`View ${count} new ${count === 1 ? "update" : "updates"}`}
      >
        <RefreshCw size={12} aria-hidden className={refreshing ? "animate-spin" : ""} />
        View updates
      </button>
    </div>
  );
}
