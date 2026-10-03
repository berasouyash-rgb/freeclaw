import {
	AlertTriangle,
	Bot,
	Bug,
	Command,
	Flag,
	Inbox,
	LayoutDashboard,
	Mail,
	Settings as SettingsIcon,
	Table2,
	Tag,
	Users,
	UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type AdminTabKey =
	| "dashboard"
	| "reports"
	| "posts"
	| "users"
	| "categories"
	| "polls"
	| "slang"
	| "communities"
	| "inbox"
	| "errors"
	| "logs"
	| "email-templates"
	| "ai-systems"
	| "settings";

export type RetiredAdminTabKey =
	| "agent-chat"
	| "ops-center"
	| "system-health"
	| "performance"
	| "security"
	| "activity-stream"
	| "work";

export interface AdminTab {
	key: AdminTabKey;
	label: string;
	icon: LucideIcon;
}

export interface AdminTabGroup {
	title: string;
	tabs: AdminTab[];
}

export const ADMIN_TAB_GROUPS: AdminTabGroup[] = [
	{
		title: "Overview",
		tabs: [
			{ key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
		],
	},
	{
		title: "Content",
		tabs: [
			{ key: "reports", label: "Reports", icon: Flag },
			{ key: "posts", label: "Feed", icon: Table2 },
			{ key: "users", label: "Users", icon: Users },
			{ key: "categories", label: "Categories", icon: Tag },
			{ key: "polls", label: "Polls", icon: Command },
			{ key: "slang", label: "Slang", icon: AlertTriangle },
			{ key: "communities", label: "Communities", icon: UsersRound },
		],
	},
	{
		title: "Operations",
		tabs: [
			{ key: "inbox", label: "Inbox", icon: Inbox },
			{ key: "errors", label: "Errors", icon: Bug },
			{ key: "logs", label: "Logs", icon: Mail },
			{ key: "email-templates", label: "Email", icon: Mail },
			{ key: "ai-systems", label: "AI Systems", icon: Bot },
		],
	},
	{
		title: "Configuration",
		tabs: [{ key: "settings", label: "Settings", icon: SettingsIcon }],
	},
];

export const ADMIN_TABS: AdminTab[] = ADMIN_TAB_GROUPS.flatMap(
	(group) => group.tabs,
);

export const ADMIN_TAB_KEYS: AdminTabKey[] = ADMIN_TABS.map((tab) => tab.key);

export const RETIRED_ADMIN_TAB_KEYS: ReadonlySet<RetiredAdminTabKey> =
	new Set([
		"agent-chat",
		"ops-center",
		"system-health",
		"performance",
		"security",
		"activity-stream",
		"work",
	]);

const ADMIN_TAB_KEY_SET = new Set<AdminTabKey>(ADMIN_TAB_KEYS);

function normalizeValue(value: string | null | undefined): string {
	return String(value ?? "")
		.replace(/^\?/, "")
		.trim()
		.toLowerCase()
		.replace(/^tab=/, "");
}

export function normalizeAdminTab(
	value: string | null | undefined,
): { tab: AdminTabKey; retired: boolean } {
	const candidate = normalizeValue(value);
	if (RETIRED_ADMIN_TAB_KEYS.has(candidate as RetiredAdminTabKey)) {
		return { tab: "dashboard", retired: true };
	}
	if (ADMIN_TAB_KEY_SET.has(candidate as AdminTabKey)) {
		return { tab: candidate as AdminTabKey, retired: false };
	}
	return { tab: "dashboard", retired: false };
}

export function parseAdminTab(value: string | null | undefined): AdminTabKey {
	return normalizeAdminTab(value).tab;
}

export function adminTabHref(tab: AdminTabKey): string {
	return `/admin?tab=${tab}`;
}
