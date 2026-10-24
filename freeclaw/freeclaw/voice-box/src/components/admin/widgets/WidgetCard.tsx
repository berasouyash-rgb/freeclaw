// ═══════════════════════════════════════════════════════════════════
// WIDGET CARD — the shell every dashboard widget renders inside
// ═══════════════════════════════════════════════════════════════════
// Owns the per-widget customisation surface: drag to reorder, resize in
// grid columns and height, opacity, accent, glass, duplicate and remove.
//
// The glass treatment is real backdrop blur over the card wash, not a
// gradient fake — `backdrop-filter` is what makes it read as glass when a
// widget overlaps the page background.
// ═══════════════════════════════════════════════════════════════════

import { useState } from "react";
import {
	ArrowDown,
	ArrowUp,
	ChevronDown,
	Copy,
	GripVertical,
	Maximize2,
	Minimize2,
	MoreVertical,
	RefreshCw,
	Trash2,
} from "lucide-react";
import {
	ACCENTS,
	type AccentKey,
	type WidgetDef,
	type WidgetInstance,
} from "../../../lib/dashboard/widgets";
import type { WidgetCtx } from "../../../lib/dashboard/widgets";

interface Props {
	inst: WidgetInstance;
	def: WidgetDef;
	ctx: WidgetCtx;
	index: number;
	dragging: boolean;
	onDragStart: (index: number) => void;
	onDragEnter: (index: number) => void;
	onDragEnd: () => void;
	onUpdate: (
		iid: string,
		patch: Partial<Omit<WidgetInstance, "iid" | "widgetId">>,
	) => void;
	onRemove: (iid: string) => void;
	onDuplicate: (iid: string) => void;
	/** Touch-friendly reorder (drag handles don't work on mobile). */
	onMoveUp?: (index: number) => void;
	onMoveDown?: (index: number) => void;
	isFirst?: boolean;
	isLast?: boolean;
}

/** "updated 12s ago" from a wall-clock timestamp. */
function freshness(at: number | null): string {
	if (!at) return "not yet loaded";
	const s = Math.max(0, Math.round((Date.now() - at) / 1000));
	if (s < 10) return "updated just now";
	if (s < 60) return `updated ${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `updated ${m}m ago`;
	return `updated ${Math.round(m / 60)}h ago`;
}

export default function WidgetCard({
	inst,
	def,
	ctx,
	index,
	dragging,
	onDragStart,
	onDragEnter,
	onDragEnd,
	onUpdate,
	onRemove,
	onDuplicate,
	onMoveUp,
	onMoveDown,
	isFirst,
	isLast,
}: Props) {
	const [menuOpen, setMenuOpen] = useState(false);
	const accent = ACCENTS[inst.accent];
	const Icon = def.icon;
	const failed = def.source ? ctx.failed[def.source.key] : false;

	const [minSpan, , maxSpan] = def.spans;
	const canGrow = inst.span < maxSpan;
	const canShrink = inst.span > minSpan;

	return (
		<section
			className={[
				"relative flex flex-col overflow-hidden rounded-xl border",
				"transition-[opacity,border-color,box-shadow] duration-150",
				accent.ring,
				inst.glass ? "widget-glass" : "bg-surface",
				dragging ? "opacity-40" : "",
			].join(" ")}
			style={{
				opacity: dragging ? 0.4 : inst.opacity,
				height: inst.height,
			}}
			onDragEnter={() => onDragEnter(index)}
			aria-label={`${def.name} widget`}
		>
			{/* Accent wash — tints the glass without hiding the content. */}
			<div
				aria-hidden="true"
				className={`pointer-events-none absolute inset-0 ${accent.wash}`}
			/>

			{/* ── Header ─────────────────────────────────────────── */}
			<header className="relative flex items-center gap-1.5 border-b border-border/40 px-2.5 py-1.5">
				<button
					type="button"
					draggable
					onDragStart={(e) => {
						// Firefox will not start a drag without data on the transfer.
						e.dataTransfer.setData("text/plain", inst.iid);
						e.dataTransfer.effectAllowed = "move";
						onDragStart(index);
					}}
					onDragEnd={onDragEnd}
					className="cursor-grab active:cursor-grabbing text-ink3 hover:text-ink2 touch-none"
					aria-label={`Reorder ${def.name}`}
					title="Drag to reorder"
				>
					<GripVertical size={13} />
				</button>

				<Icon size={12} className={accent.text} aria-hidden="true" />
				<h3 className="flex-1 truncate text-[11px] font-semibold text-ink2">
					{def.name}
				</h3>

				{/* Touch reorder — visible on coarse pointers, drag stays for desktop */}
				{onMoveUp && (
					<span className="vb-touch-reorder hidden items-center gap-0.5">
						<button
							type="button"
							onClick={() => onMoveUp(index)}
							disabled={isFirst}
							className="rounded-lg p-2 text-ink3 hover:text-ink2 hover:bg-surface2 disabled:opacity-25"
							aria-label={`Move ${def.name} up`}
							title="Move up"
						>
							<ArrowUp size={14} />
						</button>
						<button
							type="button"
							onClick={() => onMoveDown?.(index)}
							disabled={isLast}
							className="rounded-lg p-2 text-ink3 hover:text-ink2 hover:bg-surface2 disabled:opacity-25"
							aria-label={`Move ${def.name} down`}
							title="Move down"
						>
							<ArrowDown size={14} />
						</button>
					</span>
				)}

				{/* Resize */}
				<button
					type="button"
					onClick={() => onUpdate(inst.iid, { span: inst.span - 1 })}
					disabled={!canShrink}
					className="rounded-lg p-2 text-ink3 hover:text-ink2 hover:bg-surface2 disabled:opacity-25 disabled:hover:text-ink3"
					aria-label={`Shrink ${def.name}`}
					title="Narrower"
				>
					<Minimize2 size={13} />
				</button>
				<button
					type="button"
					onClick={() => onUpdate(inst.iid, { span: inst.span + 1 })}
					disabled={!canGrow}
					className="rounded-lg p-2 text-ink3 hover:text-ink2 hover:bg-surface2 disabled:opacity-25 disabled:hover:text-ink3"
					aria-label={`Widen ${def.name}`}
					title="Wider"
				>
					<Maximize2 size={13} />
				</button>

				<button
					type="button"
					onClick={() => setMenuOpen((v) => !v)}
					className="rounded-lg p-2 text-ink3 hover:text-ink2 hover:bg-surface2"
					aria-label={`Customise ${def.name}`}
					aria-expanded={menuOpen}
					title="Customise"
				>
					<MoreVertical size={14} />
				</button>
			</header>

			{/* ── Customise panel ────────────────────────────────── */}
			{menuOpen && (
				<div className="relative z-20 border-b border-border/40 bg-bg/85 px-2.5 py-2 backdrop-blur">
					<label className="flex items-center gap-2 text-[10px] text-ink3">
						<span className="w-12 shrink-0">Opacity</span>
						<input
							type="range"
							min={35}
							max={100}
							step={5}
							value={Math.round(inst.opacity * 100)}
							onChange={(e) =>
								onUpdate(inst.iid, { opacity: Number(e.target.value) / 100 })
							}
							className="flex-1 accent-[var(--vb-accent)]"
							aria-label={`Opacity for ${def.name}`}
						/>
						<span className="w-8 shrink-0 text-right tabular-nums">
							{Math.round(inst.opacity * 100)}%
						</span>
					</label>

					<div className="mt-2 flex items-center gap-2">
						<span className="w-12 shrink-0 text-[10px] text-ink3">Colour</span>
						<div className="flex gap-1">
							{(Object.keys(ACCENTS) as AccentKey[]).map((k) => (
								<button
									key={k}
									type="button"
									onClick={() => onUpdate(inst.iid, { accent: k })}
									className={[
										"h-4 w-4 rounded-full border",
										ACCENTS[k].swatch,
										inst.accent === k
											? "border-ink2 ring-1 ring-ink3"
											: "border-transparent",
									].join(" ")}
									aria-label={`Use ${ACCENTS[k].label} for ${def.name}`}
									aria-pressed={inst.accent === k}
									title={ACCENTS[k].label}
								/>
							))}
						</div>
					</div>

					<div className="mt-2 flex items-center gap-3 text-[10px] text-ink3">
						<button
							type="button"
							onClick={() => onUpdate(inst.iid, { glass: !inst.glass })}
							className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-surface2/60"
							aria-pressed={inst.glass}
						>
							<span
								className={[
									"inline-block h-3 w-5 rounded-full transition-colors",
									inst.glass ? "bg-accent" : "bg-surface2",
								].join(" ")}
							/>
							Glass
						</button>

						<label className="flex flex-1 items-center gap-1.5">
							<span className="shrink-0">Height</span>
							<input
								type="range"
								min={90}
								max={480}
								step={10}
								value={inst.height}
								onChange={(e) =>
									onUpdate(inst.iid, { height: Number(e.target.value) })
								}
								className="flex-1 accent-[var(--vb-accent)]"
								aria-label={`Height for ${def.name}`}
							/>
						</label>
					</div>

					<div className="mt-2 flex items-center gap-2">
						<button
							type="button"
							onClick={() => onDuplicate(inst.iid)}
							className="btn btn-ghost !px-2 !py-1 !text-[10px]"
						>
							<Copy size={11} /> Duplicate
						</button>
						<button
							type="button"
							onClick={() => onRemove(inst.iid)}
							className="btn btn-ghost !px-2 !py-1 !text-[10px] text-bad"
						>
							<Trash2 size={11} /> Remove
						</button>
					</div>
				</div>
			)}

			{/* ── Body ───────────────────────────────────────────── */}
			<div className="relative flex-1 overflow-hidden p-3">
				{def.render(ctx)}
			</div>

			{/* ── Footer: honest freshness, and failure is never hidden ── */}
			<footer className="relative flex items-center justify-between px-2.5 pb-1.5 pt-0.5">
				<span className="text-[9px] text-ink3" title={def.description}>
					{failed ? (
						<span className="text-bad">could not load · showing nothing</span>
					) : (
						freshness(ctx.refreshedAt)
					)}
				</span>
				<button
					type="button"
					onClick={() => onUpdate(inst.iid, {})}
					className="hidden"
					aria-hidden="true"
					tabIndex={-1}
				>
					<RefreshCw size={10} />
				</button>
			</footer>

			{/* Per-widget resize grip — height only, so it cannot fight the grid. */}
			<button
				type="button"
				aria-label={`Resize ${def.name}`}
				title="Drag resize"
				onPointerDown={(e) => {
					e.preventDefault();
					const startY = e.clientY;
					const startH = inst.height;
					const onMove = (ev: PointerEvent) => {
						const next = Math.max(
							90,
							Math.min(480, startH + (ev.clientY - startY)),
						);
						onUpdate(inst.iid, { height: next });
					};
					const onUp = () => {
						window.removeEventListener("pointermove", onMove);
						window.removeEventListener("pointerup", onUp);
					};
					window.addEventListener("pointermove", onMove);
					window.addEventListener("pointerup", onUp);
				}}
				className="absolute bottom-0 right-0 flex h-4 w-4 cursor-ns-resize items-end justify-end text-ink3 opacity-40 hover:opacity-100"
			>
				<ChevronDown size={10} className="rotate-[-45deg]" />
			</button>
		</section>
	);
}
