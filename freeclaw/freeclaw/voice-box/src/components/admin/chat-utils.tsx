/**
 * Shared chat utility components — copied from AdminChat / UnifiedInbox
 * to eliminate ~120 lines of duplication across the two inbox surfaces.
 */

import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";

/* ── Copy-to-clipboard button ──────────────────────────────── */
export function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			/* fallback */
		}
	};
	return (
		<button
			onClick={copy}
			className="p-1.5 rounded-md hover:bg-surface2 transition-colors"
			title="Copy message"
		>
			{copied ? (
				<Check size={13} className="text-good" />
			) : (
				<Copy size={13} className="text-ink3" />
			)}
		</button>
	);
}

/* ── Download attachment ───────────────────────────────────── */
export function DownloadButton({
	url,
	filename,
}: { url: string; filename?: string }) {
	const download = async () => {
		// Scheme allowlist — defense in depth on top of the server-side
		// http(s)-only validation. Stored attachment_url is admin-rendered
		// content (anonymous users can attach to their own messages), so a
		// javascript: URL MUST never reach either the fetch below or the
		// fallback's a.href (which executes it in this origin).
		if (!/^https?:\/\//i.test(url)) return;
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const blob = await res.blob();
			const a = document.createElement("a");
			a.href = URL.createObjectURL(blob);
			a.download = filename || url.split("/").pop() || "attachment";
			a.click();
			URL.revokeObjectURL(a.href);
		} catch {
			// Fallback: open in new tab instead of relying on window.open
			// which triggers popup blockers. <a> click is user-initiated
			// context so browsers allow it.
			const a = document.createElement("a");
			a.href = url;
			a.target = "_blank";
			a.rel = "noopener";
			a.click();
		}
	};
	return (
		<button
			onClick={download}
			className="p-1.5 rounded-md hover:bg-surface2 transition-colors"
			title="Download"
		>
			<Download size={13} className="text-ink3" />
		</button>
	);
}

/* ── Quick reply templates ─────────────────────────────────── */
export const QUICK_REPLIES = [
	"Thanks for reaching out — we're looking into this now.",
	"Could you share more details (location, time, how often it happens)?",
	"This has been forwarded to the responsible staff member.",
	"Your issue has been verified and is now in progress. ✅",
	"This has been resolved — please let us know if it happens again.",
];
