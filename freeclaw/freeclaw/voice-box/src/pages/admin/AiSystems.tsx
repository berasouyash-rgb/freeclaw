import { useCallback, useEffect, useState } from "react";
import { Activity, Bot, CheckCircle2, Cpu, Layers, Loader2, Play, RefreshCcw, ShieldAlert, Sparkles } from "lucide-react";
import { api } from "../../lib/api";
import { useApp } from "../../contexts/AppContext";

const AUTONOMOUS_EMPLOYEES = [
  {
    id: "backend-load-optimizer",
    name: "Backend Server & Load Optimizer",
    role: "Database connection pools, latency checks, session maintenance & query speed",
    division: "Infrastructure",
    icon: Cpu,
    color: "text-blue-500",
    bg: "bg-blue-500/10 border-blue-500/25",
  },
  {
    id: "platform-manager",
    name: "Platform Manager",
    role: "Sector triage, unassigned complaint routing, urgency prioritization",
    division: "Operations",
    icon: Layers,
    color: "text-purple-500",
    bg: "bg-purple-500/10 border-purple-500/25",
  },
  {
    id: "safety-sentinel",
    name: "AI Safety Sentinel",
    role: "Scans posts, comments & polls; auto-quarantines PII & inappropriate content",
    division: "Security",
    icon: ShieldAlert,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10 border-emerald-500/25",
  },
  {
    id: "workforce-supervisor",
    name: "Workforce Supervisor",
    role: "Monitors agent heartbeat, cleans stalled executions, asserts SLA standards",
    division: "Executive",
    icon: Activity,
    color: "text-amber-500",
    bg: "bg-amber-500/10 border-amber-500/25",
  },
  {
    id: "feedback-evaluator",
    name: "Content & Feedback Evaluator",
    role: "Synthesizes student sentiment, friction clusters, drafts executive briefs",
    division: "Intelligence",
    icon: Sparkles,
    color: "text-pink-500",
    bg: "bg-pink-500/10 border-pink-500/25",
  },
];

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

interface AiModelProbe {
  configured?: boolean;
  live?: boolean;
  model?: string;
  status?: number;
  latency_ms?: number;
  error?: string;
}

/** Live connectivity proof from /api/health `checks.ai_verification`. */
interface AiVerification {
  status?: string;
  verified_real_llm?: boolean;
  primary_fast?: string;
  primary_quality?: string;
  groq_live?: boolean;
  nvidia_live?: boolean;
  live_models?: string[];
  checked?: { groq?: AiModelProbe; nvidia?: AiModelProbe };
  latency_ms?: number;
  note?: string;
  timestamp?: string;
}

/**
 * AI Systems console — every managed AI task with its live health.
 * Read-only observe surface: rows render registry entries merged with
 * measured stats where observed ("no data yet" otherwise — never invented).
 * Refresh is an explicit button tap per the page-lifecycle contract.
 */
export default function AiSystems() {
  const { toast } = useApp();
  const [check, setCheck] = useState<AiCheck | null>(null);
  const [verification, setVerification] = useState<AiVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await api.get<{
        status?: string;
        checks?: { ai?: AiCheck; ai_verification?: AiVerification };
      }>("/api/health");
      setCheck(r.checks?.ai ?? null);
      setVerification(r.checks?.ai_verification ?? null);
      if (!r.checks?.ai) setError("Health endpoint returned no AI section.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load AI health");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const [runningAgent, setRunningAgent] = useState<string | null>(null);
  const [employeeReports, setEmployeeReports] = useState<Record<string, string>>({});

  const runEmployee = async (agentId: string) => {
    if (runningAgent) return;
    setRunningAgent(agentId);
    try {
      const res = await api.post<{ ok?: boolean; agent?: string; result?: { summary?: string } }>("/api/agents-cron", {
        agent: agentId,
      });
      // Never fabricate a success summary when the backend returns no result.
      const summary =
        res.result?.summary ||
        "Run finished, but the backend returned no summary — check the audit log before trusting it.";
      setEmployeeReports((prev) => ({ ...prev, [agentId]: summary }));
      toast(summary, "ok");
      await load();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Agent sweep failed", "err");
    } finally {
      setRunningAgent(null);
    }
  };

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

      {verification && (
        <div
          className={`card p-3 mb-3 ${verification.verified_real_llm ? "border-good" : "border-warn"}`}
          data-testid="ai-verification"
          role="status"
        >
          <p className="text-xs font-bold mb-1">
            {verification.verified_real_llm ? (
              <span className="text-good">Live model verified</span>
            ) : (
              <span className="text-warn">No live model answered</span>
            )}
            {typeof verification.latency_ms === "number" && (
              <span className="text-ink3 font-normal">
                {" "}— {verification.latency_ms}ms
              </span>
            )}
          </p>
          <p className="text-xs text-ink2">
            {(verification.live_models ?? []).length > 0
              ? `Answering now: ${(verification.live_models ?? []).join(", ")}`
              : "No provider returned generated text for the probe, so AI features report a degraded state instead of inventing answers."}
          </p>
          <p className="text-[10px] text-ink3 mt-1">
            Probe asserts real generated content, not just an HTTP 200
            {verification.timestamp
              ? ` — checked ${new Date(verification.timestamp).toLocaleTimeString()}`
              : ""}
            .
          </p>
        </div>
      )}

      {/* 24/7 Autonomous Workforce Fleet */}
      <div className="mb-6 space-y-3" data-testid="autonomous-workforce-fleet">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display font-semibold text-xs text-ink uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              On-demand agent routines (5)
            </h3>
            <p className="text-[11px] text-ink3">
              Routines connected to real LLMs. No 24/7 scheduler is configured — runs start when you trigger them or when an external scheduler calls the cron endpoint.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-300 border border-amber-400/30 font-semibold">
            On demand
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {AUTONOMOUS_EMPLOYEES.map((emp) => {
            const Icon = emp.icon;
            const isBusy = runningAgent === emp.id;
            const report = employeeReports[emp.id];
            return (
              <div
                key={emp.id}
                className="card p-3.5 flex flex-col justify-between hover:border-accent/40 transition-all rounded-2xl bg-surface/80"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded-xl border ${emp.bg}`}>
                        <Icon size={14} className={emp.color} />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-ink leading-tight">{emp.name}</h4>
                        <span className="text-[10px] text-ink3">{emp.division} Division</span>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded-full bg-good/10 text-good border border-good/20">
                      <CheckCircle2 size={9} /> On demand
                    </span>
                  </div>
                  <p className="text-[11px] text-ink2 leading-relaxed mb-3">
                    {emp.role}
                  </p>
                  {report && (
                    <div className="mb-3 p-2 rounded-lg bg-surface2/60 border border-border/60 text-[10px] text-ink2 line-clamp-3">
                      <span className="font-semibold text-accent block mb-0.5">Last Run:</span>
                      {report}
                    </div>
                  )}
                </div>
                <div className="pt-2 border-t border-border/40 flex items-center justify-between">
                  <span className="text-[10px] text-ink3 font-mono">LLM: invoked per run</span>
                  <button
                    type="button"
                    onClick={() => runEmployee(emp.id)}
                    disabled={isBusy}
                    className="btn btn-ghost !text-[10px] !py-1 !px-2.5 flex items-center gap-1 hover:text-accent cursor-pointer"
                  >
                    {isBusy ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                    {isBusy ? "Running…" : "Run Now"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
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
