import type { Context, ReactNode } from "react";

export interface AdminPageContext {
	page: string | null;
	filters: Record<string, string>;
	selectedItems: unknown[];
	pageTitle: string;
	pageDescription: string;
	pathname?: string;
	matchedPath?: string;
	url?: string;
}

export function detectPageContext(
	pathname: string,
	search: string,
): AdminPageContext;

export function PageContextProvider({
	children,
}: {
	children: ReactNode;
}): JSX.Element;

export function usePageContext(): AdminPageContext;

export function buildPageContextForAPI(
	pageContext: AdminPageContext | null,
): AdminPageContext | null;

declare const PageContext: Context<AdminPageContext>;
export default PageContext;
