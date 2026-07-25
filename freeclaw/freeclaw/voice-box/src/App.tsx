import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './contexts/AppContext';
// @ts-expect-error — JSX module without types
import { PageContextProvider } from './components/admin/PageContext';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import Home from './pages/Home';
import NotFound from './pages/NotFound';

// Code-split non-critical pages — students rarely visit most of these on first load
const Submit = lazy(() => import('./pages/Submit'));
const PostDetail = lazy(() => import('./pages/PostDetail'));
const Polls = lazy(() => import('./pages/Polls'));
const Suggestions = lazy(() => import('./pages/Suggestions'));
const SolvingBoard = lazy(() => import('./pages/SolvingBoard'));
const MyActivity = lazy(() => import('./pages/MyActivity'));
const Privacy = lazy(() => import('./pages/Privacy'));
const UserChat = lazy(() => import('./pages/UserChat'));
const Faq = lazy(() => import('./pages/Faq'));
const About = lazy(() => import('./pages/About'));
const Contact = lazy(() => import('./pages/Contact'));
const Terms = lazy(() => import('./pages/Terms'));
const StatusPage = lazy(() => import('./pages/StatusPage'));
const Changelog = lazy(() => import('./pages/Changelog'));
const Accessibility = lazy(() => import('./pages/Accessibility'));
const Settings = lazy(() => import('./pages/Settings'));
const Notifications = lazy(() => import('./pages/Notifications'));

// Admin console is code-split — students never download it
const Admin = lazy(() => import('./pages/Admin'));

const PageFallback = <div className="min-h-[60vh] grid place-items-center"><div className="skeleton w-48 h-8" /></div>;

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <BrowserRouter>
          <Routes>
            {/* Marketing & Legal pages — no Layout wrapper */}
            <Route path="/about" element={<Suspense fallback={PageFallback}><About /></Suspense>} />
            <Route path="/contact" element={<Suspense fallback={PageFallback}><Contact /></Suspense>} />
            <Route path="/terms" element={<Suspense fallback={PageFallback}><Terms /></Suspense>} />
            <Route path="/status" element={<Suspense fallback={PageFallback}><StatusPage /></Suspense>} />
            <Route path="/changelog" element={<Suspense fallback={PageFallback}><Changelog /></Suspense>} />
            <Route path="/accessibility" element={<Suspense fallback={PageFallback}><Accessibility /></Suspense>} />

            {/* App pages — with Layout wrapper */}
            <Route element={<Layout />}>
              <Route path="/" element={<Home />} />
              <Route path="/submit" element={<Suspense fallback={PageFallback}><Submit /></Suspense>} />
              <Route path="/post/:id" element={<Suspense fallback={PageFallback}><PostDetail /></Suspense>} />
              <Route path="/polls" element={<Suspense fallback={PageFallback}><Polls /></Suspense>} />
              <Route path="/suggestions" element={<Suspense fallback={PageFallback}><Suggestions /></Suspense>} />
              <Route path="/board" element={<Suspense fallback={PageFallback}><SolvingBoard /></Suspense>} />
              <Route path="/activity" element={<Suspense fallback={PageFallback}><MyActivity /></Suspense>} />
              <Route path="/privacy" element={<Suspense fallback={PageFallback}><Privacy /></Suspense>} />
              <Route path="/faq" element={<Suspense fallback={PageFallback}><Faq /></Suspense>} />
              <Route path="/chat" element={<Suspense fallback={PageFallback}><UserChat /></Suspense>} />
              <Route path="/settings" element={<Suspense fallback={PageFallback}><Settings /></Suspense>} />
              <Route path="/notifications" element={<Suspense fallback={PageFallback}><Notifications /></Suspense>} />
            </Route>

            {/* Admin — code-split, PageContext wrapped */}
            <Route path="/admin/*" element={
              <PageContextProvider>
                <Suspense fallback={<div className="min-h-screen grid place-items-center bg-bg"><div className="skeleton w-64 h-32" /></div>}>
                  <Admin />
                </Suspense>
              </PageContextProvider>
            } />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </ErrorBoundary>
  );
}
