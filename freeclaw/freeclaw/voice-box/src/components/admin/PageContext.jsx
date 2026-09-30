import { createContext, useContext, useMemo } from "react";
import { useLocation } from "react-router";
import { ADMIN_TABS, parseAdminTab } from "../../lib/adminTabs";

const PageContext = createContext({
	page: null,
	filters: {},
	selectedItems: [],
	pageTitle: "",
	pageDescription: "",
});

const TAB_DESCRIPTIONS = {
	dashboard: "Platform overview and key metrics",
	"agent-chat": "AI Coworker conversations and action previews",
	"ops-center": "Automation registry, workforce health, and manual controls",
	"system-health": "Service health and degraded dependencies",
	performance: "Latency, throughput, and resource trends",
	security: "Security posture, incidents, and access controls",
	"activity-stream": "Operational activity and audit events",
	reports: "Content reports and moderation flags",
	posts: "Manage user submissions and issues",
	users: "User management and moderation",
	categories: "Content categories and organization",
	polls: "Poll management and results",
	inbox: "User conversations and responses",
	errors: "Application errors and incident triage",
	logs: "Activity, verification, and agent audit logs",
	"email-templates": "Transactional email templates and delivery tests",
	settings: "Platform configuration and operator preferences",
};

// Keep old path links readable while making the query tab canonical.
const LEGACY_PATH_TABS = {
	analytics: "performance",
	notifications: "inbox",
	ai: "agent-chat",
	agents: "ops-center",
	"command-center": "ops-center",
	knowledge: "activity-stream",
};

function tabFromPath(pathname) {
	if (pathname === "/admin" || pathname === "/admin/") return "dashboard";
	const segment = pathname.replace(/^\/admin\/?/, "").split("/")[0];
	return LEGACY_PATH_TABS[segment] || segment;
}

export function detectPageContext(pathname, search) {
	const params = new URLSearchParams(search || "");
	const queryTab = params.get("tab");
	const pathTab = tabFromPath(pathname);
	const page = pathname.startsWith("/admin")
		? parseAdminTab(queryTab || pathTab)
		: null;
	const filters = {};
	for (const [key, value] of params.entries()) {
		if (key !== "tab") filters[key] = value;
	}
	const tab = ADMIN_TABS.find((candidate) => candidate.key === page);
	return {
		page,
		filters,
		pageTitle: tab?.label || "",
		pageDescription: page ? TAB_DESCRIPTIONS[page] || "" : "",
		pathname,
		matchedPath: pathname.startsWith("/admin") ? "/admin" : "",
	};
}

export function PageContextProvider({ children }) {
	const location = useLocation();
	const value = useMemo(() => {
		const ctx = detectPageContext(location.pathname, location.search);
		return {
			...ctx,
			selectedItems: [],
			url: location.pathname + location.search,
		};
	}, [location.pathname, location.search]);

	return <PageContext.Provider value={value}>{children}</PageContext.Provider>;
}

export function usePageContext() {
	return useContext(PageContext);
}

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
