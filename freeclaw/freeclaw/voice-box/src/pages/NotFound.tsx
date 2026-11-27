import { ArrowRight, Compass, Home, MapPin, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

export default function NotFound() {
	const [glitch, setGlitch] = useState(false);

	useEffect(() => {
		const t = setTimeout(() => setGlitch(true), 300);
		return () => clearTimeout(t);
	}, []);

	return (
		<div className="max-w-lg mx-auto text-center py-12 sm:py-20 px-4 vb-rise">
			{/* Animated floating elements */}
			<div className="relative mb-8">
				<div className="flex items-center justify-center">
					<div className="relative">
						{/* Main 404 with gradient */}
						<p
							className="font-display font-bold text-[120px] sm:text-[160px] leading-none select-none"
							style={{
								background:
									"linear-gradient(135deg, var(--vb-accent) 0%, var(--vb-accent2) 40%, #38BDF8 70%, var(--vb-accent) 100%)",
								backgroundSize: "200% 200%",
								WebkitBackgroundClip: "text",
								backgroundClip: "text",
								color: "transparent",
								animation:
									"vb-gradient-shift 6s ease-in-out infinite",
								filter: glitch
									? "drop-shadow(0 0 40px color-mix(in srgb, var(--vb-accent) 25%, transparent))"
									: "none",
							}}
						>
							404
						</p>
						{/* Floating pin icon */}
						<div
							className="absolute -right-2 -top-2 sm:right-4 sm:top-4"
							style={{
								animation: "vb-float 3s ease-in-out infinite",
							}}
						>
							<div className="bg-surface border border-border rounded-xl p-2.5 shadow-lg">
								<MapPin
									size={22}
									className="text-accent"
									strokeWidth={2.5}
								/>
							</div>
						</div>
						{/* Orbiting dot */}
						<div
							className="absolute left-1/2 top-1/2 w-2 h-2 rounded-full bg-accent"
							style={{
								animation:
									"vb-orbit 4s linear infinite",
								transformOrigin: "0 -60px",
							}}
						/>
					</div>
				</div>
			</div>

			{/* Message */}
			<h1 className="font-display font-bold text-xl sm:text-2xl mb-3">
				This page doesn't exist
			</h1>
			<p className="text-ink2 text-sm sm:text-base max-w-sm mx-auto leading-relaxed mb-8">
				The link you followed might be broken, or the page may have
				been moved. Let's get you back on track.
			</p>

			{/* Actions */}
			<div className="flex flex-col sm:flex-row gap-3 justify-center">
				<Link to="/" className="btn btn-primary">
					<Home size={15} /> Back to feed
				</Link>
				<Link to="/board" className="btn btn-ghost">
					<Compass size={15} /> Solving board
				</Link>
				<button
					onClick={() => window.location.reload()}
					className="btn btn-ghost"
				>
					<RotateCcw size={15} /> Try again
				</button>
			</div>

			{/* Subtle hint */}
			<p className="text-xs text-ink3 mt-8 flex items-center justify-center gap-1.5">
				<ArrowRight size={12} />
				Press{" "}
				<kbd className="px-1.5 py-0.5 rounded bg-surface2 border border-border text-[10px] font-mono">
					⌘K
				</kbd>{" "}
				to search for anything
			</p>
		</div>
	);
}
