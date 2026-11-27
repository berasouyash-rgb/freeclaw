// DraftProposal — the accept/reject popup for AI-drafted posts inside the
// admin AI-inbox thread view.
//
// Shows when the thread carries an open proposal: the draft title,
// description, category, a Private toggle (default from the draft), and the
// student's own words it was drawn from. Accept creates the post through
// the real safety gate (server-side); Reject drops the proposal. Nothing
// publishes from this card without the admin click.
import { useState } from "react";
import { timeAgo } from "../../lib/utils";
import { Check, Lock, Globe, X } from "lucide-react";

export interface DraftProposalData {
	title: string;
	description: string;
	category: string;
	private: boolean;
	status: string;
	trigger?: string;
	at?: string;
}

export default function DraftProposal({
	proposal,
	excerpt,
	busy,
	onAccept,
	onReject,
}: {
	proposal: DraftProposalData;
	excerpt: string[];
	busy: boolean;
	onAccept: (visibility: "private" | "public") => void;
	onReject: () => void;
}) {
	const [isPrivate, setIsPrivate] = useState(proposal.private !== false);
	return (
		<div
			className="card border-accent/30 p-4 mb-3"
			data-testid="draft-proposal"
			role="dialog"
			aria-label="Proposed post"
		>
			<div className="flex items-center justify-between gap-2 mb-2">
				<p className="text-[10px] font-bold uppercase tracking-wider text-accent">
					Proposed post — needs your decision
				</p>
				{proposal.at && (
			<span className="chip !text-[10px]" title={proposal.at}>
				proposed {timeAgo(proposal.at)}
			</span>
		)}
		{proposal.trigger && (
					<span className="chip !text-[10px]" title={`Proposed ${proposal.trigger === "admin" ? "by you" : "from the student's request"}`}>
						{proposal.trigger === "admin" ? "Manual draft" : "Student request"}
					</span>
				)}
			</div>
			<p className="font-semibold text-sm leading-snug">{proposal.title}</p>
			<div className="flex items-center gap-1.5 mt-1.5">
				<span className="chip !text-[10px]">{proposal.category}</span>
			</div>
			<p className="text-xs text-ink2 leading-relaxed mt-2">{proposal.description}</p>
			{excerpt.length > 0 && (
				<div className="mt-2 rounded-lg bg-surface2 px-2.5 py-2">
					<p className="text-[10px] font-bold text-ink3 uppercase tracking-wider mb-1">
						Student's words
					</p>
					{excerpt.slice(-2).map((line, i) => (
						<p key={i} className="text-[11px] text-ink2 leading-snug line-clamp-2">
							“{line}”
						</p>
					))}
				</div>
			)}
			<button
				type="button"
				role="switch"
				aria-checked={isPrivate}
				aria-label="Private post"
				onClick={() => setIsPrivate((v) => !v)}
				className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-bold border-border text-ink2"
			>
				{isPrivate ? <Lock size={12} /> : <Globe size={12} />}
				{isPrivate ? "Private — author + admins only" : "Public — goes through review"}
			</button>
			<div className="flex gap-2 mt-3">
				<button
					type="button"
					disabled={busy}
					onClick={() => onAccept(isPrivate ? "private" : "public")}
					className="btn btn-primary !text-xs flex-1"
				>
					<Check size={13} /> Accept post
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={onReject}
					className="btn btn-ghost !text-xs"
				>
					<X size={13} /> Reject
				</button>
			</div>
		</div>
	);
}
