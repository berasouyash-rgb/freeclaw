import { Keyboard, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface KeyboardShortcutsModalProps {
	open: boolean;
	onClose: () => void;
}

const SHORTCUT_GROUPS = [
	{
		title: "Navigation & Search",
		shortcuts: [
			{ keys: ["⌘", "K"], desc: "Open Command Palette" },
			{ keys: ["/"], desc: "Focus Search" },
			{ keys: ["j"], desc: "Next post in feed" },
			{ keys: ["k"], desc: "Previous post in feed" },
			{ keys: ["Enter"], desc: "Open focused post" },
			{ keys: ["t"], desc: "Scroll to top" },
		],
	},
	{
		title: "Post Actions",
		shortcuts: [
			{ keys: ["u"], desc: "Support / Upvote post" },
			{ keys: ["b"], desc: "Bookmark post" },
			{ keys: ["c"], desc: "Jump to comments" },
			{ keys: ["n"], desc: "Create new post" },
			{ keys: ["s"], desc: "Copy share link" },
		],
	},
	{
		title: "Platform & Controls",
		shortcuts: [
			{ keys: ["?"], desc: "Open this shortcuts guide" },
			{ keys: ["Esc"], desc: "Close dialogs and sheets" },
		],
	},
];

export default function KeyboardShortcutsModal({
	open,
	onClose,
}: KeyboardShortcutsModalProps) {
	const dialogRef = useRef<HTMLDivElement>(null);
	useFocusTrap(dialogRef, open);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
			role="dialog"
			aria-modal="true"
			aria-label="Keyboard Shortcuts"
		>
			<div
				ref={dialogRef}
				className="w-full max-w-lg rounded-2xl bg-surface border border-border shadow-2xl p-6 relative vb-rise max-h-[85vh] overflow-y-auto"
			>
				<div className="flex items-center justify-between pb-4 border-b border-border mb-5">
					<div className="flex items-center gap-2.5">
						<span className="p-2 rounded-xl bg-accent/10 text-accent">
							<Keyboard size={18} />
						</span>
						<div>
							<h2 className="text-base font-bold text-ink">Keyboard Shortcuts</h2>
							<p className="text-xs text-ink3">Navigate VoiceFlow at lightspeed</p>
						</div>
					</div>
					<button
						onClick={onClose}
						className="p-1.5 rounded-lg text-ink3 hover:text-ink hover:bg-surface2 transition-colors"
						aria-label="Close keyboard shortcuts"
					>
						<X size={16} />
					</button>
				</div>

				<div className="space-y-5">
					{SHORTCUT_GROUPS.map((group) => (
						<div key={group.title}>
							<h3 className="text-xs font-bold uppercase tracking-wider text-ink3 mb-2.5">
								{group.title}
							</h3>
							<div className="space-y-1.5">
								{group.shortcuts.map((sc) => (
									<div
										key={sc.desc}
										className="flex items-center justify-between py-1.5 px-2.5 rounded-lg hover:bg-surface2/60 transition-colors text-xs"
									>
										<span className="text-ink2 font-medium">{sc.desc}</span>
										<div className="flex items-center gap-1">
											{sc.keys.map((k) => (
												<kbd
													key={k}
													className="px-2 py-0.5 rounded bg-surface3 border border-border text-[11px] font-mono font-semibold text-ink shadow-2xs"
												>
													{k}
												</kbd>
											))}
										</div>
									</div>
								))}
							</div>
						</div>
					))}
				</div>

				<div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-[11px] text-ink3">
					<span>Tip: Press <kbd className="px-1.5 py-0.5 rounded bg-surface2 font-mono">?</kbd> anywhere to open</span>
					<button
						onClick={onClose}
						className="btn btn-soft !py-1 !px-3 text-xs"
					>
						Got it
					</button>
				</div>
			</div>
		</div>
	);
}
