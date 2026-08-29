/**
 * Premium reusable UI primitives — shared across user and admin surfaces.
 * All components follow the Voice Box design tokens and respond to dark mode.
 */
import {
	Bell,
	Search,
	type LucideIcon,
} from "lucide-react";
import { type ReactNode, useRef, useState, useEffect, useId } from "react";

// ─── EmptyState ──────────────────────────────────────

export function EmptyState({
	icon: Icon = Bell,
	title,
	description,
	action,
}: {
	icon?: LucideIcon;
	title: string;
	description?: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center py-12 px-4 text-center">
			<div className="w-12 h-12 rounded-2xl bg-surface2 grid place-items-center mb-4">
				<Icon size={22} className="text-ink3" aria-hidden />
			</div>
			<p className="font-display font-semibold text-sm text-ink">{title}</p>
			{description && (
				<p className="text-xs text-ink3 mt-1 max-w-xs leading-relaxed">
					{description}
				</p>
			)}
			{action && <div className="mt-4">{action}</div>}
		</div>
	);
}

// ─── StatusBadge ─────────────────────────────────────

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "neutral";

const BADGE_STYLES: Record<BadgeVariant, string> = {
	default: "bg-surface2 text-ink2 border-border",
	success: "bg-good/10 text-good border-good/25",
	warning: "bg-warn/10 text-warn border-warn/30",
	danger: "bg-bad/10 text-bad border-bad/25",
	info: "bg-accent-soft text-accent border-accent/20",
	neutral: "bg-surface3 text-ink3 border-border",
};

export function StatusBadge({
	variant = "default",
	children,
	dot,
	className = "",
}: {
	variant?: BadgeVariant;
	children: ReactNode;
	dot?: boolean;
	className?: string;
}) {
	return (
		<span
			className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold rounded-full border ${BADGE_STYLES[variant]} ${className}`}
			role="status"
		>
			{dot && (
				<span
					className={`w-1.5 h-1.5 rounded-full ${
						variant === "success"
							? "bg-good"
							: variant === "warning"
								? "bg-warn"
								: variant === "danger"
									? "bg-bad"
									: variant === "info"
										? "bg-accent"
										: "bg-ink3"
					}`}
					aria-hidden
				/>
			)}
			{children}
		</span>
	);
}

// ─── SkeletonGroup ───────────────────────────────────

export function SkeletonGroup({
	lines = 3,
	className = "",
}: {
	lines?: number;
	className?: string;
}) {
	return (
		<div className={`space-y-2.5 ${className}`} role="status" aria-label="Loading">
			<span className="sr-only">Loading…</span>
			{Array.from({ length: lines }).map((_, i) => (
				<div
					key={i}
					className="skeleton h-3.5 rounded-lg"
					style={{
						width: `${60 + Math.sin(i * 2.1) * 25}%`,
						animationDelay: `${i * 0.08}s`,
					}}
				/>
			))}
		</div>
	);
}

// ─── SearchInput ─────────────────────────────────────

export function SearchInput({
	value,
	onChange,
	placeholder = "Search…",
	onClear,
	autoFocus,
	className = "",
	id: externalId,
	debounceMs = 0,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	onClear?: () => void;
	autoFocus?: boolean;
	className?: string;
	id?: string;
	debounceMs?: number;
}) {
	const autoId = useId();
	const id = externalId || autoId;
	const [local, setLocal] = useState(value);
	const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	// Sync from parent
	useEffect(() => {
		setLocal(value);
	}, [value]);

	const handleChange = (v: string) => {
		setLocal(v);
		if (debounceMs > 0) {
			clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => onChange(v), debounceMs);
		} else {
			onChange(v);
		}
	};

	useEffect(() => {
		return () => clearTimeout(timerRef.current);
	}, []);

	return (
		<div className={`relative ${className}`}>
			<Search
				size={14}
				className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3 pointer-events-none"
				aria-hidden
			/>
			<input
				id={id}
				type="search"
				value={local}
				onChange={(e) => handleChange(e.target.value)}
				placeholder={placeholder}
				autoFocus={autoFocus}
				className="input !pl-9 !pr-9 !py-2 !text-sm !rounded-xl w-full"
				aria-label={placeholder}
			/>
			{local && (
				<button
					onClick={() => {
						setLocal("");
						onChange("");
						onClear?.();
					}}
					className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-surface2 text-ink3 hover:text-ink transition-colors"
					aria-label="Clear search"
				>
					<span className="text-xs">✕</span>
				</button>
			)}
		</div>
	);
}

// ─── MetricTile ──────────────────────────────────────

export function MetricTile({
	label,
	value,
	icon: Icon,
	trend,
	tone,
	className = "",
}: {
	label: string;
	value: string | number;
	icon?: LucideIcon;
	trend?: { value: string; positive: boolean };
	tone?: "good" | "warn" | "bad" | "accent";
	className?: string;
}) {
	const toneColor = tone
		? tone === "good"
			? "text-good"
			: tone === "warn"
				? "text-warn"
				: tone === "bad"
					? "text-bad"
					: "text-accent"
		: "";

	return (
		<div
			className={`bg-surface2 rounded-xl p-3 flex flex-col gap-1 ${className}`}
		>
			<div className="flex items-center justify-between">
				<span className="text-[10px] font-bold uppercase tracking-wider text-ink3">
					{label}
				</span>
				{Icon && <Icon size={13} className="text-ink3" aria-hidden />}
			</div>
			<p className={`font-display font-bold text-lg leading-tight ${toneColor}`}>
				{value}
			</p>
			{trend && (
				<span
					className={`text-[10px] font-medium ${
						trend.positive ? "text-good" : "text-bad"
					}`}
				>
					{trend.positive ? "↑" : "↓"} {trend.value}
				</span>
			)}
		</div>
	);
}

// ─── Tabs ────────────────────────────────────────────

export function SegmentedTabs({
	options,
	value,
	onChange,
	className = "",
}: {
	options: { key: string; label: string; icon?: LucideIcon }[];
	value: string;
	onChange: (key: string) => void;
	className?: string;
}) {
	return (
		<div
			className={`inline-flex bg-surface2 rounded-xl p-0.5 gap-0.5 ${className}`}
			role="tablist"
		>
			{options.map((opt) => {
				const active = opt.key === value;
				return (
					<button
						key={opt.key}
						role="tab"
						aria-selected={active}
						onClick={() => onChange(opt.key)}
						className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
							active
								? "bg-surface text-ink shadow-sm"
								: "text-ink3 hover:text-ink2"
						}`}
					>
						{opt.icon && <opt.icon size={13} aria-hidden />}
						{opt.label}
					</button>
				);
			})}
		</div>
	);
}
