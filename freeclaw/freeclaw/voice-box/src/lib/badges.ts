/**
 * VoiceFlow Gamification & Badges Engine
 *
 * Provides real campus community achievements, interactive 3D-feel trophies,
 * and impact calculations.
 */

export interface TrophyBadge {
	id: string;
	title: string;
	subtitle: string;
	description: string;
	icon: string;
	tier: "diamond" | "gold" | "silver" | "bronze" | "emerald";
	category: "governance" | "community" | "trust" | "democracy";
	gradient: string;
	borderClass: string;
	glowClass: string;
	unlocked: boolean;
	progress?: { current: number; target: number; label: string };
}

export interface VoiceImpactMetrics {
	issuesRaised: number;
	adminResolutions: number;
	pollVotesCast: number;
	communityActions: number;
	cleanDraftStreak: number;
	slangDraftCount: number;
	strikeCount: number;
}

export const TROPHY_TIER_STYLES = {
	diamond: {
		badgeBg: "from-cyan-500/20 via-blue-500/15 to-indigo-500/20",
		badgeBorder: "border-cyan-400/40 dark:border-cyan-400/30",
		badgeText: "text-cyan-600 dark:text-cyan-300",
		badgeGlow: "shadow-[0_0_16px_rgba(6,182,212,0.3)]",
		iconGlow: "drop-shadow-[0_2px_8px_rgba(6,182,212,0.6)]",
		chip: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
	},
	gold: {
		badgeBg: "from-amber-400/25 via-yellow-500/15 to-orange-500/20",
		badgeBorder: "border-amber-400/50 dark:border-amber-400/40",
		badgeText: "text-amber-700 dark:text-amber-300",
		badgeGlow: "shadow-[0_0_18px_rgba(245,158,11,0.35)]",
		iconGlow: "drop-shadow-[0_2px_8px_rgba(245,158,11,0.7)]",
		chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
	},
	silver: {
		badgeBg: "from-slate-300/30 via-slate-400/15 to-zinc-400/20",
		badgeBorder: "border-slate-400/40 dark:border-slate-400/30",
		badgeText: "text-slate-700 dark:text-slate-200",
		badgeGlow: "shadow-[0_0_14px_rgba(148,163,184,0.3)]",
		iconGlow: "drop-shadow-[0_2px_6px_rgba(148,163,184,0.6)]",
		chip: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-400/30",
	},
	bronze: {
		badgeBg: "from-amber-700/20 via-orange-800/15 to-amber-900/20",
		badgeBorder: "border-amber-700/40 dark:border-amber-700/30",
		badgeText: "text-amber-800 dark:text-amber-400",
		badgeGlow: "shadow-[0_0_12px_rgba(180,83,9,0.25)]",
		iconGlow: "drop-shadow-[0_2px_6px_rgba(180,83,9,0.6)]",
		chip: "bg-amber-800/10 text-amber-800 dark:text-amber-400 border-amber-800/30",
	},
	emerald: {
		badgeBg: "from-emerald-500/20 via-teal-500/15 to-green-500/20",
		badgeBorder: "border-emerald-400/40 dark:border-emerald-400/30",
		badgeText: "text-emerald-600 dark:text-emerald-300",
		badgeGlow: "shadow-[0_0_14px_rgba(16,185,129,0.3)]",
		iconGlow: "drop-shadow-[0_2px_6px_rgba(16,185,129,0.6)]",
		chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
	},
};

/**
 * Calculates user's real community badges and unlocked trophies
 * based on verified activity data.
 */
export function computeUserBadges(metrics: Partial<VoiceImpactMetrics>): TrophyBadge[] {
	const raised = metrics.issuesRaised ?? 0;
	const resolved = metrics.adminResolutions ?? 0;
	const votes = metrics.pollVotesCast ?? 0;
	const actions = metrics.communityActions ?? 0;
	const strikes = metrics.strikeCount ?? 0;
	const slangDrafts = metrics.slangDraftCount ?? 0;

	return [
		{
			id: "campus_pillar",
			title: "Campus Keystone",
			subtitle: "Gold Honor Trophy",
			description: "Submitted valid campus issues that directly led to school administration action and resolution.",
			icon: "🏆",
			tier: "gold",
			category: "governance",
			gradient: "from-amber-400 to-yellow-600",
			borderClass: "border-amber-400/60",
			glowClass: "shadow-[0_0_20px_rgba(245,158,11,0.4)]",
			unlocked: resolved >= 1,
			progress: { current: Math.min(resolved, 1), target: 1, label: `${resolved}/1 Admin Resolution` },
		},
		{
			id: "clean_record",
			title: "Verified Student Voice",
			subtitle: "Spotless Community Standing",
			description: "100% clean record with zero strikes, validated constructive issues, and respectful language in drafts and posts.",
			icon: "💎",
			tier: "diamond",
			category: "trust",
			gradient: "from-cyan-400 to-blue-600",
			borderClass: "border-cyan-400/60",
			glowClass: "shadow-[0_0_20px_rgba(6,182,212,0.4)]",
			unlocked: strikes === 0 && slangDrafts === 0,
			progress: { current: strikes === 0 && slangDrafts === 0 ? 1 : 0, target: 1, label: strikes > 0 ? "Flagged for strikes" : slangDrafts > 0 ? "Slang in drafts" : "100% Clean Record" },
		},
		{
			id: "change_catalyst",
			title: "Change Catalyst",
			subtitle: "Silver Action Trophy",
			description: "Active contributor who has raised 2 or more campus issues or constructive suggestions.",
			icon: "⚡",
			tier: "silver",
			category: "community",
			gradient: "from-slate-300 to-slate-500",
			borderClass: "border-slate-400/50",
			glowClass: "shadow-[0_0_16px_rgba(148,163,184,0.35)]",
			unlocked: raised >= 2,
			progress: { current: Math.min(raised, 2), target: 2, label: `${raised}/2 Issues Raised` },
		},
		{
			id: "civic_pillar",
			title: "Democracy Pillar",
			subtitle: "Bronze Civic Trophy",
			description: "Actively voted in student decisions and campus polls.",
			icon: "🗳️",
			tier: "bronze",
			category: "democracy",
			gradient: "from-amber-700 to-amber-900",
			borderClass: "border-amber-700/50",
			glowClass: "shadow-[0_0_14px_rgba(180,83,9,0.3)]",
			unlocked: votes >= 1,
			progress: { current: Math.min(votes, 1), target: 1, label: `${votes}/1 Poll Voted` },
		},
		{
			id: "community_champion",
			title: "School Voice Guardian",
			subtitle: "Emerald Community Honor",
			description: "Achieved 5 or more supportive community actions across campus discussions.",
			icon: "🌟",
			tier: "emerald",
			category: "community",
			gradient: "from-emerald-400 to-teal-600",
			borderClass: "border-emerald-400/50",
			glowClass: "shadow-[0_0_16px_rgba(16,185,129,0.35)]",
			unlocked: actions >= 5,
			progress: { current: Math.min(actions, 5), target: 5, label: `${actions}/5 Actions Completed` },
		},
	];
}
