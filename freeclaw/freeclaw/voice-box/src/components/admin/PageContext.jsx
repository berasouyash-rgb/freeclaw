import { createContext, useContext, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * PageContext — Detects current admin page from URL and provides
 * context to the AI assistant about what the admin is viewing.
 * 
 * URL-based auto-detection:
 * - /admin/posts → page: 'posts', filters: from query params
 * - /admin/analytics → page: 'analytics'
 * - /admin/reports → page: 'reports'
 * - etc.
 * 
 * Usage:
 *   import { PageContextProvider, usePageContext } from '../components/admin/PageContext';
 *   // Wrap admin routes with <PageContextProvider>
 *   const ctx = usePageContext(); // { page, filters, selectedItems, ... }
 */

const PageContext = createContext({
  page: null,
  filters: {},
  selectedItems: [],
  pageTitle: '',
  pageDescription: '',
});

// URL → page type mapping
const PAGE_MAP = {
  '/admin': 'dashboard',
  '/admin/posts': 'posts',
  '/admin/analytics': 'analytics',
  '/admin/reports': 'reports',
  '/admin/users': 'users',
  '/admin/polls': 'polls',
  '/admin/notifications': 'notifications',
  '/admin/ai': 'ai',
  '/admin/command-center': 'command-center',
  '/admin/settings': 'settings',
  '/admin/knowledge': 'knowledge',
  '/admin/agents': 'agents',
};

// Page metadata
const PAGE_META = {
  dashboard: { title: 'Dashboard', description: 'Platform overview and key metrics' },
  posts: { title: 'Posts', description: 'Manage user submissions and issues' },
  analytics: { title: 'Analytics', description: 'Platform usage and trend analysis' },
  reports: { title: 'Reports', description: 'Content reports and flags' },
  users: { title: 'Users', description: 'User management and moderation' },
  polls: { title: 'Polls', description: 'Poll management and results' },
  notifications: { title: 'Notifications', description: 'Notification history and settings' },
  ai: { title: 'AI Analysis', description: 'AI-powered insights and recommendations' },
  'command-center': { title: 'Command Center', description: 'Agent management and tool execution' },
  settings: { title: 'Settings', description: 'Platform configuration' },
  knowledge: { title: 'Knowledge Base', description: 'Knowledge base management' },
  agents: { title: 'Agents', description: 'Agent monitoring and configuration' },
};

/**
 * Detects page type and filters from the current URL.
 * @param {string} pathname - Current URL pathname
 * @param {string} search - Current URL search/query string
 * @returns {object} { page, filters, pageTitle, pageDescription }
 */
function detectPageContext(pathname, search) {
  // Match pathname to page type
  let page = null;
  let matchedPath = '';

  // Try exact match first, then partial
  for (const [path, pageType] of Object.entries(PAGE_MAP)) {
    if (pathname === path || pathname === path + '/') {
      page = pageType;
      matchedPath = path;
      break;
    }
  }

  // Partial match (e.g., /admin/posts/123 → posts)
  if (!page) {
    for (const [path, pageType] of Object.entries(PAGE_MAP)) {
      if (pathname.startsWith(path + '/')) {
        page = pageType;
        matchedPath = path;
        break;
      }
    }
  }

  // Default to dashboard if on /admin
  if (!page && pathname.startsWith('/admin')) {
    page = 'dashboard';
    matchedPath = '/admin';
  }

  // Parse query params as filters
  const filters = {};
  if (search) {
    const params = new URLSearchParams(search);
    for (const [key, value] of params.entries()) {
      filters[key] = value;
    }
  }

  const meta = PAGE_META[page] || PAGE_META.dashboard;

  return {
    page,
    filters,
    pageTitle: meta.title,
    pageDescription: meta.description,
    pathname,
    matchedPath,
  };
}

/**
 * PageContextProvider — Wraps admin pages and provides context.
 */
export function PageContextProvider({ children }) {
  const location = useLocation();

  const value = useMemo(() => {
    const ctx = detectPageContext(location.pathname, location.search);
    return {
      ...ctx,
      selectedItems: [], // Could be enhanced with selection state
      url: location.pathname + location.search,
    };
  }, [location.pathname, location.search]);

  return (
    <PageContext.Provider value={value}>
      {children}
    </PageContext.Provider>
  );
}

/**
 * Hook to access page context.
 * Returns { page, filters, selectedItems, pageTitle, pageDescription, url }
 */
export function usePageContext() {
  return useContext(PageContext);
}

/**
 * Helper to build page context object for API calls.
 * Passes to v3/_stream.js as page_context parameter.
 */
export function buildPageContextForAPI(pageContext) {
  if (!pageContext?.page) return null;
  return {
    page: pageContext.page,
    filters: pageContext.filters || {},
    selectedItems: pageContext.selectedItems || [],
    pageTitle: pageContext.pageTitle,
    url: pageContext.url,
  };
}

export default PageContext;
