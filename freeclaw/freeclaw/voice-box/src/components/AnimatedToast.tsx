/**
 * AnimatedToast — Premium slide-in toast notification with animated progress bar.
 * Uses the existing AppContext toast system with enhanced visuals.
 */

import { CheckCircle, Info, X, XCircle } from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../contexts/AppContext";

const ICONS = {
	ok: CheckCircle,
	err: XCircle,
	info: Info,
};

const COLORS = {
	ok: "border-good/30 bg-good/5",
	err: "border-bad/30 bg-bad/5",
	info: "border-accent/30 bg-accent/5",
};

const BAR_COLORS = {
	ok: "bg-good",
	err: "bg-bad",
	info: "bg-accent",
};

const ICON_COLORS = {
	ok: "text-good",
	err: "text-bad",
	info: "text-accent",
};

const AnimatedToast: FC = () => {
	const { toasts, toast: _t } = useApp();

	return (
		<div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2.5 pointer-events-none max-w-sm">
			{toasts.map((t, i) => (
				<ToastItem key={t.id} toast={t} index={i} />
			))}
			<style>{`
        @keyframes toast-slide-in {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes toast-slide-out {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0; transform: scale(0.96); }
        }
        @keyframes toast-shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
        .toast-enter { animation: toast-slide-in 0.18s ease-out both; }
        .toast-exit { animation: toast-slide-out 0.14s ease-in both; }
      `}</style>
		</div>
	);
};

function ToastItem({
	toast,
	index,
}: {
	toast: {
		id: number;
		text: string;
		kind: "ok" | "err" | "info";
		action?: { label: string; fn: () => void };
	};
	index: number;
}) {
	const [exiting, setExiting] = useState(false);
	const [removed, setRemoved] = useState(false);
	const Icon = ICONS[toast.kind] || Info;

	// Auto-dismiss after duration
	useEffect(() => {
		const duration = toast.action ? 30000 : 3800;
		const t = setTimeout(() => {
			setExiting(true);
			setTimeout(() => setRemoved(true), 200);
		}, duration);
		return () => clearTimeout(t);
	}, [toast.action]);

	const handleClose = useCallback(() => {
		setExiting(true);
		setTimeout(() => setRemoved(true), 200);
	}, []);

	if (removed) return null;

	return (
		<div
			className={`pointer-events-auto ${exiting ? "toast-exit" : "toast-enter"}`}
			style={{ animationDelay: `${index * 0.05}s` }}
		>
			<div
				className={`relative overflow-hidden rounded-2xl border ${COLORS[toast.kind]} bg-surface/95 backdrop-blur-md shadow-lg`}
			>
				<div className="flex items-start gap-3 px-4 py-3.5">
					<Icon
						size={16}
						className={`shrink-0 mt-0.5 ${ICON_COLORS[toast.kind]}`}
					/>
					<p className="text-sm text-ink leading-relaxed flex-1">
						{toast.text}
					</p>
					{toast.action && (
						<button
							onClick={() => {
								toast.action!.fn();
								handleClose();
							}}
							className="shrink-0 text-xs font-semibold text-accent hover:text-accent2 transition-colors"
						>
							{toast.action.label}
						</button>
					)}
					<button
						onClick={handleClose}
						className="shrink-0 p-0.5 rounded-md hover:bg-surface2 transition-colors"
					>
						<X size={14} className="text-ink3" />
					</button>
				</div>
				{/* Progress bar */}
				<div
					className={`h-0.5 ${BAR_COLORS[toast.kind]}`}
					style={{
						animation: `toast-shrink ${(toast.action ? 30000 : 3800) - 200}ms linear forwards`,
					}}
				/>
			</div>
		</div>
	);
}

export default AnimatedToast;
