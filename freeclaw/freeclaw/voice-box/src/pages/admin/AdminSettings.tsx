import {
	Bot,
	KeyRound,
	List,
	LogOut,
	ShieldCheck,
	SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api, clearAdminSession } from "../../lib/api";
import { sha256 } from "../../lib/utils";
import { INFRASTRUCTURE_COPY, SERVER_PII_COPY } from "../../lib/privacyCopy";
import ProviderSettings from "./ProviderSettings";

export default function AdminSettings() {
	const { toast } = useApp();
	const [pw1, setPw1] = useState("");
	const [pw2, setPw2] = useState("");
	const [busy, setBusy] = useState(false);

	// Mirror of the server's auth mode: env-secret deployments sign in with
	// ADMIN_SESSION_SECRET, so the password form would be a lie — show the
	// rotate-the-env-var note and a session kill switch instead.
	const [envMode, setEnvMode] = useState(false);
	const [revoking, setRevoking] = useState(false);
	useEffect(() => {
		api
			.get<{ env_secret: boolean }>("/api/admin?action=auth_mode")
			.then((r) => setEnvMode(!!r.env_secret))
			.catch(() => setEnvMode(false));
	}, []);

	// ── Live AI-provider posture (mirrors ProviderSettings' own read) ──
	// The security copy must state the ACTUAL default provider/model, not a
	// hardcoded "Claude + ANTHROPIC_API_KEY" claim: /api/ai runs
	// callLLMChain (provider-DB chain → NIM fallback → heuristic), so the
	// active engine is whatever the admin has set as default right now.
	const [defaultProvider, setDefaultProvider] = useState<{ name: string; model: string } | null>(null);
	useEffect(() => {
		api
			.get<Record<string, { name: string; model: string; is_default: boolean; enabled?: boolean }>>(
				"/api/providers?action=list",
			)
			.then((rows) => {
				const def = Object.values(rows || {}).find((p) => p.is_default && p.enabled !== false);
				setDefaultProvider(def ? { name: def.name, model: def.model } : null);
			})
			.catch(() => setDefaultProvider(null));
	}, []);

	// ── Platform controls (agent kill switch + spam sensitivity) ────
	const [agentActions, setAgentActions] = useState<boolean | null>(null);
	const [agentSaving, setAgentSaving] = useState(false);
	const [spamCfg, setSpamCfg] = useState<{ flag: number; review: number; quarantine: number } | null>(null);
	const [spamSaving, setSpamSaving] = useState(false);
	const [retentionHours, setRetentionHours] = useState<number | null>(null);
	const [retentionSaving, setRetentionSaving] = useState(false);
	const [feedPageSize, setFeedPageSize] = useState<number | null>(null);
	const [feedSaving, setFeedSaving] = useState(false);
	const [autoDelete, setAutoDelete] = useState<boolean | null>(null);
	// Per-class janitor toggles (mirror of api/_cleanup.js JANITOR_CLASSES —
	// rename in both places). Null = not loaded yet; absence of a key means
	// enabled (server default true).
	const [janitorClasses, setJanitorClasses] = useState<Record<string, boolean> | null>(null);
	const JANITOR_CLASS_LABELS: Array<{ key: string; label: string; desc: string }> = [
		{ key: "comments", label: "Old comments", desc: "Comments older than 30 days" },
		{ key: "reactions", label: "Old reactions", desc: "Reactions older than 30 days" },
		{ key: "chat_messages", label: "Old chat messages", desc: "Chat messages older than 30 days" },
		{ key: "activity_logs", label: "Old activity logs", desc: "Activity logs older than 30 days" },
		{ key: "agent_conversations", label: "Old agent conversations", desc: "Agent conversations older than 30 days" },
		{ key: "archived_polls", label: "Archived polls", desc: "Archived polls older than 30 days" },
		{ key: "agent_history", label: "Agent runtime history", desc: "Executions + insights older than 90 days" },
	];
	const [cleanupStats, setCleanupStats] = useState<{ cleanup?: { last_run_at?: string; duration_ms?: number; results?: Record<string, number> }; purge?: { last_purge_at?: string } } | null>(null);
	useEffect(() => {
		api
			.get<{ enabled: boolean }>("/api/admin?action=get_agent_actions")
			.then((r) => setAgentActions(r.enabled !== false))
			.catch(() => setAgentActions(null));
		api
			.get<{ flag: number; review: number; quarantine: number }>("/api/admin?action=get_spam_config")
			.then(setSpamCfg)
			.catch(() => setSpamCfg(null));
		api
			.get<{ user_delete_hours: number; auto_delete_enabled?: boolean; classes?: Record<string, boolean> }>("/api/admin?action=get_retention_config")
			.then((r) => { setRetentionHours(r.user_delete_hours);
			setAutoDelete(r.auto_delete_enabled !== false); setJanitorClasses(r.classes ?? {}); })
			.catch(() => setRetentionHours(null));
	api
		.get<{ page_size: number }>("/api/admin?action=get_feed_config")
		.then((r) => setFeedPageSize(r.page_size))
		.catch(() => setFeedPageSize(null));
		api
			.get<{ cleanup: unknown; purge: unknown }>("/api/admin?action=get_cleanup_stats")
			.then((r) => setCleanupStats(r as never))
			.catch(() => setCleanupStats(null));
	}, []);

	const toggleAgentActions = async () => {
		if (agentSaving || agentActions === null) return;
		const next = !agentActions;
		if (
			next === false &&
			!window.confirm(
				"Stop all autonomous agent actions? Agents will keep observing and reporting, but will change nothing until you re-enable this.",
			)
		)
			return;
		setAgentSaving(true);
		try {
			const r = await api.post<{ enabled: boolean }>("/api/admin", {
				action: "set_agent_actions",
				enabled: next,
			});
			setAgentActions(r.enabled !== false);
			toast(
				next
					? "Agent actions resumed"
					: "Agent actions stopped — agents report only",
				"ok",
			);
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to update agent switch", "err");
		}
		setAgentSaving(false);
	};

		const saveRetention = async () => {
		if (retentionSaving || retentionHours === null) return;
		setRetentionSaving(true);
		try {
			const r = await api.post<{ user_delete_hours: number; auto_delete_enabled: boolean; classes?: Record<string, boolean> }>("/api/admin", {
				action: "set_retention_config",
				user_delete_hours: retentionHours,
				auto_delete_enabled: autoDelete ?? true,
				classes: janitorClasses ?? {},
			});
			setRetentionHours(r.user_delete_hours);
			setAutoDelete(r.auto_delete_enabled !== false);
			setJanitorClasses(r.classes ?? {});
			toast(r.auto_delete_enabled === false ? "Auto-delete off — deleted posts stay visible to admins" : `Deleted posts auto-remove after ${r.user_delete_hours}h`, "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to save retention", "err");
		}
		setRetentionSaving(false);
	};

	const restoreRetentionDefaults = async () => {
		if (retentionSaving) return;
		setRetentionSaving(true);
		try {
			const allOn: Record<string, boolean> = {};
			for (const c of JANITOR_CLASS_LABELS) allOn[c.key] = true;
			const r = await api.post<{ user_delete_hours: number; auto_delete_enabled: boolean; classes?: Record<string, boolean> }>("/api/admin", { action: "set_retention_config", user_delete_hours: 5, auto_delete_enabled: true, classes: allOn });
			setRetentionHours(r.user_delete_hours);
			setAutoDelete(r.auto_delete_enabled !== false);
			setJanitorClasses(r.classes ?? allOn);
			toast("Retention restored to the 5h default", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to restore defaults", "err");
		}
		setRetentionSaving(false);
	};

const saveFeedPageSize = async () => {
	if (feedSaving || feedPageSize === null) return;
	setFeedSaving(true);
	try {
		const r = await api.post<{ page_size: number }>("/api/admin", {
		action: "set_feed_config",
		page_size: feedPageSize,
		});
		setFeedPageSize(r.page_size);
		toast(`Feed loads ${r.page_size} posts at once`, "ok");
	} catch (e: unknown) {
		toast(e instanceof Error ? e.message : "Failed to save feed page size", "err");
	}
	setFeedSaving(false);
};
const saveSpamConfig = async () => {
		if (spamSaving || !spamCfg) return;
		setSpamSaving(true);
		try {
			const r = await api.post<{ flag: number; review: number; quarantine: number }>(
				"/api/admin",
				{ action: "set_spam_config", config: spamCfg },
			);
			// Server returns the normalized (clamped + ordered) config — adopt it.
			setSpamCfg(r);
			toast("Spam sensitivity saved", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to save spam settings", "err");
		}
		setSpamSaving(false);
	};

	const revokeAll = async () => {
		if (revoking) return;
		setRevoking(true);
		try {
			await api.post("/api/admin", { action: "revoke_all_sessions" });
			// The server just killed every session INCLUDING this one — drop
			// the local token and return to the login gate. Without this the
			// console stays open while every action 403s.
			clearAdminSession();
			toast("All admin sessions revoked — signed out everywhere", "ok");
			setTimeout(() => window.location.reload(), 800);
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to revoke sessions", "err");
		}
		setRevoking(false);
	};

	/* ── Password form ───────────────────────────────────────────────
	 * The admin chooses ANY password — no strength gate, no blocklist. A
	 * deliberate product decision by the owner. The only requirements are
	 * non-empty and both-fields-match (typo protection, not a strength
	 * rule). The wire protocol sends only a SHA-256 hash, and login
	 * rate-limiting (10 tries / 5 min per IP) bounds online guessing of
	 * any password, however weak, so the form does not fight the admin. */
	const matches = pw1.length > 0 && pw1 === pw2;
	const canSubmit = matches && !busy;

	const changePassword = async () => {
		if (!pw1) {
			toast("Enter a new password first", "err");
			return;
		}
		if (!matches) {
			toast("Passwords do not match", "err");
			return;
		}
		setBusy(true);
		try {
			await api.post("/api/admin", {
				action: "change_password",
				new_hash: await sha256(pw1),
			});
			setPw1("");
			setPw2("");
			toast("Password updated — use it on your next login", "ok");
		} catch (e: unknown) {
			toast(
				e instanceof Error ? e.message : "Failed to change password",
				"err",
			);
		}
		setBusy(false);
	};

	return (
		<div className="max-w-lg">
			<h1 className="font-display font-bold text-xl mb-4">Settings</h1>

			{envMode ? (
				<div className="card p-5 mb-4">
					<h2 className="font-display font-semibold text-sm flex items-center gap-2 mb-2">
						<ShieldCheck size={15} className="text-accent" /> Admin sign-in uses an environment secret
					</h2>
					<p className="text-xs text-ink2 leading-relaxed">
						This deployment authenticates admins with the{" "}
						<code className="font-mono">ADMIN_SESSION_SECRET</code> environment
						variable, so there is no password stored here to change. To rotate access,
						update that variable in your deployment environment and redeploy. Sessions
						are database-backed and expire after 60 minutes regardless.
					</p>
					<button
						className="btn btn-danger !text-xs mt-3"
						onClick={revokeAll}
						disabled={revoking}
					>
						<LogOut size={13} />{" "}
						{revoking ? "Revoking…" : "Sign out all admin sessions"}
					</button>
				</div>
			) : (
			<div className="card p-5 mb-4">
				<h2 className="font-display font-semibold text-sm flex items-center gap-2 mb-3">
					<KeyRound size={15} className="text-accent" /> Change admin password
				</h2>
				<div className="space-y-3">
					<input
						type="password"
						className="input"
						placeholder="New password — your choice"
						value={pw1}
						onChange={(e) => setPw1(e.target.value)}
					/>
					<input
						type="password"
						className="input"
						placeholder="Confirm new password"
						value={pw2}
						onChange={(e) => setPw2(e.target.value)}
					/>
					{pw2.length > 0 && !matches && (
						<p className="text-[11px] text-warn">Passwords do not match yet.</p>
					)}
					<button
						className="btn btn-primary !text-xs"
						onClick={changePassword}
						disabled={!canSubmit}
					>
						{busy ? "Saving…" : "Update password"}
					</button>
				</div>
				<p className="text-[11px] text-ink3 mt-3">
					Passwords are hashed with SHA-256 in your browser before transmission
					— the plain text never leaves this device.
				</p>
			</div>
			)}

			<div className="card p-5 mb-4">
				<h2 className="font-display font-semibold text-sm flex items-center gap-2 mb-3">
					<Bot size={15} className="text-accent" /> Autonomous agents
				</h2>
				<div className="flex items-center justify-between gap-3">
					<div className="text-xs text-ink2 leading-relaxed">
						<p className="font-semibold text-ink text-xs mb-0.5">
							{agentActions === null ? "Checking…" : agentActions ? "Agent actions enabled" : "Agent actions stopped"}
						</p>
						<p>
							Agents observe, flag and report continuously. This switch controls
							whether they may also <b>act</b> — quarantine, mask, archive and
							reconcile. Every action stays audited either way.
						</p>
					</div>
					<button
						type="button"
						role="switch"
						aria-checked={agentActions === true}
						disabled={agentSaving || agentActions === null}
						onClick={toggleAgentActions}
						className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
							agentActions ? "bg-good" : "bg-surface3"
						}`}
					>
						<span
							className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
								agentActions ? "left-[22px]" : "left-0.5"
							}`}
						/>
					</button>
				</div>
			</div>

			<div className="card p-5 mb-4">
				<h2 className="font-display font-semibold text-sm flex items-center gap-2 mb-1">
					<SlidersHorizontal size={15} className="text-accent" /> Spam sensitivity
				</h2>
				<p className="text-xs text-ink2 mb-4">
					Posts scoring above a threshold are flagged for review, held, or
					quarantined. Higher numbers = fewer false alarms. Applies to new
					submissions immediately.
				</p>
				{spamCfg && (
					<div className="grid grid-cols-3 gap-3">
						{(
							[
								["flag", "Flag", "Mark suspicious"],
								["review", "Hold", "Needs admin review"],
								["quarantine", "Quarantine", "Reject outright"],
							] as const
						).map(([key, label, hint]) => (
							<label key={key} className="text-xs">
								<span className="font-semibold text-ink block mb-1">{label}</span>
								<input
									type="number"
									min={0}
									max={100}
									className="input !py-1.5"
									value={spamCfg[key]}
									onChange={(e) =>
										setSpamCfg({ ...spamCfg, [key]: Number(e.target.value) })
									}
								/>
								<span className="text-[10px] text-ink3">{hint} (0–100)</span>
							</label>
						))}
					</div>
				)}
				<button
					className="btn btn-primary !text-xs mt-4"
					onClick={saveSpamConfig}
					disabled={spamSaving || !spamCfg}
				>
					{spamSaving ? "Saving…" : "Save spam settings"}
				</button>
			</div>

						<div className="card p-5 mb-4">
				<h2 className="font-display font-semibold text-sm flex items-center gap-2 mb-1">
					<SlidersHorizontal size={15} className="text-accent" /> Deleted-post retention
				</h2>
				<p className="text-xs text-ink2 mb-4">
					User-deleted posts stay visible in the admin feed with deleter and
					time, then hard-delete automatically with their comments and
					reactions. 1–168 hours. Default 5h. Change is audited.
				</p>
				<label className="text-xs block max-w-48">
					<span className="font-semibold text-ink block mb-1">Auto-remove after (hours)</span>
					<input
						type="number"
						min={1}
						max={168}
						className="input !py-1.5"
						value={retentionHours ?? ""}
						onChange={(e) => setRetentionHours(Number(e.target.value))}
						aria-label="User-deleted auto-remove hours"
					/>
					<span className="text-[10px] text-ink3">1–168, whole hours</span>
				</label>
				<label className="flex items-center gap-2 text-xs mt-3 cursor-pointer">
					<input
						type="checkbox"
						checked={autoDelete ?? true}
						onChange={(e) => setAutoDelete(e.target.checked)}
						aria-label="Auto-delete user-deleted posts"
						className="w-4 h-4"
					/>
					<span className="font-semibold text-ink">Auto-delete on <span className="font-normal text-ink3">(off keeps deleted rows for admins)</span></span>
				</label>
				<fieldset className="mt-4" data-testid="janitor-fieldset">
					<legend className="text-xs font-semibold text-ink mb-2">Janitor passes <span className="font-normal text-ink3">(off skips that class only — orphans, duplicates, sessions, notifications always run)</span></legend>
					<div className="grid gap-2">
						{JANITOR_CLASS_LABELS.map((c) => (
							<label key={c.key} className="flex items-start gap-2 text-xs cursor-pointer">
								<input
									type="checkbox"
									checked={janitorClasses ? janitorClasses[c.key] !== false : true}
									onChange={(e) => setJanitorClasses({ ...(janitorClasses ?? {}), [c.key]: e.target.checked })}
									aria-label={c.label}
									className="w-4 h-4 mt-0.5"
								/>
								<span><span className="font-semibold text-ink">{c.label}</span> <span className="text-ink3">— {c.desc}</span></span>
							</label>
						))}
					</div>
				</fieldset>
				{cleanupStats?.cleanup && (
					<p className="text-[11px] text-ink3 mt-3" role="status">
						Last optimization: {cleanupStats.cleanup.last_run_at ? new Date(cleanupStats.cleanup.last_run_at).toLocaleString() : "never"}
						{typeof cleanupStats.cleanup.duration_ms === "number" ? ` · took ${(cleanupStats.cleanup.duration_ms / 1000).toFixed(1)}s` : ""}
						{cleanupStats.cleanup.results ? ` · removed ${Object.values(cleanupStats.cleanup.results).reduce((x, y) => x + (typeof y === "number" ? y : 0), 0)} rows` : ""}
					</p>
				)}
				<p className="text-xs text-ink2 mt-3">
Currently: {autoDelete === false ? "deleted posts are kept for admins indefinitely" : `auto-remove ${retentionHours ?? 5}h after deletion`}.</p>
{(autoDelete === false || (retentionHours !== null && retentionHours <= 2)) && (
<p className="text-[11px] text-warn mt-2" role="alert">{/* retention warnings */}{autoDelete === false ? "Warning — auto-delete is off: deleted rows accumulate until purged manually. Watch table sizes in Health." : "Warning — short window: admins have little time to review a deletion before it is gone permanently."}</p>
)}
<button
					className="btn btn-primary !text-xs mt-4"
					onClick={saveRetention}
					disabled={retentionSaving || retentionHours === null || autoDelete === null}
				>
					{retentionSaving ? "Saving…" : "Save retention"}
				</button>
<button className="btn btn-ghost !text-xs mt-4 ml-2" onClick={restoreRetentionDefaults} disabled={retentionSaving || retentionHours === null}>Restore 5h default</button>
			</div>

<div className="card p-5 mb-4">
			<h2 className="font-display font-semibold text-sm flex items-center gap-2 mb-1">
				<List size={15} className="text-accent" /> Feed page size
			</h2>
			<p className="text-xs text-ink2 mb-4">
				How many posts load at once on the feed. 5–100. Default 30. Smaller is faster on slow networks. Change is audited.
			</p>
			<label className="text-xs block max-w-48">
				<span className="font-semibold text-ink block mb-1">Posts per load</span>
				<input
					type="number"
					min={5}
					max={100}
					className="input !py-1.5"
					value={feedPageSize ?? ""}
					onChange={(e) => setFeedPageSize(Number(e.target.value))}
					aria-label="Posts loaded per feed fetch"
				/>
				<span className="text-[10px] text-ink3">5–100, whole posts</span>
			</label>
			<button
				className="btn btn-primary !text-xs mt-4"
				onClick={saveFeedPageSize}
				disabled={feedSaving || feedPageSize === null}
			>
				{feedSaving ? "Saving…" : "Save feed page size"}
			</button>
</div>
<div className="card p-5 mb-4">
				<h2 className="font-display font-semibold text-sm flex items-center gap-2 mb-2">
					<ShieldCheck size={15} className="text-good" /> Security posture
				</h2>
				<ul className="text-xs text-ink2 space-y-1.5 list-disc pl-4">
					<li>Sessions expire automatically after 60 minutes.</li>
					<li>{SERVER_PII_COPY}</li>
					<li>
						All user input is sanitized server-side; profanity is masked
						automatically.
					</li>
					<li>
						Rate limits: 3 posts/min, 5 comments/30s, 2 polls/2min per anonymous
						ID.
					</li>
					<li>
						{defaultProvider
							? `AI moderation runs on ${defaultProvider.name} (${defaultProvider.model}) — the default provider set under AI providers below; without a working key a built-in heuristic engine is used.`
							: "AI moderation runs on a built-in heuristic engine (no AI provider configured). Set a default under AI providers below to enable model-backed review."}
					</li>
				</ul>
			</div>

			<div className="card p-5 mb-4">
				<ProviderSettings />
			</div>

			<div className="card p-5">
				<h2 className="font-display font-semibold text-sm mb-3">
					⚙️ Setup & deployment guide
				</h2>
				<div className="text-xs text-ink2 space-y-3 leading-relaxed">
					<div>
						<p className="font-bold text-ink mb-1">1 · Backend (Supabase)</p>
						<p>
							This deployment is pre-connected to Supabase Postgres. Tables:{" "}
							<code className="font-mono">
								posts, comments, reactions, polls, poll_votes, reports,
								users_meta, chat_threads, chat_messages, activity_logs, settings
							</code>{" "}
							plus a public <code className="font-mono">voicebox-media</code>{" "}
							storage bucket. Environment variables (already set):{" "}
							<code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
							<code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>,{" "}
							<code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code>.
						</p>
					</div>
					<div>
						<p className="font-bold text-ink mb-1">2 · AI integration</p>
						<p>
							{defaultProvider ? (
								<>
									The default provider is{" "}
									<code className="font-mono bg-surface2 px-1 rounded">
										{defaultProvider.name}
									</code>{" "}
									with model <code className="font-mono">{defaultProvider.model}</code>.
									Keys are entered under AI providers above (or supplied as an
									env secret) and used <b>server-side only</b> — never shipped
									to the browser. Requests run through{" "}
									<code className="font-mono">/api/ai</code> with strict-JSON
									responses; without a working key a deterministic heuristic
									engine keeps all AI features functional.
								</>
							) : (
								<>
									No default AI provider is configured. Add one under AI
									providers above; requests run server-side only through{" "}
									<code className="font-mono">/api/ai</code> with strict-JSON
									responses. Until a key is present, a deterministic heuristic
									engine keeps all AI features functional.
								</>
							)}
						</p>
					</div>
					<div>
						<p className="font-bold text-ink mb-1">3 · Admin access</p>
						<p>
							Set the <code className="font-mono">ADMIN_SESSION_SECRET</code>{" "}
							environment variable to sign in with an env secret (recommended), or
							leave it unset and set a password above. Either way, sessions are
							database-backed, revocable, and expire after 60 minutes. Passwords are
							SHA-256 hashed in the browser before transmission and stored only as a
							hash in the <code className="font-mono">settings</code> table.
						</p>
					</div>
					<div>
						<p className="font-bold text-ink mb-1">4 · Privacy guarantees</p>
						<p>{INFRASTRUCTURE_COPY}</p>
					</div>
				</div>
			</div>
		</div>
	);
}
