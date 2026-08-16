import { Suspense, useCallback, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { PageContextProvider } from "./components/admin/PageContext";
import ErrorBoundary from "./components/ErrorBoundary";
import Layout from "./components/Layout";
import Preloader from "./components/preloader/Preloader";
import { AppProvider } from "./contexts/AppContext";
import { retryLazy } from "./lib/retryLazy";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";

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
const Settings = retryLazy(() => import("./pages/Settings"));
const Notifications = retryLazy(() => import("./pages/Notifications"));

// Admin console is code-split — with retryLazy
const Admin = retryLazy(() => import("./pages/Admin"));

const PageFallback = (
	<div className="min-h-[60vh] grid place-items-center">
		<div className="skeleton w-48 h-8" />
	</div>
);

// Wrapper to add ErrorBoundary around each Suspense section so
// one page crashing doesn't take down the entire app
function SuspendWithRetry({ children }: { children: React.ReactNode }) {
	return <ErrorBoundary>{children}</ErrorBoundary>;
}

/**
 * The cinematic boot plays at most ONCE per browser tab session.
 * Persisting the flag in sessionStorage means HMR full reloads, stale-chunk
 * recovery reloads, and plain refreshes never replay the film — the boot
 * experience belongs to a fresh session, not to every reload. A brand-new
 * tab still gets the full experience.
 */
const PRELOADER_DONE_KEY = "vb:preloader-played";

function readPreloaderDone(): boolean {
	try {
		return sessionStorage.getItem(PRELOADER_DONE_KEY) === "1";
	} catch {
		return false; // storage unavailable — play the boot film as normal
	}
}

export default function App() {
	const [preloaderDone, setPreloaderDone] =
		useState<boolean>(readPreloaderDone);

	const finishBoot = useCallback(() => {
		try {
			sessionStorage.setItem(PRELOADER_DONE_KEY, "1");
		} catch {
			/* storage unavailable — film simply plays again on the next load */
		}
		setPreloaderDone(true);
	}, []);

	return (
		<ErrorBoundary>
			{/* Premium boot layer — unmounts for real on finish so its GPU/timer
          resources are fully released. Session-guarded: once played in this
          tab it never replays on reloads. The app mounts beneath it and
          becomes interactive the moment real readiness flips to READY. */}
			{!preloaderDone && <Preloader onFinish={finishBoot} />}
			<AppProvider>
				<BrowserRouter>
					<Routes>
						{/* Marketing & Legal pages — no Layout wrapper */}
						<Route
							path="/about"
							element={
								<SuspendWithRetry>
									<Suspense fallback={PageFallback}>
										<About />
									</Suspense>
								</SuspendWithRetry>
							}
						/>
						<Route
							path="/contact"
							element={
								<SuspendWithRetry>
									<Suspense fallback={PageFallback}>
										<Contact />
									</Suspense>
								</SuspendWithRetry>
							}
						/>
						<Route
							path="/terms"
							element={
								<SuspendWithRetry>
									<Suspense fallback={PageFallback}>
										<Terms />
									</Suspense>
								</SuspendWithRetry>
							}
						/>
						<Route
							path="/status"
							element={
								<SuspendWithRetry>
									<Suspense fallback={PageFallback}>
										<StatusPage />
									</Suspense>
								</SuspendWithRetry>
							}
						/>
						<Route
							path="/changelog"
							element={
								<SuspendWithRetry>
									<Suspense fallback={PageFallback}>
										<Changelog />
									</Suspense>
								</SuspendWithRetry>
							}
						/>
						<Route
							path="/accessibility"
							element={
								<SuspendWithRetry>
									<Suspense fallback={PageFallback}>
										<Accessibility />
									</Suspense>
								</SuspendWithRetry>
							}
						/>

						{/* App pages — with Layout wrapper */}
						<Route element={<Layout />}>
							<Route path="/" element={<Home />} />
							<Route
								path="/submit"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<Submit />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/post/:id"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<PostDetail />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/polls"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<Polls />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/suggestions"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<Suggestions />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/leaderboard"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<Leaderboard />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/communities"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<Communities />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/communities/:slug"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<CommunityDetail />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/board"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<SolvingBoard />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/activity"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<MyActivity />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/saved"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<Saved />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/search"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<Search />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/insights"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<Insights />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/privacy"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<Privacy />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/faq"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<Faq />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/chat"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<UserChat />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/settings"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<Settings />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
							<Route
								path="/notifications"
								element={
									<SuspendWithRetry>
										<Suspense fallback={PageFallback}>
											<Notifications />
										</Suspense>
									</SuspendWithRetry>
								}
							/>
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
													<div className="skeleton w-64 h-32" />
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
				</BrowserRouter>
			</AppProvider>
		</ErrorBoundary>
	);
}
