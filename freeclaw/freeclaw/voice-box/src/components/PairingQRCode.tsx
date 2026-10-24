import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, QrCode } from "lucide-react";

interface PairingQRCodeProps {
	code: string;
	onCopy?: () => void;
}

export default function PairingQRCode({ code, onCopy }: PairingQRCodeProps) {
	const [svg, setSvg] = useState<string>("");
	const [copied, setCopied] = useState(false);

	const pairUrl = typeof window !== "undefined"
		? `${window.location.origin}${window.location.pathname}#/settings?pair=${code}`
		: `https://voice-box-psi.vercel.app/#/settings?pair=${code}`;

	useEffect(() => {
		if (!code) return;
		QRCode.toString(pairUrl, {
			type: "svg",
			margin: 1,
			color: {
				dark: "#000000",
				light: "#ffffff",
			},
			width: 160,
		})
			.then((svgString) => setSvg(svgString))
			.catch((err) => console.warn("[QRCode] generation failed:", err));
	}, [code, pairUrl]);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			onCopy?.();
			setTimeout(() => setCopied(false), 2000);
		} catch {
			/* clipboard blocked */
		}
	};

	return (
		<div className="flex flex-col sm:flex-row items-center gap-4 p-3.5 bg-surface rounded-xl border border-border/80 my-2">
			{svg ? (
				<div
					className="bg-white p-2 rounded-lg shadow-sm shrink-0 border border-border/40"
					dangerouslySetInnerHTML={{ __html: svg }}
					aria-label="Scan QR code to pair device"
				/>
			) : (
				<div className="w-[160px] h-[160px] bg-surface2/50 rounded-lg flex items-center justify-center text-ink3 text-xs shrink-0">
					<QrCode size={24} className="animate-pulse" />
				</div>
			)}

			<div className="flex-1 text-center sm:text-left min-w-0">
				<div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs font-semibold text-accent mb-1 uppercase tracking-wider">
					<QrCode size={13} />
					<span>Instant Camera / App Pair</span>
				</div>
				<p className="text-xs text-ink3 mb-2 leading-relaxed">
					Scan this code with your phone camera or app to link devices in 1 second without logging in.
				</p>
				<div className="inline-flex items-center gap-2 bg-surface2/60 px-3 py-1.5 rounded-lg border border-border">
					<span className="font-mono text-base font-bold tracking-[0.25em] text-ink">
						{code}
					</span>
					<button
						type="button"
						onClick={handleCopy}
						className="btn btn-ghost !p-1 text-ink3 hover:text-ink transition-colors"
						title="Copy code"
					>
						{copied ? <Check size={14} className="text-good" /> : <Copy size={14} />}
					</button>
				</div>
			</div>
		</div>
	);
}
