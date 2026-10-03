import {
	EyeOff,
	Fingerprint,
	KeyRound,
	Lock,
	Server,
	ShieldCheck,
	Smartphone,
	Trash2,
} from "lucide-react";
import { useApp } from "../contexts/AppContext";
import { storageWhere } from "../lib/platform";
import {
	CACHE_CLEAR_COPY,
	CONTACT_PRIVACY_COPY,
	INFRASTRUCTURE_COPY,
	LOCAL_PROFILE_COPY,
	NOTIFY_PRIVACY_COPY,
	RETENTION_COPY,
	SERVER_PII_COPY,
} from "../lib/privacyCopy";

export default function Privacy() {
	const { anonId } = useApp();
	const ITEMS = [
		{
			icon: Server,
			title: "Public content and server-side data",
			body: SERVER_PII_COPY,
		},
		{
			icon: Lock,
			title: "Optional alert contacts",
			body: NOTIFY_PRIVACY_COPY,
		},
		{
			icon: EyeOff,
			title: "Contact-form submissions",
			body: CONTACT_PRIVACY_COPY,
		},
		{
			icon: KeyRound,
			title: "On-device profile data",
			body: LOCAL_PROFILE_COPY,
		},
		{
			icon: Trash2,
			title: "Retention and deletion",
			body: RETENTION_COPY,
		},
		{
			icon: Fingerprint,
			title: "Infrastructure and request metadata",
			body: INFRASTRUCTURE_COPY,
		},
		{
			icon: Smartphone,
			title: "Clearing your browser cache",
			body: CACHE_CLEAR_COPY,
		},
	];

	return (
		<div className="max-w-2xl mx-auto">
			<div className="text-center mb-8 vb-rise">
				<span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-accent-soft text-accent mb-3">
					<ShieldCheck size={28} />
				</span>
				<h1 className="font-display font-bold text-2xl">Privacy comes first</h1>
				<p className="text-sm text-ink3 mt-2 max-w-md mx-auto">
					Voice Flow was designed so that honest feedback is completely safe.
					Here's exactly how it works.
				</p>
			</div>
			<div className="space-y-3">
				{ITEMS.map(({ icon: Icon, title, body }, i) => (
					<div
						key={title}
						className="card p-5 flex gap-4 vb-rise"
						style={{ animationDelay: `${i * 60}ms` }}
					>
						<span className="w-10 h-10 rounded-xl bg-accent-soft text-accent grid place-items-center shrink-0">
							<Icon size={19} />
						</span>
						<div>
							<h2 className="font-display font-semibold text-[15px]">
								{title}
							</h2>
							<p className="text-sm text-ink2 mt-1 leading-relaxed">{body}</p>
						</div>
					</div>
				))}
			</div>
			<div className="card p-5 mt-5 text-center bg-surface2/50">
				<p className="text-xs text-ink3">
					Your current anonymous ID (stored only {storageWhere()})
				</p>
				<code className="font-mono text-accent font-semibold">{anonId}</code>
			</div>
			<p className="text-center text-[11px] text-ink3 mt-6">
				Keyboard shortcuts: <kbd className="chip !text-[10px]">n</kbd> new post
				· <kbd className="chip !text-[10px]">g</kbd> feed ·{" "}
				<kbd className="chip !text-[10px]">a</kbd> activity ·{" "}
				<kbd className="chip !text-[10px]">t</kbd> theme ·{" "}
				<kbd className="chip !text-[10px]">/</kbd> search
			</p>
		</div>
	);
}
