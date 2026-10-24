import { Suspense } from "react";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router";
import { PageContextProvider } from "./components/admin/PageContext";
import ErrorBoundary, { LoadingSpinner } from "./components/ErrorBoundary";
import Layout from "./components/Layout";
import Seo from "./components/Seo";
import { AppProvider } from "./contexts/AppContext";
import ToastHost from "./components/ToastHost";
import { isNativeShell } from "./lib/platform";
import { retryLazy } from "./lib/retryLazy";
import NotFound from "./pages/NotFound";

// Lazy-load the Home page to reduce initial bundle size (~50KB+ gzipped)
const Home = retryLazy(() => import("./pages/Home"));

// Code-split non-critical pages — wrapped with retryLazy to auto-recover
// from chunk load failures (3 retries with exponential backoff)
const Submit = retryLazy(() => import("./pages/Submit"));
const PostDetail = retryLazy(() => import("./pages/PostDetail"));
const Polls = retryLazy(() => import("./pages/Polls"));
const Suggestions = retryLazy(() => import("./pages/Suggestions"));
const Leaderboard = retryLazy(() => import("./pages/Leaderboard"));
const SolvingBoard = retryLazy(() => import("./pages/SolvingBoard"));
const Communities = retryLazy(() => import("./pages/Communities"));
const CommunityDetail = retryLazy(() => import("./pages/CommunityDetail"));
const MyActivity = retryLazy(() => import("./pages/MyActivity"));
const Saved = retryLazy(() => import("./pages/Saved"));
const Search = retryLazy(() => import("./pages/Search"));
const Insights = retryLazy(() => import("./pages/Insights"));
const Privacy = retryLazy(() => import("./pages/Privacy"));
const UserChat = retryLazy(() => import("./pages/UserChat"));
const Faq = retryLazy(() => import("./pages/Faq"));
const About = retryLazy(() => import("./pages/About"));
const Contact = retryLazy(() => import("./pages/Contact"));
const Terms = retryLazy(() => import("./pages/Terms"));
const StatusPage = retryLazy(() => import("./pages/StatusPage"));
const Changelog = retryLazy(() => import("./pages/Changelog"));
const Accessibility = retryLazy(() => import("./pages/Accessibility"));
const Download = retryLazy(() => import("./pages/Download"));
const Settings = retryLazy(() => import("./pages/Settings"));
const Notifications = retryLazy(() => import("./pages/Notifications"));

// Admin console is code-split — with retryLazy
const Admin = retryLazy(() => import("./pages/Admin"));

const PageFallback = (
	<div className="min-h-[60vh] grid place-items-center">
		<LoadingSpinner text="Loading page…" motiveOff />
	</div>
);

// Wrapper to add ErrorBoundary around each route section so
// one page crashing doesn't take down the entire app. (Suspense for
// code-split chunks is composed at each call site.)
function WithPageBoundary({ children }: { children: React.ReactNode }) {
	return <ErrorBoundary>{children}</ErrorBoundary>;
}

// One place composing Boundary + Suspense — every lazy route gets both
// without repeating the wrapper JSX 24 times.
function PageRoute({ El }: { El: React.ComponentType }) {
	return (
		<WithPageBoundary>
			<Suspense fallback={PageFallback}>
				<El />
			</Suspense>
		</WithPageBoundary>
	);
}

// Marketing & Legal pages — rendered outside the Layout shell.
const PUBLIC_ROUTES = [
	{ path: "/about", El: About },
	{ path: "/contact", El: Contact },
	{ path: "/terms", El: Terms },
	{ path: "/status", El: StatusPage },
	{ path: "/changelog", El: Changelog },
	{ path: "/accessibility", El: Accessibility },
];

// App pages — rendered inside the Layout shell.
const APP_ROUTES = [
	{ path: "/", El: Home },
	{ path: "/submit", El: Submit },
	{ path: "/post/:id", El: PostDetail },
	{ path: "/polls", El: Polls },
	{ path: "/suggestions", El: Suggestions },
	{ path: "/leaderboard", El: Leaderboard },
	{ path: "/communities", El: Communities },
	{ path: "/communities/:slug", El: CommunityDetail },
	{ path: "/board", El: SolvingBoard },
	{ path: "/activity", El: MyActivity },
	{ path: "/saved", El: Saved },
	{ path: "/search", El: Search },
	{ path: "/insights", El: Insights },
	{ path: "/privacy", El: Privacy },
	{ path: "/faq", El: Faq },
	{ path: "/chat", El: UserChat },
	{ path: "/settings", El: Settings },
	{ path: "/notifications", El: Notifications },
	{ path: "/download", El: Download },
];

/**
 * Direct Boot — the real application mounts immediately. No cinematic boot
 * layer and no session gate: the app is interactive on first paint. Failures
 * surface through ErrorBoundary / main.tsx's fatal screen; chunk-load
 * failures self-heal via retryLazy.
 */
export default function App() {
	// Native shells load over file:// (Electron) or a custom scheme
	// (Capacitor) with no server rewrites — hash routing keeps every
	// route working there. Web keeps clean BrowserRouter URLs.
	const ShellRouter = isNativeShell() ? HashRouter : BrowserRouter;
	return (
		<ErrorBoundary>
			<AppProvider>
				<ShellRouter>
					<Routes>
						{PUBLIC_ROUTES.map(({ path, El }) => (
							<Route key={path} path={path} element={<PageRoute El={El} />} />
						))}

						{/* App pages — with Layout wrapper */}
						<Route element={<Layout />}>
							{APP_ROUTES.map(({ path, El }) => (
								<Route key={path} path={path} element={<PageRoute El={El} />} />
							))}
						</Route>

						{/* Admin — code-split, PageContext wrapped, with own ErrorBoundary */}
						<Route
							path="/admin/*"
							element={
								<ErrorBoundary>
									<PageContextProvider>
										<Suspense
											fallback={
												<div className="min-h-screen grid place-items-center bg-bg">
													<LoadingSpinner text="Loading admin…" motiveOff />
												</div>
											}
										>
											<Admin />
										</Suspense>
									</PageContextProvider>
								</ErrorBoundary>
							}
						/>

						{/* 404 */}
						<Route path="*" element={<NotFound />} />
					</Routes>
					{/* Per-route title + canonical + 404 noindex (SEO) */}
					<Seo />
					<ToastHost />
				</ShellRouter>
			</AppProvider>
		</ErrorBoundary>
	);
}
