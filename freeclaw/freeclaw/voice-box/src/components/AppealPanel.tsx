// AppealPanel — recourse entry point shown when safety blocks a write.
// Shared by Submit (posts/polls) and comment surfaces: captures the blocked
// text + an optional reason, files POST /api/appeals, and confirms with a
// link to track it under My activity. Filing never publishes anything.
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { maskContactPreview } from "../lib/utils";
import { useApp } from "../contexts/AppContext";

export type AppealSurface = "post" | "comment" | "poll";

export interface AppealContext {
	post_id?: string;
	parent_id?: string;
	ptype?: string;
	options?: string[];
	category?: string;
}

interface Props {
	surface: AppealSurface;
	title: string;
	body: string;
	context?: AppealContext;
	onFiled?: (id: string) => void;
}

export default function AppealPanel({ surface, title, body, context, onFiled }: Props) {
	const { toast, anonId } = useApp() as { toast: (m: string, k?: string) => void; anonId: string };
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);
	const [filedId, setFiledId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	if (filedId) {
		return (
			<div role="status" data-testid="appeal-confirmation">
				<p>Appeal filed — a moderator will review it.</p>
				<Link to="/activity">Track it under My activity</Link>
			</div>
		);
	}

	const file = async () => {
		setBusy(true);
		setError(null);
		try {
			const r = await api.post<{ id: string; deduped?: boolean }>("/api/appeals", {
				surface,
				title,
				body,
				reason,
				author_id: anonId,
				...(context || {}),
			});
			setFiledId(r.id);
			onFiled?.(r.id);
			toast(r.deduped ? "You already have an open appeal for this — showing it." : "Appeal filed", "ok");
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : "Appeal failed";
			setError(msg);
			toast(msg, "err");
		}
		setBusy(false);
	};

	return (
		<div
			data-testid="appeal-panel"
			className="rounded-2xl border border-warn/30 bg-warn/5 p-4 sm:p-5 vb-rise"
			role="region"
			aria-label="Appeal a safety block"
		>
			<p className="flex items-center gap-2 text-sm font-bold text-ink">
				<span aria-hidden>🛡️</span> Blocked by safety check
			</p>
			<p className="mt-1 text-xs leading-relaxed text-ink3">
				If this is a mistake, appeal for human review — nothing publishes
				until approved.
			</p>
			<div className="mt-3 rounded-xl bg-surface border border-border p-3">
				<p className="text-[10px] font-bold uppercase tracking-wider text-ink3">
					Will send for review
				</p>
				<p
					data-testid="appeal-preview"
					className="mt-1 text-sm text-ink break-words"
				>
					“{maskContactPreview(title)}”
					{body.length > 0 && (
						<span className="text-ink3"> + body ({body.length} chars)</span>
					)}
				</p>
				<p className="mt-1 text-[11px] text-ink3">
					Moderators see the full text.
				</p>
			</div>
			<label className="mt-3 block">
				<span className="text-xs font-semibold text-ink2">
					Why should this be allowed? <span className="text-ink3">(optional)</span>
				</span>
				<textarea
					aria-label="Appeal reason"
					value={reason}
					onChange={(e) => setReason(e.target.value.slice(0, 500))}
					maxLength={500}
					rows={2}
					placeholder="e.g. This is my own neighbourhood name, not someone's address"
					className="input mt-1.5 resize-y text-sm"
				/>
			</label>
			{error && (
				<p role="alert" className="mt-2 text-xs font-semibold text-bad">{error}</p>
			)}
			<button
				type="button"
				onClick={file}
				disabled={busy}
				className="btn btn-primary w-full mt-3 disabled:opacity-50"
			>
				{busy ? "Filing…" : "Appeal this decision"}
			</button>
		</div>
	);
}
