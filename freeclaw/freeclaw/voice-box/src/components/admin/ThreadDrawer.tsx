import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/utils";
import { Modal } from "../ui";

interface DrawerMessage {
	id?: string;
	sender?: string;
	body?: string;
	created_at?: string;
}

/**
 * Dashboard thread drawer — opens an inbox chat directly on the
 * dashboard, without navigating to the inbox page. Read-only: replying
 * stays in the full inbox (deep-link preserved via onOpenInbox).
 */
export default function ThreadDrawer({
	threadId,
	onClose,
	onOpenInbox,
}: {
	threadId: string | null;
	onClose: () => void;
	onOpenInbox: (threadId: string) => void;
}) {
	const [messages, setMessages] = useState<DrawerMessage[] | null>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		if (!threadId) return;
		let on = true;
		setMessages(null);
		setError("");
		api
			.get<{ messages?: DrawerMessage[] }>(
				`/api/inbox?thread_id=${encodeURIComponent(threadId)}`,
			)
			.then((r) => {
				if (on) setMessages(Array.isArray(r?.messages) ? r.messages : []);
			})
			.catch((e: unknown) => {
				if (on)
					setError(e instanceof Error ? e.message : "Failed to load conversation");
			});
		return () => {
			on = false;
		};
	}, [threadId]);

	return (
		<Modal
			open={threadId !== null}
			onClose={onClose}
			title={threadId ? `Chat ${threadId.slice(0, 8)}` : "Chat"}
			maxWidth="max-w-2xl"
			footer={
				threadId ? (
					<div className="flex gap-2 justify-end">
						<button className="btn btn-ghost" onClick={onClose}>
							Close
						</button>
						<button
							className="btn btn-primary"
							onClick={() => onOpenInbox(threadId)}
							aria-label={`Reply in inbox to ${threadId}`}
						>
							Reply in inbox
						</button>
					</div>
				) : undefined
			}
		>
			{error ? (
				<div className="py-8 text-center">
					<p className="text-sm text-bad" role="alert">
						{error}
					</p>
					<button
						className="btn btn-soft mt-3"
						onClick={() => {
							setError("");
							setMessages(null);
							if (!threadId) return;
							api
								.get<{ messages?: DrawerMessage[] }>(
									`/api/inbox?thread_id=${encodeURIComponent(threadId)}`,
								)
								.then((r) => setMessages(Array.isArray(r?.messages) ? r.messages : []))
								.catch((e: unknown) =>
									setError(e instanceof Error ? e.message : "Failed to load conversation"),
								);
						}}
					>
						Retry
					</button>
				</div>
			) : messages === null ? (
				<div className="space-y-2 py-2" role="status" aria-label="Loading conversation">
					{[1, 2, 3].map((i) => (
						<div key={i} className="skeleton h-12 rounded-xl" />
					))}
				</div>
			) : messages.length === 0 ? (
				<p className="text-sm text-ink3 py-8 text-center">No messages yet.</p>
			) : (
				<ul className="space-y-2.5 py-2">
					{messages.map((m, i) => (
						<li
							key={m.id ?? i}
							className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
								m.sender === "user"
									? "bg-surface2 text-ink"
									: "bg-accent-soft text-ink ml-auto"
							}`}
						>
							<span className="block text-[10px] font-semibold text-ink3 mb-0.5">
								{m.sender === "user" ? "Student" : m.sender === "ai" ? "AI" : "Admin"}
								{m.created_at ? ` · ${timeAgo(m.created_at)}` : ""}
							</span>
							<span className="whitespace-pre-wrap break-words">
								{m.body || "(attachment)"}
							</span>
						</li>
					))}
				</ul>
			)}
		</Modal>
	);
}
