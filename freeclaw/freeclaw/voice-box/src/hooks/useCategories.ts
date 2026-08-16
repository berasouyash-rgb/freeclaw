import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { CATEGORIES } from "../lib/utils";

// Dynamic category list: fetches the admin-managed /api/categories and
// falls back to the static CATEGORIES const whenever the API is missing
// or malformed, so every dropdown keeps working even offline.
export function useCategories(): string[] {
	const [cats, setCats] = useState<string[]>(CATEGORIES);

	useEffect(() => {
		let alive = true;
		try {
			api
				.get<{ categories: string[] }>("/api/categories")
				.then((d) => {
					const list = d?.categories;
					if (alive && Array.isArray(list) && list.length >= 3) {
						setCats(list.filter((c): c is string => typeof c === "string"));
					}
				})
				.catch(() => {
					/* keep defaults */
				});
		} catch {
			/* keep defaults */
		}
		return () => {
			alive = false;
		};
	}, []);

	return cats;
}
