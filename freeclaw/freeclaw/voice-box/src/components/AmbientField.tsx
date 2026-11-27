import { useEffect, useRef } from "react";

/**
 * Ambient studio environment: three slow light fields, fine film grain and a
 * restrained dust layer that drifts behind the content. The light follows the
 * pointer on desktop. Everything is CSS transforms / one canvas and is fully
 * disabled for reduced-motion users.
 */
export default function AmbientField() {
	const ref = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const root = ref.current;
		const canvas = canvasRef.current;
		if (!root || !canvas) return;
		if (import.meta.env.MODE === "test") return;
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		let frame = 0;
		let particles: { x: number; y: number; vx: number; vy: number; r: number; a: number }[] = [];
		let w = 0;
		let h = 0;

		const resize = () => {
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			w = root.clientWidth;
			h = root.clientHeight;
			canvas.width = Math.max(1, Math.round(w * dpr));
			canvas.height = Math.max(1, Math.round(h * dpr));
			canvas.style.width = `${w}px`;
			canvas.style.height = `${h}px`;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			const count = w < 700 ? 16 : 34;
			particles = Array.from({ length: count }, (_, i) => ({
				x: (i * 137.5) % Math.max(w, 1),
				y: (i * 89.3) % Math.max(h, 1),
				vx: ((i % 5) - 2) * 0.045,
				vy: -0.03 - (i % 3) * 0.018,
				r: 0.6 + (i % 4) * 0.35,
				a: 0.08 + (i % 5) * 0.022,
			}));
		};

		let isVisible = true;
		const tick = () => {
			if (!isVisible || document.hidden) {
				frame = 0;
				return;
			}
			ctx.clearRect(0, 0, w, h);

			// Render organic atmospheric particles & subtle proximity links
			for (let i = 0; i < particles.length; i++) {
				const p = particles[i];
				if (!p) continue;
				p.x += p.vx;
				p.y += p.vy;
				if (p.y < -5) p.y = h + 5;
				if (p.x < -5) p.x = w + 5;
				if (p.x > w + 5) p.x = -5;

				ctx.beginPath();
				ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(99, 102, 241, ${p.a * 0.5})`;
				ctx.fill();

				// Delicate constellation strands
				for (let j = i + 1; j < particles.length; j++) {
					const p2 = particles[j];
					if (!p2) continue;
					const dx = p.x - p2.x;
					const dy = p.y - p2.y;
					const dist = Math.sqrt(dx * dx + dy * dy);
					if (dist < 65) {
						ctx.beginPath();
						ctx.moveTo(p.x, p.y);
						ctx.lineTo(p2.x, p2.y);
						ctx.strokeStyle = `rgba(99, 102, 241, ${(1 - dist / 65) * 0.1})`;
						ctx.lineWidth = 0.6;
						ctx.stroke();
					}
				}
			}
			frame = requestAnimationFrame(tick);
		};

		const observer = new IntersectionObserver(([entry]) => {
			isVisible = entry?.isIntersecting ?? true;
			if (isVisible && !frame && !document.hidden) {
				frame = requestAnimationFrame(tick);
			}
		}, { threshold: 0.05 });
		observer.observe(root);

		const onVisibility = () => {
			if (!document.hidden && isVisible && !frame) {
				frame = requestAnimationFrame(tick);
			}
		};
		document.addEventListener("visibilitychange", onVisibility);

		const onPointer = (e: PointerEvent) => {
			const rect = root.getBoundingClientRect();
			root.style.setProperty("--light-x", `${e.clientX - rect.left}px`);
			root.style.setProperty("--light-y", `${e.clientY - rect.top}px`);
		};

		resize();
		tick();
		window.addEventListener("resize", resize);
		window.addEventListener("pointermove", onPointer, { passive: true });
		return () => {
			if (frame) cancelAnimationFrame(frame);
			observer.disconnect();
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("resize", resize);
			window.removeEventListener("pointermove", onPointer);
		};
	}, []);

	return (
		<div ref={ref} className="ambient-field" aria-hidden="true">
			<span className="ambient-glow ambient-glow--one" />
			<span className="ambient-glow ambient-glow--two" />
			<span className="ambient-glow ambient-glow--pointer" />
			<span className="ambient-grain" />
			<canvas ref={canvasRef} className="ambient-dust" />
		</div>
	);
}
