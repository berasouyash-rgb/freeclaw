import {
	Command,
	ExternalLink,
	Loader2,
	LogOut,
	Megaphone,
	Menu,
	Moon,
	Search,
	ShieldCheck,
	Sun,
	X,
} from "lucide-react";
import {
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Link, useSearchParams } from "react-router";
import ErrorBoundary from "../components/ErrorBoundary";
import { useApp } from "../contexts/AppContext";
import {
	api,
	clearAdminSession,
	hasAdminSession,
	setAdminSession,
} from "../lib/api";
import { retryLazy } from "../lib/retryLazy";
import {
	ADMIN_TAB_GROUPS,
	ADMIN_TABS,
	normalizeAdminTab,
	parseAdminTab,
} from "../lib/adminTabs";
import { sha256 } from "../lib/utils";

// Lazy loaded (all tabs) — wrapped with retryLazy for auto-recovery from chunk failures
// Dashboard
const Overview = retryLazy(() => import("./admin/Overview"));
// Content
const Reports = retryLazy(() => import("./admin/Reports"));
const PostsTable = retryLazy(() => import("./admin/PostsTable"));
const UserManager = retryLazy(() => import("./admin/UserManager"));
const Categories = retryLazy(() => import("./admin/Categories"));
const PollManager = retryLazy(() => import("./admin/PollManager"));
const SlangLeaders = retryLazy(() => import("./admin/SlangLeaders"));
// Communication
const UnifiedInbox = retryLazy(() => import("./admin/UnifiedInbox"));
const EmailTemplates = retryLazy(() => import("./admin/EmailTemplates"));
// Operations
const ErrorTracking = retryLazy(() => import("./admin/ErrorTracking"));
const Logs = retryLazy(() => import("./admin/Logs"));
// Config
const AdminSettings = retryLazy(() => import("./admin/AdminSettings"));
const AiSystems = retryLazy(() => import("./admin/AiSystems"));

function TabFallback() {
	return (
		<div className="flex items-center justify-center py-16 gap-2 text-ink3 text-xs">
			<Loader2 size={14} className="animate-spin" />
			<span>Loading…</span>
		</div>
	);
}

// The canonical registry is shared by navigation, search, PageContext, and
// tests so the active human-action workspaces have one source of truth.
const TAB_GROUPS = ADMIN_TAB_GROUPS;
const ALL_TABS = ADMIN_TABS;

export default function Admin() {
	const { theme, toggleTheme, toast } = useApp();
	const [authed, setAuthed] = useState(hasAdminSession());
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [mobileNav, setMobileNav] = useState(false);
	const [search, setSearch] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const searchRef = useRef<HTMLInputElement>(null);

	// Which credential does this deployment expect? The server answers from
	// env config only (no sensitive data): env-secret deployments collect the
	// ADMIN_SESSION_SECRET at login; others collect the shared password.
	const [envMode, setEnvMode] = useState(false);
	useEffect(() => {
		if (authed) return;
		api
			.get<{ env_secret: boolean }>("/api/admin?action=auth_mode")
			.then((r) => setEnvMode(!!r.env_secret))
			.catch(() => setEnvMode(false)); // fail open to password login
	}, [authed]);

	// ── The active tab lives in the URL (?tab=reports) ────────────────
	// It used to be component state, so /admin always reopened on Dashboard:
	// refreshing lost your place, the Back button left the console entirely,
	// and a tab could not be linked or bookmarked (a support hand-off could
	// only ever say "go to Reports", never "open this exact view").
	const [searchParams, setSearchParams] = useSearchParams();
	const normalizedTab = normalizeAdminTab(searchParams.get("tab"));
	const tab = normalizedTab.tab;

	const setTab = useCallback(
		(next: string) => {
			const key = parseAdminTab(next);
			// Push rather than replace so Back returns to the previous view
			// instead of dropping the admin out of the console.
			setSearchParams((prev) => {
				const p = new URLSearchParams(prev);
				p.set("tab", key);
				return p;
			});
		},
		[setSearchParams],
	);

	// All 17 documented operator controls remain canonical and navigable.
	// Action Center is a secondary Command Center panel, not a replacement for
	// the dedicated AI/operations surfaces.

	// Cross-panel navigation (e.g. "Message author" → chat tab).
	// Detail may be a tab key string or { tab, thread } for deep-links
	// that land straight on one inbox conversation.
	useEffect(() => {
		const h = (e: Event) => {
			const detail = (e as CustomEvent).detail as
				| string
				| { tab?: string; thread?: string };
			if (typeof detail === "string") {
				setTab(detail);
				return;
			}
			const key = parseAdminTab(detail?.tab);
			setSearchParams((prev) => {
				const p = new URLSearchParams(prev);
				p.set("tab", key);
				if (detail?.thread) p.set("thread", detail.thread);
				return p;
			});
		};
		window.addEventListener("vb:admin-tab", h);
		return () => window.removeEventListener("vb:admin-tab", h);
	}, [setTab, setSearchParams]);

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
			<div className="admin-shell min-h-screen grid place-items-center px-4 bg-bg vb-tab-enter">
				<div className="card w-full max-w-sm p-8 vb-rise">
					<div className="text-center mb-7">
						<span className="inline-grid place-items-center w-14 h-14 p-3 rounded-2xl bg-accent text-white mb-4 shadow-lg shadow-accent/30">
							<ShieldCheck size={28} />
						</span>
						<h1 className="font-display font-bold text-2xl tracking-tight">
							Admin Access
						</h1>							<p className="text-xs text-ink3 mt-1.5">
								{envMode
									? "Secret-key login · 60-minute revocable session"
									: "Password login · hashed · 60-minute session"}
							</p>
					</div>
					<label
						className="text-xs font-semibold text-ink2 block mb-1.5"
						htmlFor="admin-pw"
					>
						{envMode ? "Admin secret" : "Password"}
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
						{envMode
							? "Enter the ADMIN_SESSION_SECRET configured for this deployment."
							: "Enter the admin password to access the dashboard."}
					</p>
					<button
						className="btn btn-primary w-full mt-5 !py-2.5 !text-sm !font-semibold"
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
						className="block text-center text-xs text-ink3 hover:text-accent mt-4 transition-colors"
					>
						← Back to Voice Flow
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
								className={`vb-admin-nav relative flex items-center gap-2.5 text-left transition-all ${tab === key ? "vb-admin-nav-active font-semibold text-ink" : "text-ink2 hover:text-ink hover:bg-surface2/60 rounded-lg"}`}
							>
								<Icon size={16} className={tab === key ? "text-accent" : ""} aria-hidden /> {label}
							</button>
						))}
					</div>
				</div>
			))}
		</nav>
	);

	return (
		<div className="admin-shell min-h-screen flex bg-bg" data-admin-console="true">
			{/* ── Sidebar (desktop) — grouped, Google Admin style ───────── */}
			<aside
				className="hidden md:flex flex-col w-60 shrink-0 border-r border-border bg-surface px-2.5 py-4 sticky top-0 h-screen overflow-y-auto"
				aria-label="Admin navigation"
			>
				<Link
					to="/"
					className="flex items-center gap-2.5 px-2.5 mb-2"
					aria-label="Voice Flow home"
				>
					<span className="w-9 h-9 rounded-xl bg-accent grid place-items-center text-white shadow-md shadow-accent/25">
						<Megaphone size={16} />
					</span>
					<div>
						<span className="font-display font-bold text-[15px] block leading-none text-ink">
							Voice Flow
						</span>
						<span className="text-[10px] text-ink3 mt-0.5 block font-medium">
							Admin Console
						</span>
					</div>
				</Link>
				{nav}
				<div className="mt-auto pt-4 border-t border-border/60 flex gap-1.5">
					<Link
						to="/"
						className="btn btn-ghost !p-2 flex-[1.4] !rounded-xl !text-[11px] font-semibold !border-accent/25 hover:!bg-accent/10 !text-accent"
						aria-label="View site as a user"
						title="Open the public site — moderation tools stay active"
					>
						<ExternalLink size={13} />
						<span className="hidden md:inline">View site</span>
					</Link>
					<button
						className="btn btn-ghost !p-2 flex-1 !rounded-xl"
						onClick={toggleTheme}
						aria-label="Toggle theme"
						title={theme === "dark" ? "Light mode" : "Dark mode"}
					>
						{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
					</button>
					<button
						className="btn btn-ghost !p-2 flex-1 !rounded-xl !text-bad !border-bad/25 hover:!bg-bad/10"
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
					<div className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-surface p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] overflow-y-auto vb-rise border-r border-border">
						<div className="flex justify-between items-center mb-5">
							<span className="font-display font-bold text-sm text-ink">
								Voice Flow Admin
							</span>
							<button
								className="btn btn-ghost !p-2.5 !rounded-xl"
								onClick={() => setMobileNav(false)}
								aria-label="Close menu"
							>
								<X size={18} />
							</button>
						</div>
						{nav}
						<button
							className="btn btn-ghost w-full mt-4 !text-sm !py-3 !text-bad !border-bad/25"
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
					<div className="md:hidden flex items-center gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] border-b border-border bg-surface">
						<button
							className="btn btn-ghost !p-2.5 !rounded-xl"
							onClick={() => setMobileNav(true)}
							aria-label="Open menu"
						>
							<Menu size={18} />
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
								<span className="text-ink3 font-medium">Admin</span>
								<span className="text-ink3/40">/</span>
								<span className="font-bold text-ink truncate">
									<activeTab.icon size={14} className="inline text-accent mr-1.5" />
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

				<main className="p-4 sm:p-6 max-w-[1400px] mx-auto w-full flex-1" key={tab}>
					{/* Each tab has its own ErrorBoundary so one crash doesn't take down the whole admin panel */}
					<Suspense fallback={<TabFallback />}>
						{tab === "dashboard" && (
							<ErrorBoundary key="dashboard">
								<Overview />
							</ErrorBoundary>
						)}						{tab === "reports" && (
							<ErrorBoundary key="reports">
								<Reports />
							</ErrorBoundary>
						)}
						{tab === "posts" && (
							<ErrorBoundary key="posts">
								<PostsTable type="problem" />
							</ErrorBoundary>
						)}
						{tab === "users" && (
							<ErrorBoundary key="users">
								<UserManager />
							</ErrorBoundary>
						)}
						{tab === "categories" && (
							<ErrorBoundary key="categories">
								<Categories />
							</ErrorBoundary>
						)}
						{tab === "polls" && (
							<ErrorBoundary key="polls">
								<PollManager />
							</ErrorBoundary>
						)}
						{tab === "slang" && (
							<ErrorBoundary key="slang">
								<SlangLeaders />
							</ErrorBoundary>
						)}
						{tab === "inbox" && (
							<ErrorBoundary key="inbox">
								<UnifiedInbox />
							</ErrorBoundary>
						)}
						{tab === "errors" && (
							<ErrorBoundary key="errors">
								<ErrorTracking />
							</ErrorBoundary>
						)}
						{tab === "logs" && (
							<ErrorBoundary key="logs">
								<Logs />
							</ErrorBoundary>
						)}
						{tab === "email-templates" && (
							<ErrorBoundary key="email-templates">
								<EmailTemplates />
							</ErrorBoundary>
						)}
						{tab === "settings" && (
							<ErrorBoundary key="settings">
								<AdminSettings />
							</ErrorBoundary>
						)}
						{tab === "ai-systems" && (
							<ErrorBoundary key="ai-systems">
								<AiSystems />
							</ErrorBoundary>
						)}
					</Suspense>
				</main>
			</div>
		</div>
	);
}
