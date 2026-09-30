import { AlertTriangle, Flag, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* ---------- Modal ---------- */
export function Modal({
	open,
	onClose,
	title,
	children,
	maxWidth = "max-w-md",
	footer,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
	maxWidth?: string;
	/** Pinned action bar — always visible, even when the body scrolls (mobile). */
	footer?: ReactNode;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", h);
		document.body.style.overflow = "hidden";
		return () => {
			window.removeEventListener("keydown", h);
			document.body.style.overflow = "";
		};
	}, [open, onClose]);

	if (!open) return null;
	// Portal to <body>: callers render Modal deep inside cards/rows whose
	// overflow, transforms, or filters would otherwise clip the fixed dialog
	// and trap it under siblings (report dialog painting inside the post).
	return createPortal(
		<div
			className="fixed inset-0 z-[70] grid place-items-end sm:place-items-center p-0 sm:p-4 overflow-y-auto"
			role="dialog"
			aria-modal="true"
			aria-label={title}
		>
			<div
				className="absolute inset-0"
				style={{ background: "rgba(0,0,0,0.5)" }}
				onClick={onClose}
				aria-hidden
			/>
			<div
				ref={ref}
				className={`relative w-full ${maxWidth} card !rounded-b-none sm:!rounded-2xl shadow-2xl vb-rise max-h-[92dvh] flex flex-col overflow-hidden`}
			>
				<div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
					<h2 className="font-display font-semibold text-base">{title}</h2>
					<button
						className="btn btn-ghost !p-1.5"
						onClick={onClose}
						aria-label="Close dialog"
					>
						<X size={16} />
					</button>
				</div>
				<div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5">
					{children}
				</div>
				{footer && (
					<div className="shrink-0 border-t border-border px-5 py-3.5 bg-surface pb-[max(env(safe-area-inset-bottom),0.875rem)]">
						{footer}
					</div>
				)}
			</div>
		</div>,
		document.body,
	);
}

/* ---------- Confirm dialog ---------- */
export function ConfirmDialog({
	open,
	onClose,
	onConfirm,
	title,
	message,
	confirmLabel = "Confirm",
	danger = false,
}: {
	open: boolean;
	onClose: () => void;
	onConfirm: () => void | Promise<void>;
	title: string;
	message: string;
	confirmLabel?: string;
	danger?: boolean;
}) {
	const [busy, setBusy] = useState(false);

	/* Async handlers (e.g. bulk deletes) get real busy feedback: the confirm
	 * button disables and shows progress while the action runs, and the dialog
	 * only closes on success — a failure leaves the dialog open so the admin
	 * can retry. Sync handlers keep the old fire-and-close behavior. A busy
	 * guard also stops a double-click from firing the action twice. */
	const handleConfirm = async () => {
		if (busy) return;
		const result = onConfirm();
		if (result instanceof Promise) {
			setBusy(true);
			try {
				await result;
				onClose();
			} finally {
				setBusy(false);
			}
		} else {
			onClose();
		}
	};

	return (
		<Modal
			open={open}
			onClose={onClose}
			title={title}
			footer={
				<div className="flex gap-2 justify-end">
					<button className="btn btn-ghost" onClick={onClose} disabled={busy}>
						Cancel
					</button>
					<button
						className={`btn ${danger ? "btn-danger !bg-bad !text-white" : "btn-primary"}`}
						onClick={handleConfirm}
						disabled={busy}
						autoFocus
					>
						{busy ? "Working…" : confirmLabel}
					</button>
				</div>
			}
		>
			<p className="text-sm text-ink2 leading-relaxed flex gap-2.5">
				{danger && (
					<AlertTriangle size={18} className="text-bad shrink-0 mt-0.5" />
				)}
				{message}
			</p>
		</Modal>
	);
}

/* ---------- Report dialog ---------- */
const REPORT_REASONS = [
	"Bullying or harassment",
	"Spam or advertising",
	"False or misleading",
	"Inappropriate content",
	"Duplicate post",
	"Other",
];	export function ReportDialog({
	open,
	onClose,
	onSubmit,
}: {
	open: boolean;
	onClose: () => void;
	onSubmit: (reason: string) => void;
}) {
	const defaultReason = REPORT_REASONS[0] ?? "Other";
	const [reason, setReason] = useState(defaultReason);
	const [detail, setDetail] = useState("");
	const submit = () => {
		onSubmit(detail.trim() ? `${reason}: ${detail.trim()}` : reason);
		setDetail("");
		setReason(REPORT_REASONS[0] ?? "Other");
		onClose();
	};
	return (
		<Modal
			open={open}
			onClose={onClose}
			title="Report content"
			footer={
				<div className="flex gap-2 justify-end">
					<button className="btn btn-ghost" onClick={onClose}>
						Cancel
					</button>
					<button className="btn btn-primary" onClick={submit}>
						<Flag size={14} /> Submit report
					</button>
				</div>
			}
		>
			<div
				className="space-y-1.5 mb-3"
				role="radiogroup"
				aria-label="Report reason"
			>
				{REPORT_REASONS.map((r) => (
					<button
						key={r}
						role="radio"
						aria-checked={reason === r}
						onClick={() => setReason(r)}
						className={`w-full text-left text-sm px-3.5 py-2.5 rounded-xl border transition-all ${reason === r ? "border-accent bg-accent-soft text-accent font-semibold" : "border-border hover:border-accent/50"}`}
					>
						{r}
					</button>
				))}
			</div>
			<textarea
				className="input min-h-16 text-sm"
				placeholder="Additional details (optional)"
				value={detail}
				onChange={(e) => setDetail(e.target.value)}
				maxLength={250}
			/>
			<p className="text-[11px] text-ink3 mt-3">
				Reports are anonymous and reviewed by moderators.
			</p>
		</Modal>
	);
}

/* ---------- Status change dialog: pick message template + custom note ---------- */
const STATUS_TEMPLATES: Record<string, string[]> = {
	verified: [
		"We have verified this issue and it is now in our queue.",
		"Confirmed — our team has checked and this is a real issue.",
	],
	in_progress: [
		"We are working on it right now. 🔧",
		"Our team has started fixing this — updates coming soon.",
	],
	waiting: [
		"We are waiting on an external approval / parts / vendor before we can continue.",
		"Temporarily on hold — waiting for budget approval.",
	],
	solved: [
		"This has been fixed! Please let us know if it happens again. ✅",
		"Resolved — thank you for reporting it.",
	],
	archived: ["This report has been archived. Re-submit if the issue returns."],
	reported: ["Moved back to the review queue."],
};

export function StatusDialog({
	open,
	onClose,
	onSubmit,
	status,
	statusLabel,
}: {
	open: boolean;
	onClose: () => void;
	onSubmit: (note: string) => void;
	status: string;
	statusLabel: string;
}) {
	const [note, setNote] = useState("");
	useEffect(() => {
		if (open) setNote(STATUS_TEMPLATES[status]?.[0] || "");
	}, [open, status]);
	const templates = STATUS_TEMPLATES[status] || [];
	return (
		<Modal
			open={open}
			onClose={onClose}
			title={`Update status → ${statusLabel}`}
			footer={
				<div className="flex gap-2 justify-end">
					<button className="btn btn-ghost" onClick={onClose}>
						Cancel
					</button>
					<button
						className="btn btn-ghost !text-xs"
						onClick={() => {
							onSubmit("");
							onClose();
						}}
					>
						Skip message
					</button>
					<button
						className="btn btn-primary"
						onClick={() => {
							onSubmit(note.trim());
							onClose();
						}}
					>
						Update & notify
					</button>
				</div>
			}
		>
			<p className="text-xs text-ink3 mb-2">
				This message is shown publicly on the post's timeline so students know
				what's happening.
			</p>
			{templates.length > 0 && (
				<div className="flex flex-wrap gap-1.5 mb-2">
					{templates.map((t) => (
						<button
							key={t}
							onClick={() => setNote(t)}
							className={`text-[11px] px-2.5 py-1.5 rounded-lg border text-left transition-all ${note === t ? "border-accent bg-accent-soft text-accent font-semibold" : "border-border text-ink2 hover:border-accent/50"}`}
						>
							{t.slice(0, 52)}
							{t.length > 52 ? "…" : ""}
						</button>
					))}
				</div>
			)}
			<textarea
				className="input min-h-20 text-sm"
				placeholder="Public message to students (optional but recommended)…"
				value={note}
				onChange={(e) => setNote(e.target.value)}
				maxLength={300}
				autoFocus
			/>
		</Modal>
	);
}

/* ---------- Prompt dialog (replaces window.prompt) ---------- */
export function PromptDialog({
	open,
	onClose,
	onSubmit,
	title,
	label,
	placeholder = "",
	defaultValue = "",
	multiline = false,
	submitLabel = "Save",
	optional = false,
}: {
	open: boolean;
	onClose: () => void;
	onSubmit: (value: string) => void;
	title: string;
	label?: string;
	placeholder?: string;
	defaultValue?: string;
	multiline?: boolean;
	submitLabel?: string;
	optional?: boolean;
}) {
	const [value, setValue] = useState(defaultValue);
	useEffect(() => {
		if (open) setValue(defaultValue);
	}, [open, defaultValue]);
	const submit = () => {
		onSubmit(value.trim());
		onClose();
	};
	return (
		<Modal
			open={open}
			onClose={onClose}
			title={title}
			footer={
				<div className="flex gap-2 justify-end">
					<button className="btn btn-ghost" onClick={onClose}>
						Cancel
					</button>
					<button
						className="btn btn-primary"
						onClick={submit}
						disabled={!optional && !value.trim()}
					>
						{submitLabel}
					</button>
				</div>
			}
		>
			{label && (
				<label className="text-xs font-semibold text-ink2 block mb-1.5">
					{label}
				</label>
			)}
			{multiline ? (
				<textarea
					className="input min-h-20 text-sm"
					placeholder={placeholder}
					value={value}
					onChange={(e) => setValue(e.target.value)}
					autoFocus
				/>
			) : (
				<input
					className="input text-sm"
					placeholder={placeholder}
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) =>
						e.key === "Enter" && (optional || value.trim()) && submit()
					}
					autoFocus
				/>
			)}
		</Modal>
	);
}

/* ---------- Segmented control ---------- */
export function Segmented<T extends string>({
	value,
	onChange,
	options,
}: {
	value: T;
	onChange: (v: T) => void;
	options: { value: T; label: string }[];
}) {
	return (
		<div
			className="inline-flex rounded-xl bg-surface2 p-1 gap-0.5"
			role="tablist"
		>
			{options.map((o) => (
				<button
					key={o.value}
					role="tab"
					aria-selected={value === o.value}
					onClick={() => onChange(o.value)}
					className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${value === o.value ? "bg-surface shadow-sm text-ink" : "text-ink3 hover:text-ink2"}`}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}
