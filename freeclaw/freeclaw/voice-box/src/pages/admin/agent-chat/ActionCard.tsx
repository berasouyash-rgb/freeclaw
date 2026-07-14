import { useState } from 'react';
import {
  Eye, ChevronDown, ChevronUp, PlayCircle, Loader2,
  CheckCircle2, XCircle, ExternalLink, Check,
} from 'lucide-react';
import type { Action } from './tool-meta';
import { TOOL_META } from './tool-meta';
import { getToolPreview } from './ActionPreviews';

/* ═══════════════════════════════════════════════════════════════
   EXPANDABLE ACTION CARD — click header to expand full preview
   ═══════════════════════════════════════════════════════════════ */
export default function ActionCard({
  action,
  onExecute,
  onDismiss,
  executing,
}: {
  action: Action;
  onExecute: () => void;
  onDismiss: () => void;
  executing: boolean;
}) {
  const [expanded, setExpanded] = useState(!action.result);

  const meta = TOOL_META[action.tool] || {
    label: action.tool, icon: Eye, color: 'text-ink3',
    bgColor: 'bg-surface2', borderColor: 'border-border', accentColor: 'slate',
  };
  const Icon = meta.icon;

  /* Execution result — animated success/failure */
  const renderResult = () => {
    if (!action.result) return null;
    const { success, error, data } = action.result;
    return (
      <div className={`vb-action-result rounded-xl p-3.5 border text-xs vb-stage-pop ${
        success ? 'bg-green-500/5 border-green-500/25' : 'bg-red-500/5 border-red-500/25'
      }`}>
        <div className="flex items-center gap-2.5 font-semibold">
          {success ? (
            <div className="w-7 h-7 rounded-full bg-green-500/15 flex items-center justify-center vb-pop">
              <CheckCircle2 size={14} className="text-green-400" />
            </div>
          ) : (
            <div className="w-7 h-7 rounded-full bg-red-500/15 flex items-center justify-center vb-pop">
              <XCircle size={14} className="text-red-400" />
            </div>
          )}
          <div>
            <p className={success ? 'text-green-400' : 'text-red-400'}>
              {success ? 'Action completed successfully' : `Failed: ${error || 'Unknown error'}`}
            </p>
            {success && (
              <p className="text-[10px] text-ink3 mt-0.5">
                Redirecting to {meta.redirectTab || 'relevant'} tab…
              </p>
            )}
          </div>
        </div>
        {success && data && (
          <pre className="mt-2 text-[10px] font-mono text-ink3/70 whitespace-pre-wrap max-h-20 overflow-auto">
            {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
          </pre>
        )}
        {/* Presentation open-in-tab button */}
        {success && action.tool === 'create_presentation' && action.result?.data && typeof action.result.data === 'object' && 'html' in (action.result.data as Record<string, unknown>) && (
          <button
            className="mt-2 btn btn-primary !text-[11px] !py-2 flex items-center gap-1.5 rounded-xl"
            onClick={() => {
              const html = (action.result!.data as Record<string, unknown>).html as string;
              const blob = new Blob([html], { type: 'text/html' });
              const url = URL.createObjectURL(blob);
              window.open(url, '_blank');
            }}
          >
            <ExternalLink size={12} /> Open Presentation
          </button>
        )}
      </div>
    );
  };

  return (
    <div key={action.result ? `done-${action.id}` : `pending-${action.id}`} className={`vb-action-card rounded-2xl border overflow-hidden transition-all duration-300 vb-rise ${
      action.result?.success === true ? 'border-green-500/30 bg-green-500/[0.03] vb-approval-flash vb-flash-success'
      : action.result?.success === false ? 'border-red-500/30 bg-red-500/[0.03] vb-approval-flash vb-flash-error'
      : `${meta.borderColor} bg-surface2/50 hover:bg-surface2`
    }`}>
      {/* ── Clickable header ── */}
      <button
        className="w-full text-left p-3.5 flex items-center gap-2.5 flex-wrap cursor-pointer select-none hover:bg-surface2/30 transition-colors"
        onClick={() => !action.result && setExpanded(!expanded)}
      >
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${meta.bgColor} vb-stage-pop`}>
          <Icon size={13} className={meta.color} />
        </div>
        <span className="font-semibold text-ink text-[13px] flex-1">{meta.label}</span>
        {action.destructive && (
          <span className="text-[8px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-bold border border-red-500/20 uppercase tracking-wider vb-pop">
            Destructive
          </span>
        )}
        {!action.result && (
          <>
            <span className="text-[8px] text-ink3 font-mono">{expanded ? 'CLICK TO COLLAPSE' : 'CLICK TO EXPAND'}</span>
            {expanded ? <ChevronUp size={12} className="text-ink3" /> : <ChevronDown size={12} className="text-ink3" />}
          </>
        )}
        {action.result?.success === true && <CheckCircle2 size={14} className="text-green-400" />}
        {action.result?.success === false && <XCircle size={14} className="text-red-400" />}
      </button>

      {/* ── Collapsed reason (when not expanded) ── */}
      {!expanded && action.reason && (
        <p className="text-[11px] text-ink3 leading-relaxed px-3.5 pb-3 pl-14 truncate">{action.reason}</p>
      )}

      {/* ── Expanded content: preview + buttons ── */}
      {expanded && (
        <div className="px-3.5 pb-3.5 space-y-3">
          {/* Reason */}
          {action.reason && (
            <p className="text-[11px] text-ink3 leading-relaxed pl-9">{action.reason}</p>
          )}

          {/* Visual preview — animated */}
          <div className="pl-1">
            {getToolPreview(action.tool, action.args, action.result)}
          </div>

          {/* Execution result */}
          {renderResult()}

          {/* Action buttons */}
          {!action.result && (
            <div className="flex gap-2 pt-1 pl-1">
              <button
                className={`btn !text-[11px] !py-2 !px-4 flex items-center gap-1.5 font-bold rounded-xl transition-all duration-200 ${
                  action.destructive
                    ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20 hover:shadow-red-500/40'
                    : 'bg-accent hover:bg-accent2 text-white shadow-lg shadow-accent/20 hover:shadow-accent/40'
                }`}
                disabled={executing}
                onClick={onExecute}
              >
                {executing ? (
                  <><Loader2 size={12} className="animate-spin" /><span>Executing…</span></>
                ) : (
                  <><PlayCircle size={12} /><span>Execute</span></>
                )}
              </button>
              <button
                className="btn btn-ghost !text-[11px] !py-2 !px-4 rounded-xl"
                onClick={onDismiss}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
