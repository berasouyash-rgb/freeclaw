import { AtSign, Award, ExternalLink, ShieldCheck, Sparkles, UserCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Modal } from "./ui";
import {
	getAnonymousProfile,
	resolveAuthorProfile,
	setProfile,
	type LocalProfile,
} from "../lib/identity";
import { computeUserBadges, TROPHY_TIER_STYLES, type VoiceImpactMetrics } from "../lib/badges";
import { triggerHaptic } from "../lib/haptics";

export { getAnonymousProfile };

export interface UserProfileMeta {
	authorId: string;
	isAdmin?: boolean;
	isMine?: boolean;
	isOp?: boolean;
	createdAt?: string;
	authorName?: string;
	authorPhoto?: string;
	authorAvatar?: string;
	impact?: Partial<VoiceImpactMetrics>;
}

export function UserProfileDialog({
	profileMeta,
	localProfile,
	displayName,
	onClose,
	onMention,
	onProfileUpdated,
}: {
	profileMeta: UserProfileMeta | null;
	localProfile?: LocalProfile;
	displayName?: string;
	onClose: () => void;
	onMention?: (handle: string) => void;
	onProfileUpdated?: (updated: LocalProfile) => void;
}) {
	const [activeTrophyId, setActiveTrophyId] = useState<string | null>(null);

	const resolved = useMemo(() => {
		if (!profileMeta) return null;
		if (typeof resolveAuthorProfile === "function") {
			try {
				return resolveAuthorProfile({
					authorId: profileMeta.authorId,
					myAnonId: profileMeta.isMine ? profileMeta.authorId : null,
					myProfile: localProfile,
					myDisplayName: displayName,
					postAuthorName: profileMeta.authorName,
					postAuthorPhoto: profileMeta.authorPhoto,
					postAuthorAvatar: profileMeta.authorAvatar,
				});
			} catch {
				// fallback below
			}
		}
		return {
			name: profileMeta.authorName || (profileMeta.isMine ? (displayName || "You") : "Student"),
			avatar: profileMeta.authorAvatar || (profileMeta.isMine ? (localProfile?.avatar || "👤") : "👤"),
			photo: profileMeta.authorPhoto || (profileMeta.isMine ? localProfile?.photo : undefined),
			isCustom: !!(profileMeta.authorPhoto || profileMeta.authorAvatar),
			handle: profileMeta.authorId ? `@${profileMeta.authorId.slice(0, 10)}` : "@anon",
			styleClass: "bg-surface3 border-border",
		};
	}, [profileMeta, localProfile, displayName]);

	// Impact stats
	const impactMetrics: VoiceImpactMetrics = useMemo(() => {
		const meta = profileMeta?.impact ?? {};
		return {
			issuesRaised: meta.issuesRaised ?? 0,
			adminResolutions: meta.adminResolutions ?? 0,
			pollVotesCast: meta.pollVotesCast ?? 0,
			communityActions: meta.communityActions ?? 0,
			cleanDraftStreak: meta.cleanDraftStreak ?? 1,
			slangDraftCount: meta.slangDraftCount ?? 0,
			strikeCount: meta.strikeCount ?? 0,
		};
	}, [profileMeta?.impact]);

	// Badges
	const badges = useMemo(() => computeUserBadges(impactMetrics), [impactMetrics]);

	if (!profileMeta || !resolved) return null;

	const { authorId, isAdmin, isMine, isOp } = profileMeta;

	const title = isMine
		? "Your Anonymous Profile"
		: isAdmin
			? "Administrator Profile"
			: `Author Profile (${resolved.name})`;

	const handleName = isMine
		? (displayName ? `${displayName} (You)` : "You")
		: isAdmin
			? "Official Administrator"
			: resolved.name;

	const handleEquipTrophy = (badgeId: string) => {
		if (!isMine || !localProfile) return;
		triggerHaptic("medium");
		const next: LocalProfile = {
			...localProfile,
			featuredBadge: localProfile.featuredBadge === badgeId ? "" : badgeId,
		};
		setProfile(next);
		onProfileUpdated?.(next);
	};

	return (
		<Modal open={!!profileMeta} onClose={onClose} title={title} maxWidth="max-w-lg">
			<div className="p-4 sm:p-5 text-center flex flex-col items-center">
				{/* ── Avatar ── */}
				<div className="relative mb-3 group">
					{resolved.photo ? (
						<img
							src={resolved.photo}
							alt={resolved.name}
							className="w-20 h-20 rounded-2xl object-cover border-2 border-border shadow-md vb-avatar transition-transform duration-300 hover:scale-105"
						/>
					) : (
						<div
							className={`w-20 h-20 rounded-2xl flex items-center justify-center text-4xl border-2 shadow-sm vb-avatar transition-transform duration-300 hover:scale-105 ${
								isAdmin
									? "bg-accent/15 border-accent/40 text-accent"
									: isMine
										? "bg-surface3 border-border"
										: resolved.styleClass
							}`}
						>
							{resolved.avatar || "👤"}
						</div>
					)}
					{isMine && (
						<span
							className="absolute -bottom-2 -right-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent text-white shadow-sm flex items-center gap-0.5"
							title="Verified on this device"
						>
							<UserCheck size={10} /> You
						</span>
					)}
				</div>

				{/* ── Name & Handle ── */}
				<h3 className="font-display font-bold text-lg text-ink flex items-center gap-1.5 justify-center">
					{handleName}
					{isAdmin && <ShieldCheck size={18} className="text-accent" />}
				</h3>
				<p className="font-mono text-xs text-ink3 mt-0.5">
					{authorId ? `@${authorId.slice(0, 14)}` : "@anonymous"}
				</p>

				{/* ── Badges Bar ── */}
				<div className="flex flex-wrap items-center justify-center gap-1.5 mt-3">
					{isAdmin && (
						<span className="chip !bg-accent !text-white !border-transparent">
							<ShieldCheck size={11} /> School Staff
						</span>
					)}
					{isOp && (
						<>
							<span className="chip !text-[10px] !bg-accent/20 !text-accent font-bold">
								OP
							</span>
							<span className="chip !bg-accent/15 !text-accent !border-accent/30 font-semibold">
								<Sparkles size={11} /> Post Author (OP)
							</span>
						</>
					)}
					{isMine && (
						<span className="chip !bg-surface3 !text-ink !border-border">
							<UserCheck size={11} /> Your Device
						</span>
					)}
					<span className="chip !bg-emerald-500/10 !text-emerald-600 dark:!text-emerald-400 !border-emerald-500/30 font-medium">
						<Sparkles size={11} /> Verified Community
					</span>
				</div>

				{/* ── Bio ── */}
				{isMine && localProfile?.bio && (
					<div className="mt-3 p-3 rounded-xl bg-surface2/60 border border-border text-left w-full text-xs text-ink2">
						<span className="text-[10px] font-semibold text-ink3 uppercase tracking-wider block mb-1">
							Your Bio
						</span>
						{localProfile.bio}
					</div>
				)}

				{/* ── YOUR VOICE IMPACT (Matches uploaded design) ── */}
				<div className="mt-4 p-4 rounded-2xl bg-surface2/50 dark:bg-slate-900/60 border border-border/80 w-full text-left shadow-xs">
					<div className="flex items-center justify-between mb-3">
						<span className="text-[11px] font-display font-bold text-accent uppercase tracking-wider flex items-center gap-1">
							<Sparkles size={13} /> Your Voice Impact
						</span>
						<span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface3 border border-border text-ink3">
							Anonymous & Protected
						</span>
					</div>

					<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
						<div className="p-2.5 rounded-xl bg-surface/80 dark:bg-slate-800/60 border border-border">
							<p className="font-display font-bold text-lg text-ink">
								{impactMetrics.issuesRaised}
							</p>
							<p className="text-[10px] text-ink3 font-medium mt-0.5">Issues Raised</p>
						</div>
						<div className="p-2.5 rounded-xl bg-surface/80 dark:bg-slate-800/60 border border-border">
							<p className="font-display font-bold text-lg text-emerald-600 dark:text-emerald-400">
								{impactMetrics.adminResolutions}
							</p>
							<p className="text-[10px] text-ink3 font-medium mt-0.5">Admin Resolutions</p>
						</div>
						<div className="p-2.5 rounded-xl bg-surface/80 dark:bg-slate-800/60 border border-border">
							<p className="font-display font-bold text-lg text-ink">
								{impactMetrics.pollVotesCast}
							</p>
							<p className="text-[10px] text-ink3 font-medium mt-0.5">Poll Votes Cast</p>
						</div>
						<div className="p-2.5 rounded-xl bg-surface/80 dark:bg-slate-800/60 border border-border">
							<p className="font-display font-bold text-lg text-ink">
								{impactMetrics.communityActions}
							</p>
							<p className="text-[10px] text-ink3 font-medium mt-0.5">Community Actions</p>
						</div>
					</div>
				</div>

				{/* ── Game Trophies & Achievement Badges ── */}
				<div className="mt-4 p-4 rounded-2xl bg-gradient-to-b from-surface2/40 to-surface2/20 border border-border/80 w-full text-left">
					<div className="flex items-center justify-between mb-3">
						<span className="text-[11px] font-display font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
							<Award size={14} className="text-amber-500" /> Trophies & Achievements
						</span>
						{isMine && (
							<span className="text-[10px] text-ink3">
								Tap to equip trophy
							</span>
						)}
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
						{badges.map((badge) => {
							const style = TROPHY_TIER_STYLES[badge.tier];
							const isEquipped = isMine && localProfile?.featuredBadge === badge.id;
							const isDetailsOpen = activeTrophyId === badge.id;

							return (
								<div
									key={badge.id}
									onClick={() => {
										setActiveTrophyId(isDetailsOpen ? null : badge.id);
										if (badge.unlocked && isMine) {
											handleEquipTrophy(badge.id);
										}
									}}
									className={`p-2.5 rounded-xl border transition-all duration-200 cursor-pointer text-left relative overflow-hidden select-none ${
										badge.unlocked
											? `bg-gradient-to-r ${style.badgeBg} ${style.badgeBorder} ${style.badgeGlow}`
											: "bg-surface2/30 border-border/50 opacity-60"
									}`}
								>
									<div className="flex items-start gap-2.5">
										<div
											className={`w-9 h-9 rounded-xl flex items-center justify-center text-xl shrink-0 ${
												badge.unlocked ? `${style.iconGlow} bg-surface/80 dark:bg-black/30 border ${style.badgeBorder}` : "bg-surface2 grayscale"
											}`}
										>
											{badge.icon}
										</div>
										<div className="min-w-0 flex-1">
											<div className="flex items-center justify-between gap-1">
												<h4 className="text-xs font-bold font-display text-ink truncate">
													{badge.title}
												</h4>
												{isEquipped && (
													<span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-accent text-white shrink-0">
														Equipped
													</span>
												)}
											</div>
											<p className="text-[10px] text-ink3 line-clamp-1 mt-0.5">
												{badge.subtitle}
											</p>
											{badge.progress && (
												<div className="mt-1 flex items-center gap-1.5">
													<div className="h-1 flex-1 bg-surface3 rounded-full overflow-hidden">
														<div
															className={`h-full bg-gradient-to-r ${badge.gradient}`}
															style={{
																width: `${Math.min(100, (badge.progress.current / badge.progress.target) * 100)}%`,
															}}
														/>
													</div>
													<span className="text-[9px] font-mono text-ink3 shrink-0">
														{badge.progress.label}
													</span>
												</div>
											)}
										</div>
									</div>

									{isDetailsOpen && (
										<p className="text-[11px] text-ink2 mt-2 pt-2 border-t border-border/40 leading-relaxed">
											{badge.description}
										</p>
									)}
								</div>
							);
						})}
					</div>
				</div>

				{/* ── Anonymity & Privacy ── */}
				<div className="mt-3 p-3 rounded-xl bg-surface2/40 border border-border/80 text-left w-full text-xs text-ink3 space-y-1">
					<p className="font-semibold text-ink2 flex items-center gap-1">
						🔒 100% Anonymous & Private
					</p>
					<p className="text-[11px] leading-relaxed">
						Identities are generated locally on-device. No phone numbers, real names, or tracking identifiers are ever stored or shared.
					</p>
				</div>

				{/* ── Actions ── */}
				<div className="flex flex-wrap items-center justify-center gap-2 mt-4 w-full">
					{onMention && !isMine && (
						<button
							type="button"
							onClick={() => {
								const handle = authorId?.startsWith("anon_")
									? authorId.slice(0, 10)
									: (authorId || "anon");
								onMention(handle);
								onClose();
							}}
							className="btn btn-primary !py-2 !px-4 text-xs flex-1 flex items-center justify-center gap-1.5"
						>
							<AtSign size={13} /> Mention in reply
						</button>
					)}
					{isMine && (
						<Link
							to="/settings"
							onClick={onClose}
							className="btn btn-primary !py-2 !px-4 text-xs flex-1 flex items-center justify-center gap-1.5"
						>
							<ExternalLink size={13} /> Edit Profile & Bio
						</Link>
					)}
					<button
						type="button"
						onClick={onClose}
						className="btn btn-ghost !py-2 !px-4 text-xs"
					>
						Close
					</button>
				</div>
			</div>
		</Modal>
	);
}
