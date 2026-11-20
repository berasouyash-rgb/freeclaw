import { Timer } from "lucide-react";
import { useEffect, useState } from "react";

/** Live countdown until a solved or archived post is permanently auto-deleted.
 *  ONE rule: 5 days after the post's last activity, and a comment or reaction
 *  resets the countdown (see api/_retention.js). The deadline comes from the
 *  same helper both server sweeps use, so the promise here is always enforced. */
export default function PurgeCountdown({ purgeAt }: { purgeAt: string }) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const iv = setInterval(() => setNow(Date.now()), 60000);
		return () => clearInterval(iv);
	}, []);

	const ms = +new Date(purgeAt) - now;
	if (ms <= 0) return null;
	const days = Math.floor(ms / 86400000);
	const hours = Math.floor((ms % 86400000) / 3600000);
	const label = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
	const urgentSoon = ms < 86400000;

	return (
		<span
			className="chip !text-[10px] vb-rise"
			style={
				urgentSoon
					? { color: "#dc4b4b", borderColor: "rgba(220,75,75,0.3)" }
					: undefined
			}
			title="Solved and archived posts are permanently deleted 5 days after their last activity. Any comment or reaction resets that countdown."
		>
			<Timer size={10} className={urgentSoon ? "vb-trend-bounce" : ""} />{" "}
			auto-deletes in {label}
		</span>
	);
}
