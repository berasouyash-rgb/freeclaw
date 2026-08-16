// ═══════════════════════════════════════════════════════════════════
// PreloaderScene — Three.js "invisible infrastructure" field.
// ═══════════════════════════════════════════════════════════════════
// A lightweight, GPU-friendly scene (no post-processing by default, low
// draw calls, instancing + Points) that represents the platform waking
// up — NOT an AI face, brain, or video-game.
//
//   • Central intelligence core — layered rings + inner nucleus, breathing
//   • Network nodes           — InstancedMesh dots on two orbital shells
//   • Connection paths        — thin LineSegments grown from the core
//   • Directional signals     — tiny arrow-cone heads with short trails
//   • Scanning ring           — one thin ring sweeping the field (VERIFYING)
//   • Micro-particle drift    — THREE.Points, very low opacity
//
// The factory returns a controller so the React layer can drive it and —
// critically — every GPU resource is disposed on exit. No renderer is
// left running behind the application.
// ═══════════════════════════════════════════════════════════════════

import * as THREE from "three";
import type { Quality } from "./useDeviceCapability";

export type SceneStatus =
	| "INITIALIZING"
	| "LOADING"
	| "VERIFYING"
	| "READY"
	| "REVEAL"
	| "ERROR";

export interface SceneController {
	setStatus(status: SceneStatus): void;
	dispose(): void;
	/** Diagnostics only (dev/debug mode). */
	getFrameCount(): number;
}

interface NodeDef {
	mesh: THREE.Object3D;
	baseScale: number;
	activationT: number; // 0..1 — lights up over time
	label: string;
}

interface SignalDef {
	head: THREE.Mesh; // small arrow-cone
	trail: THREE.Mesh; // short elongated glow
	from: THREE.Vector3;
	to: THREE.Vector3;
	progress: number;
	speed: number;
	delay: number;
	state: SignalState;
}

type SignalState =
	| "INCOMING"
	| "PROCESSING"
	| "VERIFYING"
	| "ROUTING"
	| "COMPLETE"
	| "ESCALATED";

const PALETTE = {
	violet: 0x7a6ff0,
	violet2: 0x9b93ff,
	cyan: 0x38e1ff,
	gold: 0xf0c040,
	rose: 0xff6b9d,
	white: 0xffffff,
} as const;

const SIGNAL_COLOR: Record<SignalState, number> = {
	INCOMING: PALETTE.cyan,
	PROCESSING: PALETTE.violet,
	VERIFYING: PALETTE.white,
	ROUTING: PALETTE.gold,
	COMPLETE: 0x63d68a,
	ESCALATED: PALETTE.rose,
};

const QUALITY_BUDGET: Record<Quality, { nodes: number; particles: number; signals: number }> = {
	HIGH: { nodes: 14, particles: 220, signals: 5 },
	MEDIUM: { nodes: 10, particles: 110, signals: 3 },
	LOW: { nodes: 6, particles: 40, signals: 1 },
};

const SIGNAL_STATES: SignalState[] = [
	"INCOMING",
	"PROCESSING",
	"ROUTING",
	"VERIFYING",
	"COMPLETE",
];

export interface PreloaderSceneOptions {
	quality?: Quality;
	reducedMotion?: boolean;
	canvas: HTMLCanvasElement;
}

export function createPreloaderScene({
	canvas,
	quality = "MEDIUM",
	reducedMotion = false,
}: PreloaderSceneOptions): SceneController | null {
	let renderer: THREE.WebGLRenderer | null = null;
	try {
		renderer = new THREE.WebGLRenderer({
			canvas,
			alpha: true,
			antialias: quality === "HIGH",
			powerPreference: "low-power",
		});
	} catch {
		return null; // WebGL truly unavailable → CSS fallback handles it
	}

	const budget = QUALITY_BUDGET[quality];
	const scene = new THREE.Scene();
	scene.fog = new THREE.FogExp2(0x080512, 0.035);

	const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 60);
	camera.position.set(0, 0, 8.5);

	// ── Central intelligence core ────────────────────────────────
	const coreGroup = new THREE.Group();
	scene.add(coreGroup);

	// Inner nucleus — soft emissive sphere
	const nucleusMat = new THREE.MeshBasicMaterial({
		color: 0xffffff,
		transparent: true,
		opacity: 0.85,
		blending: THREE.AdditiveBlending,
	});
	const nucleus = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 20), nucleusMat);
	coreGroup.add(nucleus);

	// Thin breathing halo around the nucleus
	const haloMat = new THREE.MeshBasicMaterial({
		color: PALETTE.violet,
		transparent: true,
		opacity: 0.4,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
	});
	const halo = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 24), haloMat);
	coreGroup.add(halo);

	// Two layered orbital rings (thin torus, edge-on)
	const ringGeo = new THREE.TorusGeometry(0.62, 0.004, 8, 64);
	const ringMat = new THREE.MeshBasicMaterial({
		color: PALETTE.violet2,
		transparent: true,
		opacity: 0.5,
		blending: THREE.AdditiveBlending,
	});
	const ringA = new THREE.Mesh(ringGeo, ringMat);
	ringA.rotation.x = Math.PI / 2.4;
	const ringB = new THREE.Mesh(ringGeo, ringMat.clone());
	ringB.rotation.x = Math.PI / 1.8;
	ringB.rotation.y = 0.7;
	coreGroup.add(ringA, ringB);

	// ── Network nodes (InstancedMesh on two shells) ──────────────
	const nodeCount = budget.nodes;
	const nodeGeo = new THREE.SphereGeometry(0.045, 8, 8);
	const nodeMat = new THREE.MeshBasicMaterial({
		color: PALETTE.violet2,
		transparent: true,
		opacity: 0.75,
		blending: THREE.AdditiveBlending,
	});
	const nodeInst = new THREE.InstancedMesh(nodeGeo, nodeMat, nodeCount);
	scene.add(nodeInst);

	const nodes: NodeDef[] = [];
	const nodePositions: THREE.Vector3[] = [];
	const matrix = new THREE.Matrix4();
	const pos = new THREE.Vector3();
	const quat = new THREE.Quaternion();
	const scaleVec = new THREE.Vector3(1, 1, 1);

	const nodeLabels = ["Security", "Performance", "Content", "Reports", "Reliability", "Experience", "Data", "Infrastructure"];
	const shellSizes = [2.1, 3.2];
	for (let i = 0; i < nodeCount; i++) {
		const shell = shellSizes[i % 2 === 0 ? 0 : 1] ?? 2.1;
		const angle = (i / nodeCount) * Math.PI * 2 + (i % 2) * 0.4;
		const y = (i % 3) - 1;
		pos.set(Math.cos(angle) * shell, y * 0.55, Math.sin(angle) * shell);
		nodePositions.push(pos.clone());
		matrix.compose(pos, quat, scaleVec);
		nodeInst.setMatrixAt(i, matrix);
		nodes.push({
			mesh: new THREE.Object3D(), // placeholder — instance indexed by i
			baseScale: 1,
			activationT: i / nodeCount,
			label: nodeLabels[i % nodeLabels.length] ?? "System",
		});
	}
	nodeInst.instanceMatrix.needsUpdate = true;

	// ── Connection paths: spokes core→node + a few node→node ─────
	const lineCount = nodeCount + Math.floor(nodeCount / 2);
	const linePositions = new Float32Array(lineCount * 6);
	const lineColors = new Float32Array(lineCount * 6);
	const lineGeo = new THREE.BufferGeometry();
	lineGeo.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
	lineGeo.setAttribute("color", new THREE.BufferAttribute(lineColors, 3));
	const lineMat = new THREE.LineBasicMaterial({
		vertexColors: true,
		transparent: true,
		opacity: 0.4,
		blending: THREE.AdditiveBlending,
	});
	const lines = new THREE.LineSegments(lineGeo, lineMat);
	scene.add(lines);

	const lineGrow: number[] = []; // 0..1 — how much of each segment is drawn
	const buildLines = () => {
		let li = 0;
		for (let i = 0; i < nodeCount; i++) {
			const p = nodePositions[i];
			if (!p) continue;
			// spoke: core → node
			const grow = lineGrow[li] ?? 0;
			const end = new THREE.Vector3().lerpVectors(new THREE.Vector3(0, 0, 0), p, grow);
			linePositions[li * 6] = 0;
			linePositions[li * 6 + 1] = 0;
			linePositions[li * 6 + 2] = 0;
			linePositions[li * 6 + 3] = end.x;
			linePositions[li * 6 + 4] = end.y;
			linePositions[li * 6 + 5] = end.z;
			lineColors[li * 6] = 0.6;
			lineColors[li * 6 + 1] = 0.55;
			lineColors[li * 6 + 2] = 1;
			lineColors[li * 6 + 3] = 0.3;
			lineColors[li * 6 + 4] = 0.25;
			lineColors[li * 6 + 5] = 0.7;
			li++;
		}
		// node→node links (nearest pairs)
		for (let i = 0; i < nodeCount; i += 2) {
			const a = nodePositions[i];
			const b = nodePositions[i + 1];
			if (!a || !b) continue;
			const grow = lineGrow[li] ?? 0;
			const mid = new THREE.Vector3().lerpVectors(a, b, grow);
			linePositions[li * 6] = a.x;
			linePositions[li * 6 + 1] = a.y;
			linePositions[li * 6 + 2] = a.z;
			linePositions[li * 6 + 3] = mid.x;
			linePositions[li * 6 + 4] = mid.y;
			linePositions[li * 6 + 5] = mid.z;
			lineColors[li * 6] = 0.35;
			lineColors[li * 6 + 1] = 0.3;
			lineColors[li * 6 + 2] = 0.8;
			lineColors[li * 6 + 3] = 0.2;
			lineColors[li * 6 + 4] = 0.18;
			lineColors[li * 6 + 5] = 0.6;
			li++;
		}
		const attrPos = lineGeo.attributes.position as THREE.BufferAttribute | undefined;
		const attrCol = lineGeo.attributes.color as THREE.BufferAttribute | undefined;
		if (attrPos) attrPos.needsUpdate = true;
		if (attrCol) attrCol.needsUpdate = true;
	};
	for (let i = 0; i < lineCount; i++) lineGrow.push(i === 0 ? 1 : 0.05);
	buildLines();

	// ── Directional signals (arrow-cone heads + short trails) ────
	const signalGeo = new THREE.ConeGeometry(0.055, 0.16, 6);
	const trailGeo = new THREE.CylinderGeometry(0.018, 0.03, 0.5, 6);
	const signals: SignalDef[] = [];
	for (let i = 0; i < budget.signals; i++) {
		const headMat = new THREE.MeshBasicMaterial({
			color: PALETTE.cyan,
			transparent: true,
			opacity: 0.9,
			blending: THREE.AdditiveBlending,
		});
		const trailMat = new THREE.MeshBasicMaterial({
			color: PALETTE.cyan,
			transparent: true,
			opacity: 0.35,
			blending: THREE.AdditiveBlending,
		});
		const head = new THREE.Mesh(signalGeo, headMat);
		const trail = new THREE.Mesh(trailGeo, trailMat.clone());
		head.visible = false;
		trail.visible = false;
		scene.add(head, trail);
		signals.push({
			head,
			trail,
			from: new THREE.Vector3(),
			to: new THREE.Vector3(),
			progress: 0,
			speed: 0.0004 + Math.random() * 0.0003,
			delay: i * 900,
			state: "INCOMING",
		});
	}

	// ── Micro-particle field (THREE.Points) ──────────────────────
	const particleCount = budget.particles;
	const pGeo = new THREE.BufferGeometry();
	const pPos = new Float32Array(particleCount * 3);
	for (let i = 0; i < particleCount; i++) {
		const r = 1.5 + Math.random() * 4.2;
		const theta = Math.random() * Math.PI * 2;
		const phi = Math.acos(2 * Math.random() - 1);
		pPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
		pPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.6;
		pPos[i * 3 + 2] = r * Math.cos(phi) * 0.7;
	}
	pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
	const pMat = new THREE.PointsMaterial({
		color: PALETTE.violet2,
		size: 0.03,
		transparent: true,
		opacity: 0.5,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});
	const particles = new THREE.Points(pGeo, pMat);
	scene.add(particles);

	// ── Scanning ring (VERIFYING sweep) ──────────────────────────
	const scanGeo = new THREE.RingGeometry(0.72, 0.76, 64);
	const scanMat = new THREE.MeshBasicMaterial({
		color: PALETTE.cyan,
		transparent: true,
		opacity: 0,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
		depthWrite: false,
	});
	const scanRing = new THREE.Mesh(scanGeo, scanMat);
	scene.add(scanRing);

	// ── Animation loop ───────────────────────────────────────────
	let status: SceneStatus = "INITIALIZING";
	let raf = 0;
	let frame = 0;
	let running = true;
	let lastNow = performance.now();

	const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
	const ping = (o: THREE.Object3D) => {
		const s = (o as unknown as { scale: THREE.Vector3 }).scale;
		s.set(1.6, 1.6, 1.6);
	};

	const setNodeT = (i: number, t: number) => {
		const s = 0.4 + clamp01(t) * 0.8;
		matrix.makeScale(s, s, s);
		const p = nodePositions[i];
		if (p) matrix.setPosition(p);
		nodeInst.setMatrixAt(i, matrix);
		nodeInst.instanceMatrix.needsUpdate = true;
	};

	function step(now: number) {
		if (!running) return;
		const dt = now - lastNow;
		lastNow = now;
		frame++;

		const t = now * 0.001;

		// Core breathing — subtle scale + emissive change
		const breath = 1 + Math.sin(t * 1.4) * 0.06;
		nucleus.scale.setScalar(breath);
		halo.scale.setScalar(1 + Math.sin(t * 1.1) * 0.12);
		haloMat.opacity = 0.3 + Math.sin(t * 1.1) * 0.1;
		ringA.rotation.z = t * 0.12;
		ringB.rotation.z = -t * 0.09;

		// Camera drift — almost subconscious
		camera.position.x = Math.sin(t * 0.05) * 0.25;
		camera.position.y = Math.cos(t * 0.04) * 0.18;
		camera.lookAt(0, 0, 0);

		// Node activation + line growth
		const active = status === "LOADING" || status === "VERIFYING" || status === "READY";
		for (let i = 0; i < nodeCount; i++) {
			const node = nodes[i];
			if (!node) continue;
			const target = active ? node.activationT : 0.15;
			node.activationT += (target - node.activationT) * 0.02;
			setNodeT(i, node.activationT);
			const grow = lineGrow[i];
			if (grow !== undefined) {
				lineGrow[i] = Math.min(1, grow + 0.012);
			}
		}
		buildLines();

		// Signals travel along spokes/links
		const signalCount = signals.length;
		for (let si = 0; si < signalCount; si++) {
			const sig = signals[si];
			if (!sig) continue;
			sig.delay -= dt;
			if (sig.delay > 0) {
				sig.head.visible = false;
				sig.trail.visible = false;
				continue;
			}
			// choose a new route when the previous one completed
			if (sig.progress >= 1) {
				const fromIdx = (si * 3 + frame) % Math.max(1, nodeCount);
				const toIdx = (si * 5 + frame * 2) % Math.max(1, nodeCount);
				sig.from.copy(nodePositions[fromIdx] ?? new THREE.Vector3(0, 0, 0));
				sig.to.copy(nodePositions[toIdx] ?? new THREE.Vector3(0, 0, 0));
				sig.progress = 0;
				sig.speed = 0.00045 + Math.random() * 0.00035;
				sig.state = SIGNAL_STATES[(si + Math.floor(now / 1800)) % SIGNAL_STATES.length] ?? "ROUTING";
				const color = SIGNAL_COLOR[sig.state] ?? PALETTE.cyan;
				(sig.head.material as THREE.MeshBasicMaterial).color.setHex(color);
				(sig.trail.material as THREE.MeshBasicMaterial).color.setHex(color);
				ping(sig.head);
			}
			sig.progress = Math.min(1, sig.progress + sig.speed * dt);
			const eased = sig.progress < 0.2 ? sig.progress / 0.2 : 1 - Math.pow(1 - Math.min(1, (sig.progress - 0.2) / 0.8), 2);
			const p = new THREE.Vector3().lerpVectors(sig.from, sig.to, eased);
			sig.head.position.copy(p);
			sig.trail.position.copy(p);
			// orient the arrow-cone along travel direction
			const dir = new THREE.Vector3().subVectors(sig.to, sig.from).normalize();
			sig.head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
			sig.head.visible = true;
			sig.trail.visible = true;
			const trailScale = (1 - sig.progress) * 0.9 + 0.1;
			sig.trail.scale.set(1, Math.max(0.2, trailScale), 1);
			// head ping decay
			const hs = (sig.head.scale.x + 0.985) * 0.985;
			sig.head.scale.setScalar(Math.max(1, hs));
		}

		// Particles — gentle drift
		particles.rotation.y = t * 0.008;
		particles.rotation.x = Math.sin(t * 0.006) * 0.05;

		// Scanning ring sweep during VERIFYING
		if (status === "VERIFYING") {
			scanMat.opacity = Math.min(0.5, scanMat.opacity + 0.02);
			scanRing.rotation.x = Math.PI / 2;
			scanRing.scale.setScalar(1 + Math.sin(t * 0.8) * 0.5);
		} else {
			scanMat.opacity = Math.max(0, scanMat.opacity - 0.05);
		}

		// READY → settle: bring the camera back and calm everything
		if (status === "READY" || status === "REVEAL") {
			camera.position.x *= 0.94;
			camera.position.y *= 0.94;
			nucleus.scale.setScalar(1.15);
			haloMat.opacity = 0.5;
		}

		renderer!.render(scene, camera);
		if (reducedMotion) {
			running = false; // single static frame for reduced motion
			return;
		}
		raf = requestAnimationFrame(step);
	}

	// initial frame + sizing
	const resize = () => {
		const w = canvas.clientWidth || 1;
		const h = canvas.clientHeight || 1;
		const dpr = quality === "HIGH" ? 1.5 : quality === "MEDIUM" ? 1.25 : 1;
		renderer!.setPixelRatio(Math.min(window.devicePixelRatio || 1, dpr));
		renderer!.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	};
	resize();
	window.addEventListener("resize", resize);

	// Render the first frame synchronously — guarantees an instant first
	// paint (no blank canvas) and gives reduced-motion its single static
	// frame before the loop is allowed to start.
	step(performance.now());

	return {
		setStatus(s: SceneStatus) {
			status = s;
		},
		dispose() {
			if (renderer === null) return; // idempotent — nothing to release
			running = false;
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", resize);
			nodeGeo.dispose();
			nodeMat.dispose();
			lineGeo.dispose();
			lineMat.dispose();
			signalGeo.dispose();
			trailGeo.dispose();
			pGeo.dispose();
			pMat.dispose();
			scanGeo.dispose();
			scanMat.dispose();
			ringGeo.dispose();
			ringMat.dispose();
			nucleusMat.dispose();
			haloMat.dispose();
			signals.forEach((s) => {
				const hm = s.head.material;
				const tm = s.trail.material;
				if (Array.isArray(hm)) hm.forEach((m) => m.dispose());
				else hm.dispose();
				if (Array.isArray(tm)) tm.forEach((m) => m.dispose());
				else tm.dispose();
			});
			renderer!.dispose();
			renderer = null;
		},
		getFrameCount() {
			return frame;
		},
	};
}
