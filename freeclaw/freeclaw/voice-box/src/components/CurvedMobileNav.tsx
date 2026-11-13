import {
	Ellipsis,
	Home,
	MessageSquare,
	Plus,
	Search,
	UserCircle2,
} from "lucide-react";
import { useMemo } from "react";
import type { ComponentType } from "react";
import { NavLink, useLocation } from "react-router";
import { triggerHaptic } from "../lib/haptics";
import { prefetchRouteChunk } from "../lib/routeChunks";

export interface MobileNavItem {
	to?: string;
	label: string;
	icon: ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>;
	badge?: number;
	isHeroAction?: boolean;
}

interface CurvedMobileNavProps {
	chatUnread: number;
	unreadAlerts: number;
	moreOpen: boolean;
	onOpenMore: () => void;
}

export function CurvedMobileNav({
	chatUnread,
	unreadAlerts,
	moreOpen,
	onOpenMore,
}: CurvedMobileNavProps) {
	const location = useLocation();
	const path = location.pathname;

	const items = useMemo<MobileNavItem[]>(
		() => [
			{ to: "/", label: "Feed", icon: Home },
			{ to: "/search", label: "Search", icon: Search },
			{ to: "/submit", label: "Submit", icon: Plus, isHeroAction: true },
			{ to: "/chat", label: "Inbox", icon: MessageSquare, badge: chatUnread },
			{ to: "/activity", label: "Me", icon: UserCircle2 },
		],
		[chatUnread],
	);

	// Determine active index
	const activeIndex = useMemo(() => {
		if (moreOpen) return 5;
		if (path === "/") return 0;
		if (path.startsWith("/search")) return 1;
		if (path.startsWith("/submit")) return 2;
		if (path.startsWith("/chat")) return 3;
		if (path.startsWith("/activity") || path.startsWith("/me") || path.startsWith("/settings")) return 4;
		return 0; // Default
	}, [path, moreOpen]);

	return (
		<div className="lg:hidden fixed bottom-0 inset-x-0 z-40 pointer-events-none pb-[max(env(safe-area-inset-bottom),0.6rem)] px-3 sm:px-4">
			<nav
				className="vb-bottomnav max-w-md mx-auto relative pointer-events-auto rounded-[32px] bg-surface/95 dark:bg-[#111422]/95 backdrop-blur-2xl border border-border/80 dark:border-white/10 shadow-[0_16px_40px_-6px_rgba(0,0,0,0.22)] dark:shadow-[0_20px_48px_-6px_rgba(0,0,0,0.75)] transition-all duration-200"
				aria-label="Mobile navigation"
			>
				{/* ── Tab Items Container ── */}
				<div className="flex items-center justify-between h-16 px-2 relative z-10">
					{items.map((item, idx) => {
						const isActive = activeIndex === idx;
						const Icon = item.icon;
						const prefetch = () => {
							if (item.to) {
								prefetchRouteChunk(
									item.to === "/"
										? "Home"
										: item.to.slice(1).charAt(0).toUpperCase() + item.to.slice(2),
								);
							}
						};

						// Hero center action button (e.g. Create / Submit)
						if (item.isHeroAction) {
							return (
								<NavLink
									key={item.to}
									to={item.to!}
									onMouseEnter={prefetch}
									onFocus={prefetch}
									onClick={() => triggerHaptic("medium")}
									className="relative flex items-center justify-center -mt-6 group focus:outline-hidden"
									aria-label={item.label}
								>
									<div className="w-13 h-13 rounded-full bg-gradient-to-tr from-accent via-[#6366f1] to-[#8b5cf6] p-1 shadow-[0_8px_24px_rgba(99,102,241,0.5)] ring-4 ring-surface dark:ring-[#111422] group-hover:scale-105 group-active:scale-95 transition-all duration-200 flex items-center justify-center text-white">
										<Icon size={24} strokeWidth={2.6} className="transition-transform group-hover:rotate-90 duration-300" />
									</div>
								</NavLink>
							);
						}

						return (
							<NavLink
								key={item.to}
								to={item.to!}
								end={item.to === "/"}
								onMouseEnter={prefetch}
								onFocus={prefetch}
								onClick={() => triggerHaptic("light")}
								className={`relative flex items-center justify-center py-2 px-3 rounded-full transition-all duration-300 select-none ${
									isActive
										? "bg-surface3/90 dark:bg-white/12 text-accent dark:text-white shadow-xs font-bold scale-[1.03]"
										: "text-ink3 hover:text-ink active:scale-95"
								}`}
								aria-label={
									item.badge ? `${item.label}, ${item.badge} unread` : item.label
								}
							>
								<div className="flex items-center gap-1.5">
									<div className="relative">
										<Icon
											size={20}
											strokeWidth={isActive ? 2.4 : 1.8}
											className="transition-transform duration-200"
										/>
										{typeof item.badge === "number" && item.badge > 0 && (
											<span
												key={item.badge}
												className="absolute -top-1 -right-2 min-w-[14px] h-3.5 text-[8px] font-bold grid place-items-center bg-bad text-white rounded-full px-1 shadow-xs"
												aria-hidden
											>
												{item.badge > 99 ? "99+" : item.badge}
											</span>
										)}
									</div>
									{isActive && (
										<span className="text-xs font-display tracking-tight leading-none animate-in fade-in duration-200">
											{item.label}
										</span>
									)}
								</div>
							</NavLink>
						);
					})}

					{/* ── More Action Button ── */}
					<button
						type="button"
						onClick={() => {
							triggerHaptic("light");
							onOpenMore();
						}}
						aria-label={
							unreadAlerts > 0
								? `More pages, ${unreadAlerts} unread alerts`
								: "More pages"
						}
						aria-expanded={moreOpen}
						className={`relative flex items-center justify-center py-2 px-3 rounded-full transition-all duration-300 select-none ${
							moreOpen
								? "bg-surface3/90 dark:bg-white/12 text-accent dark:text-white shadow-xs font-bold scale-[1.03]"
								: "text-ink3 hover:text-ink active:scale-95"
						}`}
					>
						<div className="flex items-center gap-1.5">
							<div className="relative">
								<Ellipsis size={20} strokeWidth={moreOpen ? 2.4 : 1.8} />
								{unreadAlerts > 0 && (
									<span
										key={unreadAlerts}
										className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-bad ring-2 ring-surface shadow-xs"
										aria-hidden
									/>
								)}
							</div>
							{moreOpen && (
								<span className="text-xs font-display tracking-tight leading-none animate-in fade-in duration-200">
									More
								</span>
							)}
						</div>
					</button>
				</div>
			</nav>
		</div>
	);
}
