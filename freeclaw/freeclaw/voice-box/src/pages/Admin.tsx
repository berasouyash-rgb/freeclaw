import {
	BarChart3,
	Bot,
	Bug,
	Command,
	ExternalLink,
	Flag,
	Inbox,
	LayoutDashboard,
	Lightbulb,
	Loader2,
	LogOut,
	Megaphone,
	Menu,
	MessageCircle,
	Moon,
	Radar,
	ScrollText,
	Search,
	Settings as SettingsIcon,
	ShieldCheck,
	Sun,
	Table2,
	Tags,
	Trophy,
	Users,
	X,
} from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import ErrorBoundary from "../components/ErrorBoundary";
import { useApp } from "../contexts/AppContext";
import {
	api,
	clearAdminSession,
	hasAdminSession,
	setAdminSession,
} from "../lib/api";
import { retryLazy } from "../lib/retryLazy";
import { sha256 } from "../lib/utils";

// Lazy loaded (all tabs) — wrapped with retryLazy for auto-recovery from chunk failures
const Overview = retryLazy(() => import("./admin/Overview"));
const PostsTable = retryLazy(() => import("./admin/PostsTable"));
const PollManager = retryLazy(() => import("./admin/PollManager"));
const SuggestionsTable = retryLazy(() => import("./admin/SuggestionsTable"));
const CommentMod = retryLazy(() => import("./admin/CommentMod"));
const UserManager = retryLazy(() => import("./admin/UserManager"));
const Logs = retryLazy(() => import("./admin/Logs"));
const Categories = retryLazy(() => import("./admin/Categories"));
const AdminSettings = retryLazy(() => import("./admin/AdminSettings"));
const AiPanel = retryLazy(() => import("./admin/AiPanel"));
const CommandCenter = retryLazy(() => import("./admin/CommandCenter"));
const WorkforceCenter = retryLazy(() => import("./admin/WorkforceCenter"));
const UnifiedInbox = retryLazy(() => import("./admin/UnifiedInbox"));
// One unified AI Operations tab — combines the old Agent Team / Workforce /
// Agent Dashboard / AI Output / Reports / Content Review workspaces.
const AIOperations = retryLazy(() => import("./admin/AIOperations"));
const AdminAI = retryLazy(() => import("./admin/AdminAI"));
// Ops Center — the outcome-focused hidden-workforce command view (default tab).
const OpsCenter = retryLazy(() => import("./admin/OpsCenter"));
const AgentDashboard = retryLazy(() => import("./admin/AgentDashboard"));
// Reports — classic Report queue merged with Content Review + Approvals.
const Reports = retryLazy(() => import("./admin/Reports"));
const AdminLeaderboard = retryLazy(() => import("./admin/AdminLeaderboard"));
const ErrorTracking = retryLazy(() => import("./admin/ErrorTracking"));

function TabFallback() {
	return (
		<div className="flex items-center justify-center py-16 gap-2 text-ink3 text-xs">
			<Loader2 size={14} className="animate-spin" />
			<span>Loading…</span>
		</div>
	);
}

// ─── Tab registry, grouped like a Google/Microsoft admin console ───
// Each group maps to a sidebar section; the flat list drives the content
// switch and the top-bar search.
type AdminTab = { key: string; label: string; icon: typeof Radar };

const TAB_GROUPS: { title: string; tabs: AdminTab[] }[] = [
	{
		title: "Operations",
		tabs: [
			{ key: "ops-center", label: "Ops Center", icon: Radar },
			{ key: "overview", label: "Dashboard", icon: LayoutDashboard },
			{ key: "agent-dashboard", label: "Agent Dashboard", icon: Bot },
			{ key: "workforce", label: "AI Workforce", icon: Bot },
			{ key: "command-center", label: "Command Center", icon: MessageCircle },
		],
	},
	{
		title: "Moderation",
		tabs: [
			{ key: "reports", label: "Reports", icon: Flag },
			{ key: "inbox", label: "Inbox", icon: Inbox },
			{ key: "posts", label: "Feed", icon: Table2 },
			{ key: "suggestions", label: "Suggestions", icon: Lightbulb },
			{ key: "comments", label: "Comments", icon: MessageCircle },
			{ key: "users", label: "Users", icon: Users },
		],
	},
	{
		title: "Analytics",
		tabs: [
			{ key: "polls", label: "Polls", icon: BarChart3 },
			{ key: "leaderboard", label: "Leaderboard", icon: Trophy },
		],
	},
	{
		title: "System",
		tabs: [
			{ key: "error-tracking", label: "Error Tracking", icon: Bug },
			{ key: "categories", label: "Categories", icon: Tags },
			{ key: "logs", label: "Activity Log", icon: ScrollText },
			{ key: "settings", label: "Settings", icon: SettingsIcon },
		],
	},
];

const ALL_TABS: AdminTab[] = TAB_GROUPS.flatMap((g) => g.tabs);

export default function Admin() {
	const { theme, toggleTheme, toast } = useApp();
	const [authed, setAuthed] = useState(hasAdminSession());
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [tab, setTab] = useState("overview");
	const [mobileNav, setMobileNav] = useState(false);
	const [search, setSearch] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const searchRef = useRef<HTMLInputElement>(null);

	// Cross-panel navigation (e.g. "Message author" → chat tab)
	useEffect(() => {
		const h = (e: Event) => setTab((e as CustomEvent).detail);
		window.addEventListener("vb:admin-tab", h);
		return () => window.removeEventListener("vb:admin-tab", h);
	}, []);

	// verify session on mount + auto-logout on expiry
	useEffect(() => {
		if (!hasAdminSession()) {
			setAuthed(false);
			return;
		}
		api
			.get<{ valid: boolean }>("/api/admin?action=verify")
			.then((r) => {
				if (!r.valid) {
					clearAdminSession();
					setAuthed(false);
				}
			})
			.catch((e: unknown) => {
				console.warn(
					"[Admin] Session verify failed:",
					e instanceof Error ? e.message : e,
				);
				clearAdminSession();
				setAuthed(false);
			});
		const iv = setInterval(() => {
			if (!hasAdminSession()) {
				setAuthed(false);
				toast("Admin session expired", "info");
			}
		}, 60000);
		return () => clearInterval(iv);
	}, [toast]);

	// ⌘K / Ctrl+K / "/" — focus the tab search from anywhere in the console
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setSearchOpen(true);
				setTimeout(() => searchRef.current?.focus(), 10);
			}
			if (
				!e.metaKey &&
				!e.ctrlKey &&
				e.key === "/" &&
				document.activeElement?.tagName !== "INPUT"
			) {
				e.preventDefault();
				setSearchOpen(true);
				setTimeout(() => searchRef.current?.focus(), 10);
			}
			if (e.key === "Escape") {
				setSearchOpen(false);
				setSearch("");
			}
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, []);

	// Filtered tab results for the search dropdown
	const searchResults = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return [];
		return ALL_TABS.filter(
			(t) =>
				t.label.toLowerCase().includes(q) ||
				t.key.toLowerCase().includes(q),
		).slice(0, 8);
	}, [search]);

	const login = async () => {
		// busy guard here (not just on the button) — the Enter key handler
		// bypasses the disabled attribute, so two rapid Enters used to fire
		// two concurrent /api/admin login requests.
		if (!password || busy) return;
		setBusy(true);
		try {
			const hash = await sha256(password);
			const res = await api.post<{ token: string; expires_at: string }>(
				"/api/admin",
				{ action: "login", password_hash: hash },
			);
			setAdminSession(res.token, res.expires_at);
			setAuthed(true);
			setPassword("");
			toast("Welcome back, admin 👋", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Login failed", "err");
		}
		setBusy(false);
	};

	const logout = async () => {
		try {
			await api.post("/api/admin", { action: "logout" });
		} catch {
			/* ignore */
		}
		clearAdminSession();
		setAuthed(false);
	};

	const activeTab = ALL_TABS.find((t) => t.key === tab) ?? ALL_TABS[0]!;

	if (!authed) {
		return (
			<div className="admin-shell min-h-screen grid place-items-center px-4 bg-bg">
				<div className="card w-full max-w-sm p-7 vb-rise">
					<div className="text-center mb-6">
						<span className="inline-grid place-items-center w-13 h-13 p-3 rounded-xl bg-accent text-white mb-3 shadow-lg shadow-accent/30">
							<ShieldCheck size={26} />
						</span>
						<h1 className="font-display font-bold text-xl">
							Admin access
						</h1>
						<p className="text-xs text-ink3 mt-1">
							Password-only login · hashed · 60-minute session
						</p>
					</div>
					<label
						className="text-xs font-semibold text-ink2 block mb-1.5"
						htmlFor="admin-pw"
					>
						Password
					</label>
					<input
						id="admin-pw"
						type="password"
						className="input"
						placeholder="••••••••"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && login()}
						autoFocus
						aria-describedby="admin-pw-help"
					/>
					<p id="admin-pw-help" className="text-[10px] text-ink3 mt-1.5">
						Enter the admin password to access the dashboard.
					</p>
					<button
						className="btn btn-primary w-full mt-4"
						onClick={login}
						disabled={busy || !password}
						aria-label={
							busy ? "Verifying password" : "Sign in to admin panel"
						}
					>
						{busy ? "Verifying…" : "Sign in"}
					</button>
					<Link
						to="/"
						className="block text-center text-xs text-ink3 hover:text-accent mt-3"
					>
						← Back to Voice Box
					</Link>
				</div>
			</div>
		);
	}

	const nav = (
		<nav className="flex flex-col" aria-label="Admin navigation">
			{TAB_GROUPS.map((group) => (
				<div key={group.title}>
					<div className="vb-admin-group-label">{group.title}</div>
					<div className="flex flex-col gap-0.5">
						{group.tabs.map(({ key, label, icon: Icon }) => (
							<button
								key={key}
								onClick={() => {
									setTab(key);
									setMobileNav(false);
								}}
								aria-current={tab === key ? "page" : undefined}
								className={`vb-admin-nav flex items-center gap-2.5 text-left ${tab === key ? "vb-admin-nav-active" : "text-ink2"}`}
							>
								<Icon size={16} aria-hidden /> {label}
							</button>
						))}
					</div>
				</div>
			))}
		</nav>
	);

	return (
		<div className="admin-shell min-h-screen flex bg-bg">
			{/* ── Sidebar (desktop) — grouped, Google Admin style ───────── */}
			<aside
				className="hidden md:flex flex-col w-60 shrink-0 border-r border-border bg-surface px-2.5 py-4 sticky top-0 h-screen overflow-y-auto"
				aria-label="Admin navigation"
			>
				<Link
					to="/"
					className="flex items-center gap-2.5 px-2.5 mb-1"
					aria-label="Voice Box home"
				>
					<span className="w-8 h-8 rounded-lg bg-accent grid place-items-center text-white shadow-sm">
						<Megaphone size={15} />
					</span>
					<div>
						<span className="font-display font-bold text-[15px] block leading-none">
							Voice Box
						</span>
						<span className="text-[10px] text-ink3 mt-0.5 block">
							Admin console
						</span>
					</div>
				</Link>
				{nav}
				<div className="mt-auto pt-4 flex gap-1.5">
					{/* Jump straight into the user space without signing out — the admin
					    session stays active, so moderation actions appear right in the feed. */}
					<Link
						to="/"
						className="btn btn-ghost !p-2 flex-[1.4] !rounded-lg !text-[11px] font-semibold !border-accent/25 hover:!bg-accent/10 !text-accent"
						aria-label="View site as a user"
						title="Open the public site — moderation tools stay active"
					>
						<ExternalLink size={13} />
						<span className="hidden md:inline">View site</span>
					</Link>
					<button
						className="btn btn-ghost !p-2 flex-1 !rounded-lg"
						onClick={toggleTheme}
						aria-label="Toggle theme"
						title={theme === "dark" ? "Light mode" : "Dark mode"}
					>
						{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
					</button>
					<button
						className="btn btn-ghost !p-2 flex-1 !rounded-lg !text-bad !border-bad/25 hover:!bg-bad/10"
						onClick={logout}
						aria-label="Sign out"
						title="Sign out"
					>
						<LogOut size={15} />
					</button>
				</div>
			</aside>

			{/* ── Mobile drawer ─────────────────────────────────────────── */}
			{mobileNav && (
				<div
					className="fixed inset-0 z-50 md:hidden"
					role="dialog"
					aria-modal="true"
					aria-label="Admin menu"
				>
					<div
						className="absolute inset-0 bg-black/50"
						onClick={() => setMobileNav(false)}
					/>
					<div className="absolute left-0 top-0 bottom-0 w-64 bg-surface p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] overflow-y-auto vb-rise">
						<div className="flex justify-between items-center mb-4">
							<span className="font-display font-bold text-sm">
								Voice Box Admin
							</span>
							<button
								className="btn btn-ghost !p-2"
								onClick={() => setMobileNav(false)}
								aria-label="Close menu"
							>
								<X size={16} />
							</button>
						</div>
						{nav}
						<button
							className="btn btn-ghost w-full mt-4 !text-xs !text-bad !border-bad/25"
							onClick={logout}
						>
							<LogOut size={13} /> Sign out
						</button>
					</div>
				</div>
			)}

			<div className="flex-1 min-w-0 flex flex-col">
				{/* ── Top app bar — breadcrumb · search · actions ───────── */}
				<header className="vb-admin-topbar sticky top-0 z-40">
					{/* Mobile row */}
					<div className="md:hidden flex items-center gap-3 px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
						<button
							className="btn btn-ghost !p-2"
							onClick={() => setMobileNav(true)}
							aria-label="Open menu"
						>
							<Menu size={17} />
						</button>
						<div className="min-w-0">
							<div className="text-[10px] text-ink3 leading-none">
								Admin
							</div>
							<div className="font-display font-bold text-sm leading-tight truncate">
								{activeTab.label}
							</div>
						</div>
						<button
							className="btn btn-ghost !p-2 ml-auto"
							onClick={toggleTheme}
							aria-label="Toggle theme"
						>
							{theme === "dark" ? (
								<Sun size={15} />
							) : (
								<Moon size={15} />
							)}
						</button>
					</div>

					{/* Desktop row — Google Admin-style workbench bar */}
					<div className="hidden md:flex items-center gap-3 px-6 h-[52px]">
						<div className="flex items-center gap-2 min-w-0">
							<nav
								aria-label="Breadcrumb"
								className="flex items-center gap-1.5 text-[13px] min-w-0"
							>
								<span className="text-ink3">Admin</span>
								<span className="text-ink3/60">/</span>
								<span className="font-semibold text-ink truncate">
									{activeTab.label}
								</span>
							</nav>
						</div>

						{/* Tab search */}
						<div className="relative ml-auto w-72 max-w-[40vw]">
							<div className="vb-admin-search flex items-center gap-2 px-3 py-1.5">
								<Search size={14} className="text-ink3 shrink-0" />
								<input
									ref={searchRef}
									type="text"
									value={search}
									onChange={(e) => {
										setSearch(e.target.value);
										setSearchOpen(true);
									}}
									onFocus={() => setSearchOpen(true)}
									onBlur={() =>
										setTimeout(() => setSearchOpen(false), 150)
									}
									onKeyDown={(e) => {
										if (e.key === "Enter" && searchResults[0]) {
											setTab(searchResults[0].key);
											setSearch("");
											setSearchOpen(false);
										}
									}}
									placeholder="Search sections…"
									aria-label="Search admin sections"
									className="bg-transparent text-[13px] text-ink outline-none w-full placeholder:text-ink3"
								/>
								<kbd className="hidden lg:inline-flex items-center gap-0.5 text-[9.5px] font-semibold text-ink3 border border-border rounded px-1 py-px shrink-0">
									<Command size={9} /> K
								</kbd>
							</div>
							{searchOpen && searchResults.length > 0 && (
								<div className="absolute right-0 top-full mt-1.5 w-80 max-w-[80vw] rounded-lg border border-border bg-surface shadow-lg overflow-hidden z-50">
									{searchResults.map(({ key, label, icon: Icon }) => (
										<button
											key={key}
											type="button"
											onMouseDown={(e) => e.preventDefault()}
											onClick={() => {
												setTab(key);
												setSearch("");
												setSearchOpen(false);
											}}
											className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left hover:bg-surface2 transition-colors"
										>
											<Icon size={15} className="text-ink3" />
											{label}
										</button>
									))}
								</div>
							)}
						</div>

						<button
							className="btn btn-ghost !px-2.5 !py-1.5 !rounded-lg !text-[12.5px]"
							onClick={toggleTheme}
							title={theme === "dark" ? "Light mode" : "Dark mode"}
						>
							{theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
							<span className="hidden xl:inline">
								{theme === "dark" ? "Light" : "Dark"}
							</span>
						</button>
						<Link
							to="/"
							className="btn btn-ghost !px-3 !py-1.5 !rounded-lg !text-[12.5px] !text-accent !border-accent/25 hover:!bg-accent/10"
							title="Open the public site as a user"
						>
							<ExternalLink size={13} /> View site
						</Link>
						<button
							className="btn btn-primary !px-3 !py-1.5 !rounded-lg !text-[12.5px]"
							onClick={logout}
						>
							<LogOut size={13} /> Sign out
						</button>
					</div>
				</header>

				<main className="p-4 sm:p-6 max-w-[1400px] mx-auto w-full flex-1">
					{/* Each tab has its own ErrorBoundary so one crash doesn't take down the whole admin panel */}
					<Suspense fallback={<TabFallback />}>
						{tab === "ops-center" && (
							<ErrorBoundary key="ops-center">
								<OpsCenter />
							</ErrorBoundary>
						)}
						{tab === "overview" && (
							<ErrorBoundary key="overview">
								<Overview />
							</ErrorBoundary>
						)}
						{tab === "agent-dashboard" && (
							<ErrorBoundary key="agent-dashboard">
								<AgentDashboard />
							</ErrorBoundary>
						)}
						{tab === "workforce" && (
							<ErrorBoundary key="workforce">
								<WorkforceCenter />
							</ErrorBoundary>
						)}
						{tab === "admin-ai" && (
							<ErrorBoundary key="admin-ai">
								<AdminAI />
							</ErrorBoundary>
						)}
						{tab === "ai-operations" && (
							<ErrorBoundary key="ai-operations">
								<AIOperations />
							</ErrorBoundary>
						)}
						{tab === "reports" && (
							<ErrorBoundary key="reports">
								<Reports />
							</ErrorBoundary>
						)}
						{tab === "command-center" && (
							<ErrorBoundary key="command-center">
								<CommandCenter />
							</ErrorBoundary>
						)}
						{tab === "inbox" && (
							<ErrorBoundary key="inbox">
								<UnifiedInbox />
							</ErrorBoundary>
						)}
						{tab === "ai" && (
							<ErrorBoundary key="ai">
								<AiPanel />
							</ErrorBoundary>
						)}
						{tab === "posts" && (
							<ErrorBoundary key="posts">
								<PostsTable type="problem" />
							</ErrorBoundary>
						)}
						{tab === "suggestions" && (
							<ErrorBoundary key="suggestions">
								<SuggestionsTable />
							</ErrorBoundary>
						)}
						{tab === "polls" && (
							<ErrorBoundary key="polls">
								<PollManager />
							</ErrorBoundary>
						)}
						{tab === "comments" && (
							<ErrorBoundary key="comments">
								<CommentMod />
							</ErrorBoundary>
						)}
						{tab === "users" && (
							<ErrorBoundary key="users">
								<UserManager />
							</ErrorBoundary>
						)}
						{tab === "leaderboard" && (
							<ErrorBoundary key="leaderboard">
								<AdminLeaderboard />
							</ErrorBoundary>
						)}
						{tab === "error-tracking" && (
							<ErrorBoundary key="error-tracking">
								<ErrorTracking />
							</ErrorBoundary>
						)}
						{tab === "categories" && (
							<ErrorBoundary key="categories">
								<Categories />
							</ErrorBoundary>
						)}
						{tab === "logs" && (
							<ErrorBoundary key="logs">
								<Logs />
							</ErrorBoundary>
						)}
						{tab === "settings" && (
							<ErrorBoundary key="settings">
								<AdminSettings />
							</ErrorBoundary>
						)}
					</Suspense>
				</main>
			</div>
		</div>
	);
}
