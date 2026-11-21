import {
	Ellipsis,
	Home,
	MessageSquare,
	Plus,
	Search,
	User,
} from "lucide-react";
import { useMemo } from "react";
import type { ComponentType } from "react";
import { NavLink, useLocation } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { triggerHaptic } from "../lib/haptics";
import { prefetchRouteChunk } from "../lib/routeChunks";

export interface MobileNavItem {
	to?: string;
	label: string;
	ariaLabel?: string;
	icon: ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string; color?: string }>;
	badge?: number;
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
			{ to: "/", label: "Home", ariaLabel: "Feed", icon: Home },
			{ to: "/search", label: "Search", icon: Search },
			{ to: "/submit", label: "Submit", icon: Plus },
			{ to: "/chat", label: "Inbox", icon: MessageSquare, badge: chatUnread },
			{ to: "/activity", label: "Me", icon: User },
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
		<div className="lg:hidden fixed bottom-0 inset-x-0 z-40 pointer-events-none pb-[max(env(safe-area-inset-bottom),0.75rem)] px-3 flex justify-center">
			<nav
				className="vb-bottomnav relative pointer-events-auto rounded-full bg-white dark:bg-[#12141c] border border-slate-200/80 dark:border-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.12)] dark:shadow-[0_16px_40px_rgba(0,0,0,0.6)] p-1.5 flex items-center gap-1 sm:gap-1.5 max-w-fit mx-auto transition-all duration-300"
				aria-label="Mobile navigation"
			>
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

					const accessibleLabel = item.badge
						? `${item.ariaLabel || item.label}, ${item.badge} unread`
						: (item.ariaLabel || item.label);

					return (
						<NavLink
							key={item.to}
							to={item.to!}
							end={item.to === "/"}
							onMouseEnter={prefetch}
							onFocus={prefetch}
							onClick={() => triggerHaptic("light")}
							style={{ color: isActive ? "#ffffff" : undefined }}
							className={`relative flex items-center justify-center py-2 px-3.5 rounded-full select-none transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-accent ${
								isActive
									? "!text-white text-accent font-semibold"
									: "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
							}`}
							aria-label={accessibleLabel}
						>
							{isActive && (
								<motion.div
									layoutId="mobile-active-pill"
									className="absolute inset-0 rounded-full bg-[#5652d6] dark:bg-[#6366f1] shadow-[0_4px_16px_rgba(86,82,214,0.4)]"
									transition={{ type: "spring", stiffness: 480, damping: 34, mass: 0.8 }}
								/>
							)}

							<div className="relative z-10 flex items-center gap-1.5">
								<div className="relative flex items-center justify-center">
									<Icon
										size={20}
										strokeWidth={isActive ? 2.3 : 1.9}
										color={isActive ? "#ffffff" : undefined}
										className="transition-transform duration-200"
									/>
									{typeof item.badge === "number" && item.badge > 0 && (
										<span
											key={item.badge}
											className="absolute -top-1 -right-2 min-w-[14px] h-3.5 text-[8px] font-bold grid place-items-center bg-red-500 text-white rounded-full px-1 shadow-xs"
											aria-hidden
										>
											{item.badge > 99 ? "99+" : item.badge}
										</span>
									)}
								</div>
								<AnimatePresence initial={false} mode="wait">
									{isActive && (
										<motion.span
											key={item.label}
											initial={{ opacity: 0, width: 0, scale: 0.85 }}
											animate={{ opacity: 1, width: "auto", scale: 1 }}
											exit={{ opacity: 0, width: 0, scale: 0.85 }}
											transition={{ type: "spring", stiffness: 480, damping: 34 }}
											className="text-xs font-semibold tracking-tight leading-none whitespace-nowrap pl-0.5 !text-white overflow-hidden"
											style={{ color: "#ffffff" }}
										>
											{item.label}
										</motion.span>
									)}
								</AnimatePresence>
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
					style={{ color: moreOpen ? "#ffffff" : undefined }}
					className={`relative flex items-center justify-center py-2 px-3.5 rounded-full select-none transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-accent ${
						moreOpen
							? "!text-white text-accent font-semibold"
							: "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
					}`}
				>
					{moreOpen && (
						<motion.div
							layoutId="mobile-active-pill"
							className="absolute inset-0 rounded-full bg-[#5652d6] dark:bg-[#6366f1] shadow-[0_4px_16px_rgba(86,82,214,0.4)]"
							transition={{ type: "spring", stiffness: 480, damping: 34, mass: 0.8 }}
						/>
					)}

					<div className="relative z-10 flex items-center gap-1.5">
						<div className="relative flex items-center justify-center">
							<Ellipsis
								size={20}
								strokeWidth={moreOpen ? 2.3 : 1.9}
								color={moreOpen ? "#ffffff" : undefined}
							/>
							{unreadAlerts > 0 && (
								<span
									key={unreadAlerts}
									className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-[#12141c] shadow-xs"
									aria-hidden
								/>
							)}
						</div>
						<AnimatePresence initial={false} mode="wait">
							{moreOpen && (
								<motion.span
									key="more"
									initial={{ opacity: 0, width: 0, scale: 0.85 }}
									animate={{ opacity: 1, width: "auto", scale: 1 }}
									exit={{ opacity: 0, width: 0, scale: 0.85 }}
									transition={{ type: "spring", stiffness: 480, damping: 34 }}
									className="text-xs font-semibold tracking-tight leading-none whitespace-nowrap pl-0.5 !text-white overflow-hidden"
									style={{ color: "#ffffff" }}
								>
									More
								</motion.span>
							)}
						</AnimatePresence>
					</div>
				</button>
			</nav>
		</div>
	);
}
