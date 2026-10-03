/**
 * Report root-issue grouping (spec §24: duplicate / recurring issues).
 *
 * Twenty students reporting "Water cooler broken" must read as ONE root
 * issue with impact 20 — not 20 disconnected rows. This groups open report
 * rows by their target (type + id), so the queue shows consequences and
 * scale instead of "normal reports only".
 *
 * Pure + total: no backend call, no fabricated rows. Groups with a single
 * report are omitted — singletons keep rendering in the normal queue.
 */

export interface GroupableReport {
	id: number | string;
	target_id: string;
	target_type: string;
	reason: string;
	status?: string;
	author_id?: string;
	created_at: string;
	worker_action?: {
		enforced?: boolean;
		disposition?: string | null;
		action?: string;
	} | null;
	[k: string]: unknown;
}

export interface ReportGroup {
	key: string;
	target_type: string;
	target_id: string;
	count: number;
	report_ids: Array<number | string>;
	reasons: string[];
	reporters: number;
	first_at: string;
	latest_at: string;
	urgent: boolean;
	enforced: boolean;
}

function isUrgent(r: GroupableReport): boolean {
	return (
		r.target_type === "inbox" &&
		typeof r.reason === "string" &&
		r.reason.startsWith("[INBOX-URGENT]")
	);
}

export function groupReports(reports: GroupableReport[]): ReportGroup[] {
	const byKey = new Map<string, GroupableReport[]>();
	for (const r of reports || []) {
		if (r == null || !r.target_id) continue;
		const key = `${r.target_type || "unknown"}:${r.target_id}`;
		const list = byKey.get(key);
		if (list) list.push(r);
		else byKey.set(key, [r]);
	}
	const groups: ReportGroup[] = [];
	for (const [key, rows] of byKey) {
		if (rows.length < 2) continue; // singletons stay in the normal queue
		const first = rows[0] as GroupableReport;
		const reasons: string[] = [];
		const reporters = new Set<string>();
		let firstAt = first.created_at || "";
		let latestAt = first.created_at || "";
		let urgent = false;
		let enforced = false;
		for (const r of rows) {
			if (r.reason && !reasons.includes(r.reason) && reasons.length < 3)
				reasons.push(r.reason);
			if (r.author_id) reporters.add(String(r.author_id));
			if (r.created_at) {
				if (!firstAt || r.created_at < firstAt) firstAt = r.created_at;
				if (!latestAt || r.created_at > latestAt) latestAt = r.created_at;
			}
			if (isUrgent(r)) urgent = true;
			if (r.worker_action?.enforced) enforced = true;
		}
		groups.push({
			key,
			target_type: String(first.target_type || "unknown"),
			target_id: String(first.target_id),
			count: rows.length,
			report_ids: rows.map((r) => r.id),
			reasons,
			reporters: reporters.size,
			first_at: firstAt,
			latest_at: latestAt,
			urgent,
			enforced,
		});
	}
	groups.sort(
		(a, b) => b.count - a.count || b.latest_at.localeCompare(a.latest_at),
	);
	return groups;
}
