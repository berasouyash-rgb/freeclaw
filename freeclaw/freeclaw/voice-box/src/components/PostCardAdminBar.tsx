import {
	CheckCircle2,
	EyeOff,
	Play,
	Send,
	ShieldCheck,
	Sparkles,
} from "lucide-react";
import { memo, useCallback, useState } from "react";
import { useApp } from "../contexts/AppContext";
import { api } from "../lib/api";
import type { PostData } from "../types";
import { ConfirmDialog } from "./ui";

interface PostCardAdminBarProps {
	post: PostData;
	onStatusChange?: (id: string, status: string) => void;
}

function PostCardAdminBarInner({ post, onStatusChange }: PostCardAdminBarProps) {
	const { toast } = useApp();
	const [busy, setBusy] = useState<string | null>(null);
	const [replyOpen, setReplyOpen] = useState(false);
	const [replyText, setReplyText] = useState("");
	const [confirmAction, setConfirmAction] = useState<{
		label: string;
		description: string;
		fn: () => void;
		danger?: boolean;
	} | null>(null);

	const adminSet = useCallback(
		async (patch: { status?: string; official?: boolean; hidden?: boolean }) => {
			if (busy) return;
			setBusy("admin");
			try {
				await api.put("/api/posts", { id: post.id, ...patch });
				if (patch.status === "solved")
					toast("Issue marked solved — community notified", "ok");
				else if (patch.status === "in_progress")
					toast("Marked in progress", "ok");
				else if (patch.status === "verified")
					toast("Marked verified", "ok");
				else if (patch.official !== undefined)
					toast(patch.official ? "Marked official" : "Removed official", "ok");
				else if (patch.hidden !== undefined)
					toast(patch.hidden ? "Post hidden" : "Post unhidden", "ok");
				if (patch.status && onStatusChange) onStatusChange(post.id, patch.status);
			} catch (e: unknown) {
				toast(e instanceof Error ? e.message : "Action failed", "err");
			} finally {
				setBusy(null);
			}
		},
		[busy, post.id, toast, onStatusChange],
	);

	const sendReply = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			const text = replyText.trim();
			if (!text || busy) return;
			setBusy("reply");
			try {
				await api.put("/api/posts", { id: post.id, admin_reply: text });
				setReplyText("");
				setReplyOpen(false);
				toast("Official reply posted — visible on the post", "ok");
			} catch (err: unknown) {
				toast(err instanceof Error ? err.message : "Failed to post reply", "err");
			} finally {
				setBusy(null);
			}
		},
		[busy, post.id, replyText, toast],
	);

	return (
		<div className="border-t border-border bg-surface2/40">
			{post.status === "pending_review" && (
				<div className="flex items-center gap-1.5 px-3 pt-2.5 pb-0 text-[11px] font-semibold text-warn">
					🔒 Held for review — possible PII or quality issue detected by AI moderation
				</div>
			)}
			<div className="flex items-center gap-1.5 px-3 pt-2.5 pb-2 flex-wrap">
				<span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-accent mr-1">
					<ShieldCheck size={13} aria-hidden /> Moderation
				</span>
				{post.status !== "solved" && post.status !== "archived" && (
					<>
						{post.status !== "in_progress" && (
							<button
								type="button"
								disabled={!!busy}
								onClick={() => adminSet({ status: "in_progress" })}
								title="Mark in progress"
								className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-warn bg-warn/10 border border-warn/25 transition-colors disabled:opacity-40"
							>
								<Play size={13} /> In progress
							</button>
						)}
						{post.status !== "verified" && (
							<button
								type="button"
								disabled={!!busy}
								onClick={() => adminSet({ status: "verified" })}
								title="Verify this post"
								className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-blue-400 bg-blue-500/10 border border-blue-500/25 transition-colors disabled:opacity-40"
							>
								<ShieldCheck size={13} /> Verify
							</button>
						)}
						<button
							type="button"
							disabled={!!busy}
							onClick={() =>
								setConfirmAction({
									label: "Solve this issue?",
									description:
										"This will mark the issue as solved and notify the community.",
									fn: () => adminSet({ status: "solved" }),
								})
							}
							title="Mark solved"
							className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold text-good bg-good/15 border border-good/30 transition-colors disabled:opacity-40"
						>
							<CheckCircle2 size={14} /> Solve
						</button>
					</>
				)}
				<button
					type="button"
					disabled={!!busy}
					onClick={() => adminSet({ official: !post.official })}
					title={post.official ? "Remove official badge" : "Mark as official"}
					className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${
						post.official
							? "text-amber-400 bg-amber-500/15 border border-amber-500/30"
							: "text-amber-400 bg-amber-500/5 border border-amber-500/20"
					}`}
				>
					<Sparkles size={13} />
					{post.official ? "Official" : "Mark official"}
				</button>
				<button
					type="button"
					disabled={!!busy}
					onClick={() =>
						setConfirmAction({
							label: post.hidden ? "Unhide this post?" : "Hide this post?",
							description: post.hidden
								? "This will make the post visible to all users again."
								: "This will hide the post from all non-admin users.",
							fn: () => adminSet({ hidden: !post.hidden }),
							danger: !post.hidden,
						})
					}
					title={post.hidden ? "Unhide post" : "Hide post"}
					className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${
						post.hidden
							? "text-red-400 bg-red-500/15 border border-red-500/30"
							: "text-red-400 bg-red-500/5 border border-red-500/20"
					}`}
				>
					<EyeOff size={13} /> {post.hidden ? "Unhide" : "Hide"}
				</button>
				<button
					type="button"
					onClick={() => setReplyOpen((o) => !o)}
					title="Post an official admin reply on this post"
					className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-accent bg-accent/10 border border-accent/25 transition-colors"
				>
					<Send size={13} /> {replyOpen ? "Close" : "Official reply"}
				</button>
			</div>
			{replyOpen && (
				<form onSubmit={sendReply} className="flex items-center gap-1.5 px-3 pb-2.5">
					<input
						autoFocus
						value={replyText}
						onChange={(e) => setReplyText(e.target.value)}
						placeholder="Write an official message for everyone viewing this post…"
						className="input !py-2 !text-sm flex-1"
						maxLength={1000}
						aria-label="Official admin reply"
					/>
					<button
						type="submit"
						disabled={busy === "reply" || !replyText.trim()}
						className="btn btn-primary !py-2 !px-4 !text-xs"
					>
						{busy === "reply" ? "Sending…" : "Send"}
					</button>
				</form>
			)}
			{confirmAction && (
				<ConfirmDialog
					open
					onClose={() => setConfirmAction(null)}
					onConfirm={() => {
						confirmAction.fn();
						setConfirmAction(null);
					}}
					title={confirmAction.label}
					message={confirmAction.description}
					confirmLabel={confirmAction.label.split("?")[0]}
					danger={confirmAction.danger}
				/>
			)}
		</div>
	);
}

export const PostCardAdminBar = memo(PostCardAdminBarInner);
export default PostCardAdminBar;
