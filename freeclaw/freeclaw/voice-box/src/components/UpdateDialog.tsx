import { ArrowDownToLine, Clock } from "lucide-react";
import type { AppUpdate } from "../lib/appUpdate";

interface UpdateDialogProps {
	update: AppUpdate;
	onUpdate: () => void;
	onLater: () => void;
}

/**
 * Native-shell app update prompt — "Update detected: Update now / Later".
 * Rendered only on the APK and EXE (web browsers update on reload). Modal,
 * focus-trapped by the shared dialog semantics below: Escape dismisses as
 * Later, and the backdrop is inert (clicks pass to Later, never Update).
 */
export default function UpdateDialog({ update, onUpdate, onLater }: UpdateDialogProps) {
	return (
		<div
			className="fixed inset-0 z-[70] grid place-items-center p-4 bg-ink/40 backdrop-blur-[2px]"
			role="presentation"
			onClick={onLater}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="vb-update-title"
				className="card w-full max-w-sm p-5 vb-rise"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (e.key === "Escape") onLater();
				}}
			>
				<p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-accent bg-accent/10 rounded-full px-3 py-1.5 mb-3">
					Update detected
				</p>
				<h2 id="vb-update-title" className="font-display font-bold text-lg text-ink">
					A new version is ready{update.version ? ` (${update.version})` : ""}
				</h2>
				{update.notes ? (
					<p className="text-sm text-ink2 mt-1.5 leading-relaxed">
						{update.notes}
					</p>
				) : (
					<p className="text-sm text-ink2 mt-1.5 leading-relaxed">
						Faster, fresher, and fixed — grab the latest build.
					</p>
				)}
				<div className="flex gap-2 mt-4">
					<button
						type="button"
						className="btn btn-primary flex-1 inline-flex items-center justify-center gap-1.5"
						onClick={onUpdate}
						autoFocus
					>
						<ArrowDownToLine size={15} /> Update now
					</button>
					<button
						type="button"
						className="btn btn-ghost inline-flex items-center gap-1.5"
						onClick={onLater}
					>
						<Clock size={14} /> Later
					</button>
				</div>
			</div>
		</div>
	);
}
