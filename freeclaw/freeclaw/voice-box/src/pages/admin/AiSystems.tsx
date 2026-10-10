import { useCallback, useEffect, useState } from "react";
import { Bot, RefreshCcw } from "lucide-react";
import { api } from "../../lib/api";

interface AiTaskLive {
  calls?: number;
  errors?: number;
  successRate?: number;
  p50?: number | null;
  p95?: number | null;
  lastLane?: string;
  lastOk?: boolean;
  demoted?: string[];
}

interface AiRegistryEntry {
  key: string;
  owner?: string;
  description?: string;
  adminOnly?: boolean;
  lanes?: Array<{ provider?: string; model?: string; timeoutMs?: number; knownBad?: boolean }>;
  fallback?: string;
  rate?: { bucket?: string; windowSec?: number; max?: number; scope?: string };
  kill?: string;
}

interface AiCheck {
  status?: string;
  note?: string;
  issues?: string[];
  tasks?: Record<string, AiTaskLive>;
  registry?: AiRegistryEntry[];
}

/**
 * AI Systems console — every managed AI task with its live health.
 * Read-only observe surface: rows render registry entries merged with
 * measured stats where observed ("no data yet" otherwise — never invented).
 * Refresh is an explicit button tap per the page-lifecycle contract.
 */
export default function AiSystems() {
  const [check, setCheck] = useState<AiCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await api.get<{
        status?: string;
        checks?: { ai?: AiCheck };
      }>("/api/health");
      setCheck(r.checks?.ai ?? null);
      if (!r.checks?.ai) setError("Health endpoint returned no AI section.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load AI health");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const registry = check?.registry ?? [];
  const tasks = check?.tasks ?? {};
  const issues = check?.issues ?? [];

  return (
    <div data-testid="ai-systems">
      <div className="flex items-center gap-2 mb-3">
        <Bot size={16} className="text-accent" aria-hidden />
        <h2 className="font-display font-semibold text-sm">AI Systems</h2>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="btn btn-ghost !text-xs ml-auto"
        >
          <RefreshCcw size={13} aria-hidden />{" "}
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {check && check.status === "warning" && (
        <div
          className="card p-4 mb-3 border-warn"
          role="alert"
          data-testid="ai-warning"
        >
          <p className="text-xs font-bold text-warn mb-1">
            AI lanes need attention
          </p>
          <ul className="text-xs text-ink2 list-disc pl-4 space-y-0.5">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {check && check.status === "ok" && Object.keys(tasks).length === 0 && (
        <p className="text-xs text-ink3 mb-3" role="status">
          {check.note ?? "No AI calls observed yet — rows appear as traffic flows."}
        </p>
      )}

      {error && (
        <p className="text-xs text-bad mb-3" role="alert">
          {error}{" "}
          <button
            type="button"
            onClick={load}
            className="underline hover:no-underline"
          >
            Try again
          </button>
        </p>
      )}

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-ink3 border-b border-border">
              <th className="font-semibold px-3 py-2">Task</th>
              <th className="font-semibold px-3 py-2">Lanes</th>
              <th className="font-semibold px-3 py-2">Calls</th>
              <th className="font-semibold px-3 py-2">Success</th>
              <th className="font-semibold px-3 py-2">p95</th>
              <th className="font-semibold px-3 py-2">State</th>
            </tr>
          </thead>
          <tbody>
            {registry.map((entry) => {
              const live = tasks[entry.key];
              const demoted = live?.demoted ?? [];
              return (
                <tr
                  key={entry.key}
                  className="border-b border-border last:border-0"
                  data-testid="ai-task-row"
                >
                  <td className="px-3 py-2">
                    <span className="font-semibold text-ink block">
                      {entry.key}
                    </span>
                    <span className="text-ink3">{entry.description}</span>
                  </td>
                  <td className="px-3 py-2 text-ink2">
                    {(entry.lanes ?? [])
                      .map((l) => l.provider)
                      .join(" → ") || "local only"}
                  </td>
                  <td className="px-3 py-2 text-ink2">
                    {live ? live.calls : "—"}
                  </td>
                  <td className="px-3 py-2 text-ink2">
                    {live && typeof live.successRate === "number"
                      ? `${Math.round(live.successRate * 100)}%`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-ink2">
                    {live && typeof live.p95 === "number"
                      ? `${Math.round(live.p95)}ms`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {!live ? (
                      <span className="text-ink3">no data yet</span>
                    ) : demoted.length > 0 ? (
                      <span className="text-warn font-semibold">
                        demoted: {demoted.join(", ")}
                      </span>
                    ) : (
                      <span className="text-good font-semibold">healthy</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {registry.length === 0 && !loading && (
              <tr>
                <td
                  className="px-3 py-4 text-center text-ink3"
                  colSpan={6}
                >
                  No managed tasks reported.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-ink3 mt-2">
        Figures derive from measured calls on this instance — never estimates.
        Pause controls arrive with the budgets slice.
      </p>
    </div>
  );
}
