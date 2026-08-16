import type { RoomDef } from "./types";

/* ── Division color map ──────────────────────────────────── */
export const DIV_COLORS: Record<
	string,
	{ bg: string; border: string; text: string; glow: string; ring: string }
> = {
	executive: {
		bg: "bg-amber-500/10",
		border: "border-amber-500/25",
		text: "text-amber-400",
		glow: "shadow-amber-500/10",
		ring: "ring-amber-500/30",
	},
	content: {
		bg: "bg-blue-500/10",
		border: "border-blue-500/25",
		text: "text-blue-400",
		glow: "shadow-blue-500/10",
		ring: "ring-blue-500/30",
	},
	users: {
		bg: "bg-emerald-500/10",
		border: "border-emerald-500/25",
		text: "text-emerald-400",
		glow: "shadow-emerald-500/10",
		ring: "ring-emerald-500/30",
	},
	analytics: {
		bg: "bg-violet-500/10",
		border: "border-violet-500/25",
		text: "text-violet-400",
		glow: "shadow-violet-500/10",
		ring: "ring-violet-500/30",
	},
	system: {
		bg: "bg-red-500/10",
		border: "border-red-500/25",
		text: "text-red-400",
		glow: "shadow-red-500/10",
		ring: "ring-red-500/30",
	},
	meta: {
		bg: "bg-cyan-500/10",
		border: "border-cyan-500/25",
		text: "text-cyan-400",
		glow: "shadow-cyan-500/10",
		ring: "ring-cyan-500/30",
	},
	specialist: {
		bg: "bg-pink-500/10",
		border: "border-pink-500/25",
		text: "text-pink-400",
		glow: "shadow-pink-500/10",
		ring: "ring-pink-500/30",
	},
	platform: {
		bg: "bg-teal-500/10",
		border: "border-teal-500/25",
		text: "text-teal-400",
		glow: "shadow-teal-500/10",
		ring: "ring-teal-500/30",
	},
	"eng-backend": {
		bg: "bg-orange-500/10",
		border: "border-orange-500/25",
		text: "text-orange-400",
		glow: "shadow-orange-500/10",
		ring: "ring-orange-500/30",
	},
	"eng-frontend": {
		bg: "bg-sky-500/10",
		border: "border-sky-500/25",
		text: "text-sky-400",
		glow: "shadow-sky-500/10",
		ring: "ring-sky-500/30",
	},
	"eng-database": {
		bg: "bg-amber-600/10",
		border: "border-amber-600/25",
		text: "text-amber-500",
		glow: "shadow-amber-600/10",
		ring: "ring-amber-600/30",
	},
	"eng-infra": {
		bg: "bg-slate-500/10",
		border: "border-slate-500/25",
		text: "text-slate-400",
		glow: "shadow-slate-500/10",
		ring: "ring-slate-500/30",
	},
	"eng-qa": {
		bg: "bg-lime-500/10",
		border: "border-lime-500/25",
		text: "text-lime-400",
		glow: "shadow-lime-500/10",
		ring: "ring-lime-500/30",
	},
	"eng-dev": {
		bg: "bg-fuchsia-500/10",
		border: "border-fuchsia-500/25",
		text: "text-fuchsia-400",
		glow: "shadow-fuchsia-500/10",
		ring: "ring-fuchsia-500/30",
	},
};

export const TIER_COLORS: Record<string, string> = {
	executive: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
	leadership: "bg-violet-500/15 text-violet-400 border border-violet-500/20",
	specialist: "bg-blue-500/15 text-blue-400 border border-blue-500/20",
	meta: "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20",
	custom: "bg-pink-500/15 text-pink-400 border border-pink-500/20",
};

/* ── Office room layout ──────────────────────────────────── */
export const ROOMS: RoomDef[] = [
	{
		id: "ceo",
		name: "CEO Office",
		icon: "👑",
		divisions: ["executive"],
		accent: "amber",
		span: "sm",
	},
	{
		id: "command",
		name: "Command Center",
		icon: "🎯",
		divisions: ["system"],
		accent: "red",
		span: "md",
	},
	{
		id: "meeting",
		name: "Meeting Room",
		icon: "🤝",
		divisions: ["meta"],
		accent: "cyan",
		span: "sm",
	},
	{
		id: "backend",
		name: "Backend Room",
		icon: "⚙️",
		divisions: ["eng-backend"],
		accent: "orange",
		span: "md",
	},
	{
		id: "frontend",
		name: "Frontend Room",
		icon: "🎨",
		divisions: ["eng-frontend"],
		accent: "sky",
		span: "md",
	},
	{
		id: "database",
		name: "Database Room",
		icon: "💾",
		divisions: ["eng-database"],
		accent: "amber",
		span: "sm",
	},
	{
		id: "security",
		name: "Security Room",
		icon: "🛡️",
		divisions: ["specialist"],
		accent: "pink",
		span: "sm",
	},
	{
		id: "analytics",
		name: "Analytics Room",
		icon: "📊",
		divisions: ["analytics"],
		accent: "violet",
		span: "sm",
	},
	{
		id: "moderation",
		name: "Moderation Room",
		icon: "📝",
		divisions: ["content"],
		accent: "blue",
		span: "sm",
	},
	{
		id: "support",
		name: "Support Center",
		icon: "💬",
		divisions: ["users"],
		accent: "emerald",
		span: "sm",
	},
	{
		id: "server",
		name: "Server Room",
		icon: "🖥️",
		divisions: ["eng-infra"],
		accent: "slate",
		span: "sm",
	},
	{
		id: "qa",
		name: "QA Lab",
		icon: "🧪",
		divisions: ["eng-qa"],
		accent: "lime",
		span: "sm",
	},
	{
		id: "research",
		name: "AI Research Lab",
		icon: "🧬",
		divisions: ["eng-dev"],
		accent: "fuchsia",
		span: "md",
	},
	{
		id: "platform",
		name: "Platform Room",
		icon: "☁️",
		divisions: ["platform"],
		accent: "teal",
		span: "sm",
	},
	{
		id: "coffee",
		name: "Coffee Area",
		icon: "☕",
		divisions: [],
		accent: "stone",
		span: "sm",
	},
];

/* ── NOTE ───────────────────────────────────────────────────
   Simulated activity/task/event templates were removed (production
   spec Phase 35/46): the workforce runtime records REAL tasks with
   real timelines, outcomes, verification and impact. No fake activity
   constants belong in the office. */
