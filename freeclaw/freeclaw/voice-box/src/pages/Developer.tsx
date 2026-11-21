import {
	Activity,
	ArrowLeft,
	Award,
	BookOpen,
	Check,
	CheckCircle2,
	ChevronRight,
	Code2,
	Compass,
	Copy,
	Cpu,
	ExternalLink,
	Eye,
	Flame,
	Heart,
	Layers,
	Lock,
	Maximize2,
	Play,
	RefreshCw,
	ShieldCheck,
	Sparkles,
	Terminal,
	Volume2,
	VolumeX,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { StaticFooter } from "../components/visual/PolicyVisuals";
import AmbientField from "../components/AmbientField";
import KineticText, { SignatureName } from "../components/KineticText";
import { triggerHaptic } from "../lib/haptics";

// ── Web Audio Synth for subtle interactive feedback ───────────────────────────
let sharedAudioCtx: AudioContext | null = null;
function getSharedAudioContext(): AudioContext | null {
	try {
		if (!sharedAudioCtx && typeof window !== "undefined") {
			const AudioContextClass =
				window.AudioContext ||
				(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			if (AudioContextClass) {
				sharedAudioCtx = new AudioContextClass();
			}
		}
		if (sharedAudioCtx && sharedAudioCtx.state === "suspended") {
			sharedAudioCtx.resume().catch(() => undefined);
		}
		return sharedAudioCtx;
	} catch {
		return null;
	}
}

function playUiSound(type: "click" | "success" | "key" | "tab" | "hover") {
	try {
		const ctx = getSharedAudioContext();
		if (!ctx) return;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.connect(gain);
		gain.connect(ctx.destination);

		const now = ctx.currentTime;
		if (type === "click") {
			osc.frequency.setValueAtTime(440, now);
			osc.frequency.exponentialRampToValueAtTime(880, now + 0.04);
			gain.gain.setValueAtTime(0.06, now);
			gain.gain.linearRampToValueAtTime(0.001, now + 0.04);
			osc.start(now);
			osc.stop(now + 0.04);
		} else if (type === "tab") {
			osc.frequency.setValueAtTime(520, now);
			osc.frequency.exponentialRampToValueAtTime(660, now + 0.06);
			gain.gain.setValueAtTime(0.05, now);
			gain.gain.linearRampToValueAtTime(0.001, now + 0.06);
			osc.start(now);
			osc.stop(now + 0.06);
		} else if (type === "hover") {
			osc.frequency.setValueAtTime(320, now);
			osc.frequency.exponentialRampToValueAtTime(360, now + 0.03);
			gain.gain.setValueAtTime(0.02, now);
			gain.gain.linearRampToValueAtTime(0.001, now + 0.03);
			osc.start(now);
			osc.stop(now + 0.03);
		} else if (type === "success") {
			osc.frequency.setValueAtTime(440, now);
			osc.frequency.setValueAtTime(554.37, now + 0.06);
			osc.frequency.setValueAtTime(659.25, now + 0.12);
			gain.gain.setValueAtTime(0.07, now);
			gain.gain.linearRampToValueAtTime(0.001, now + 0.22);
			osc.start(now);
			osc.stop(now + 0.22);
		} else if (type === "key") {
			osc.type = "sine";
			osc.frequency.setValueAtTime(320 + Math.random() * 80, now);
			gain.gain.setValueAtTime(0.03, now);
			gain.gain.linearRampToValueAtTime(0.001, now + 0.03);
			osc.start(now);
			osc.stop(now + 0.03);
		}
	} catch {
		// AudioContext disallowed or unavailable in environment
	}
}

// ── Full-Paragraph Kinetic Typography (GSAP scroll-scrubbed engine) ──────────
interface KineticParagraphProps {
	text: string;
	className?: string;
	highlightWords?: string[];
	gradientWords?: string[];
	variant?: "display" | "role" | "body" | "quote" | "eyebrow";
	as?: "h1" | "h2" | "p" | "blockquote" | "span" | "div";
}

/** Art-directed wrapper around the reusable KineticText engine. */
function KineticParagraph({
	text,
	className = "",
	highlightWords = [],
	gradientWords = [],
	variant = "body",
	as = "p",
}: KineticParagraphProps) {
	return (
		<KineticText
			text={text}
			as={as}
			variant={variant}
			className={className}
			highlightWords={highlightWords}
			gradientWords={gradientWords}
		/>
	);
}

// ── Milestone Story Definitions ──────────────────────────────────────────────
interface StoryMilestone {
	id: string;
	number: string;
	label: string;
	title: string;
	summary: string;
	quote?: string;
	details: string[];
	tags: string[];
}

const MILESTONES: StoryMilestone[] = [
	{
		id: "the-person",
		number: "01",
		label: "The Creator",
		title: "The Person Behind VoiceFlow",
		summary: "I'm a young independent developer and aspiring AI engineer from Class 7B who believes impactful ideas don't require expensive labs — they start with observing real human needs.",
		quote: "Technology should never be built to impress developers; it must be built to empower people.",
		details: [
			"I'm currently a student in Class 7B, but my curiosity stretches far beyond conventional school curricula. I spend my free time architecting distributed systems, diving into artificial intelligence, understanding cryptographic primitives, and crafting user-first interfaces.",
			"I don't limit myself to simply reading documentation or observing from the sidelines. I believe in learning by breaking things, writing thousands of lines of code, and turning abstract ideas into reliable, shipping software.",
			"I consider myself an eternal apprentice. I don't pretend to know everything — there is a universe of computing I have yet to explore. But having the courage to experiment independently and improve continuously is what defines my craft.",
		],
		tags: ["Class 7B Student", "Independent Builder", "Self-Taught", "AI Explorer"],
	},
	{
		id: "the-why",
		number: "02",
		label: "The Motivation",
		title: "Why I Built VoiceFlow",
		summary: "Schools are where young minds spend formative years, yet countless genuine concerns remain unspoken due to the fear of judgment or retaliation.",
		quote: "What if every student could express what they genuinely feel about their school without being afraid of speaking up?",
		details: [
			"In every hallway, students encounter issues — broken facilities, mental health pressures, peer conflicts, and constructive suggestions for academic improvement.",
			"Yet traditional suggestion boxes sit empty or are ignored. Students fear that speaking up will expose their identities or result in reprimands. Meanwhile, sincere feedback gets lost in noise.",
			"I realized the problem wasn't a lack of student opinions; it was the lack of a modern, mathematically anonymous, and trustworthy channel to communicate them directly to decision-makers.",
		],
		tags: ["Student Voice", "Safe Expression", "Democracy in Schools", "Constructive Feedback"],
	},
	{
		id: "the-architecture",
		number: "03",
		label: "The Innovation",
		title: "How the Idea Came to Life",
		summary: "I didn't want another bloated school app. I built a zero-knowledge anonymous platform with AI pattern clustering and automated escalation.",
		details: [
			"VoiceFlow was born as a dual-sided ecosystem: an airtight anonymous posting feed for students, paired with an intelligent command center for administrators.",
			"I introduced client-side cryptographic salting so that not even platform engineers can connect an anonymous submission back to an individual student's device.",
			"Rather than treating AI as a gimmicky chatbot, I designed it to categorize unstructured complaints, detect sentiment trends, filter genuine safety risks, and summarize key community priorities for school principals.",
		],
		tags: ["Client-Side Hashing", "Zero Identity Leak", "AI Categorization", "Admin Insights"],
	},
	{
		id: "the-vision",
		number: "04",
		label: "The Impact",
		title: "What I Want VoiceFlow to Achieve",
		summary: "Fostering a transparent, empathetic culture where student agency is respected and institutional leadership listens with humility.",
		quote: "Your voice. Real action.",
		details: [
			"My vision for VoiceFlow is to prove that youth-driven engineering can solve real institutional trust deficits.",
			"Anonymity alone is not enough; it must be balanced with responsible guardrails that prevent toxicity and encourage collaborative problem-solving.",
			"When students see that reporting a broken library computer or suggesting a new club leads to visible administrative response within days, cynicism turns into civic responsibility.",
		],
		tags: ["Civic Agency", "Institutional Trust", "Transparent Progress", "Accountability"],
	},
	{
		id: "the-craft",
		number: "05",
		label: "Engineering Philosophy",
		title: "My Approach to Building Software",
		summary: "Software architecture is not just syntax; it is empathy, accessibility, rigorous testing, and relentless optimization.",
		details: [
			"I obsess over the details: sub-50ms render latency, zero layout shifts, fluid spring physics on mobile touch targets, and strict keyboard navigation.",
			"VoiceFlow maintains over 2,600 automated tests across frontend and API layers, guaranteeing zero regression and unbreakable security policies.",
			"Building software as a young developer taught me that humility in accepting bug reports and discipline in automated verification separate toys from production-grade tools.",
		],
		tags: ["2,600+ Tests", "Sub-50ms Latency", "A11y Compliant", "Fluid Spring Physics"],
	},
	{
		id: "beyond",
		number: "06",
		label: "Future Horizons",
		title: "Beyond VoiceFlow",
		summary: "VoiceFlow is milestone one. My long-term roadmap focuses on autonomous agent architectures, local AI edge computing, and human-centric software.",
		details: [
			"I am fascinated by where developer tooling and agentic systems are heading. I experiment daily with multimodal models, local inference on edge hardware, and autonomous code synthesis.",
			"My ambition is to build products that eliminate bureaucratic friction and solve real-world problems for students, educators, and creators worldwide.",
			"The journey of mastering computer science and artificial intelligence is vast. I am just getting started.",
		],
		tags: ["Autonomous Agents", "Edge Computing", "Applied AI", "Next-Gen Products"],
	},
];

// ── Interactive Skills Data ──────────────────────────────────────────────────
interface TechSkill {
	name: string;
	category: "frontend" | "backend" | "ai" | "core";
	level: number;
	roleInVoiceFlow: string;
	icon: string;
}

const TECH_STACK: TechSkill[] = [
	{ name: "React 19 & TypeScript", category: "frontend", level: 98, roleInVoiceFlow: "Type-safe UI architecture, custom hooks, zero any-types", icon: "⚛️" },
	{ name: "Tailwind CSS & Framer", category: "frontend", level: 96, roleInVoiceFlow: "Design token system, fluid spring gestures, responsive dock", icon: "🎨" },
	{ name: "Supabase & Postgres", category: "backend", level: 94, roleInVoiceFlow: "Row-level security, realtime channels, idempotent migrations", icon: "🐘" },
	{ name: "Node.js & Edge Functions", category: "backend", level: 92, roleInVoiceFlow: "Rate limiting, CORS guards, cryptographically signed sessions", icon: "🟢" },
	{ name: "Web Crypto & SHA-256", category: "core", level: 95, roleInVoiceFlow: "Client-side salted anonymity tokens with zero identity leakage", icon: "🔒" },
	{ name: "AI Agent Tool Registry", category: "ai", level: 91, roleInVoiceFlow: "41 verified tools with schema validation and failover chains", icon: "🤖" },
	{ name: "Vitest & Playwright", category: "core", level: 95, roleInVoiceFlow: "2,639 backend tests + 2,370+ UI assertions with CI automation", icon: "🧪" },
	{ name: "Vite 7 & Turbopack", category: "core", level: 93, roleInVoiceFlow: "81 optimized code-split chunks, sub-second hot module reload", icon: "⚡" },
];

export default function Developer() {
	// Sound state
	const [soundOn, setSoundOn] = useState(false);
	const sound = useCallback(
		(type: "click" | "success" | "key" | "tab" | "hover") => {
			if (soundOn) playUiSound(type);
		},
		[soundOn],
	);

	// Navigation & Milestones
	const [activeMilestoneId, setActiveMilestoneId] = useState<string>("the-person");
	const activeMilestone: StoryMilestone = useMemo(
		() => MILESTONES.find((m) => m.id === activeMilestoneId) ?? MILESTONES[0]!,
		[activeMilestoneId],
	);

	// Interactive Sandbox State
	const [sandboxTab, setSandboxTab] = useState<"crypto" | "ai" | "poll">("crypto");
	
	// Sandbox: Crypto Simulator
	const [cryptoInput, setCryptoInput] = useState("Class lockers need repairs");
	const [saltEntropy, setSaltEntropy] = useState(32);
	const [copiedHash, setCopiedHash] = useState(false);
	const [simulatedHash, setSimulatedHash] = useState("anon_7a2f••••910b");

	useEffect(() => {
		let active = true;
		const compute = async () => {
			try {
				if (typeof window !== "undefined" && window.crypto?.subtle) {
					const enc = new TextEncoder();
					const salt = `voiceflow-salt-${saltEntropy}-entropy-2026`;
					const data = enc.encode(`${cryptoInput}:${salt}`);
					const hashBuf = await window.crypto.subtle.digest("SHA-256", data);
					const hashArr = Array.from(new Uint8Array(hashBuf));
					const hex = hashArr.map((b) => b.toString(16).padStart(2, "0")).join("");
					if (active) {
						setSimulatedHash(`anon_${hex.slice(0, 4)}••••${hex.slice(4, 10)}`);
					}
					return;
				}
			} catch {
				// Fallback to FNV if crypto.subtle is unavailable
			}
			let h = 0x811c9dc5;
			const str = `${cryptoInput}:${saltEntropy}:voiceflow-salt-2026`;
			for (let i = 0; i < str.length; i++) {
				h ^= str.charCodeAt(i);
				h = Math.imul(h, 0x01000193);
			}
			const hex = (h >>> 0).toString(16).padStart(8, "0");
			if (active) {
				setSimulatedHash(`anon_${hex.slice(0, 4)}••••${hex.slice(4)}`);
			}
		};
		compute();
		return () => {
			active = false;
		};
	}, [cryptoInput, saltEntropy]);

	// Sandbox: AI Moderation Simulator
	const [aiInput, setAiInput] = useState("The chemistry lab equipment is broken and unsafe");
	const [analyzingAi, setAnalyzingAi] = useState(false);
	const [aiResult, setAiResult] = useState<{
		toxicity: number;
		urgency: string;
		category: string;
		constructive: number;
	}>({
		toxicity: 0.02,
		urgency: "High",
		category: "Lab & Science Facilities",
		constructive: 0.94,
	});

	const handleRunAiAnalysis = () => {
		setAnalyzingAi(true);
		sound("click");
		setTimeout(() => {
			const lower = aiInput.toLowerCase();
			const isUrgent = lower.includes("unsafe") || lower.includes("broken") || lower.includes("bully");
			const isToxic = lower.includes("hate") || lower.includes("stupid") || lower.includes("idiot");
			setAiResult({
				toxicity: isToxic ? 0.88 : 0.03,
				urgency: isUrgent ? "High" : "Normal",
				category: lower.includes("lab") ? "Science & Labs" : lower.includes("food") ? "Cafeteria" : "General School Life",
				constructive: isToxic ? 0.12 : 0.96,
			});
			setAnalyzingAi(false);
			sound("success");
		}, 380);
	};

	// Sandbox: Live Poll Simulator
	const [pollVotes, setPollVotes] = useState({ yes: 48, no: 6, needInfo: 14 });
	const [userVoted, setUserVoted] = useState<string | null>(null);

	const handleVote = (choice: "yes" | "no" | "needInfo") => {
		sound("click");
		triggerHaptic("light");
		if (userVoted === choice) return;
		setPollVotes((prev) => ({
			...prev,
			[choice]: prev[choice] + 1,
			...(userVoted ? { [userVoted]: Math.max(0, prev[userVoted as keyof typeof prev] - 1) } : {}),
		}));
		setUserVoted(choice);
	};

	// Interactive Terminal State
	const [terminalCommands, setTerminalCommands] = useState<
		Array<{ input: string; output: string | React.ReactNode }>
	>([
		{
			input: "whoami",
			output: "Souyash Bera · Class 7B Student · Full-Stack & AI Builder · Creator of VoiceFlow",
		},
		{
			input: "stats",
			output: "🚀 VoiceFlow v2.0.3 | 2,639 API tests passed | 81 optimized chunks | Zero identity leakage",
		},
	]);
	const [terminalHistory, setTerminalHistory] = useState<string[]>([]);
	const [historyIndex, setHistoryIndex] = useState<number>(-1);
	const [terminalInput, setTerminalInput] = useState("");
	const terminalBottomRef = useRef<HTMLDivElement>(null);

	const executeTerminal = (cmd: string) => {
		const raw = cmd.trim().toLowerCase();
		if (!raw) return;
		sound("key");
		setTerminalHistory((prev) => [...prev, cmd]);
		setHistoryIndex(-1);
		let response: React.ReactNode = "";

		switch (raw) {
			case "help":
				response = (
					<div className="space-y-1 text-slate-300">
						<p className="text-accent font-semibold">Available Commands:</p>
						<p><span className="text-emerald-400">whoami</span> — Display bio and credentials</p>
						<p><span className="text-emerald-400">skills</span> — List core engineering proficiencies</p>
						<p><span className="text-emerald-400">projects</span> — Authentic shipping applications</p>
						<p><span className="text-emerald-400">voiceflow</span> — VoiceFlow architecture breakdown</p>
						<p><span className="text-emerald-400">stats</span> — Automated test counts and build metrics</p>
						<p><span className="text-emerald-400">philosophy</span> — Core development principles</p>
						<p><span className="text-emerald-400">contact</span> — Reach out directly</p>
						<p><span className="text-emerald-400">clear</span> — Reset terminal window</p>
					</div>
				);
				break;
			case "whoami":
				response = "Souyash Bera · Young Independent Developer & Aspiring AI Engineer · Class 7B. Building tech with purpose.";
				break;
			case "skills":
				response = (
					<div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
						<div>⚛️ React 19 / TypeScript (98%)</div>
						<div>🎨 Tailwind / Framer Motion (96%)</div>
						<div>🐘 Supabase / PostgreSQL (94%)</div>
						<div>🔒 Client Web Crypto / Zero-Knowledge (95%)</div>
						<div>🤖 AI Agent Tooling / LLM Moderation (91%)</div>
						<div>🧪 Vitest & E2E Verification (95%)</div>
					</div>
				);
				break;
			case "projects":
				response = (
					<div className="space-y-1 text-xs text-slate-300">
						<div>1. VoiceFlow (Production School Platform, 2.6k tests)</div>
						<div>2. RCB Ultimate Cricket OS (Real-time Tactical Engine)</div>
						<div>3. AI Cinematic Visual Studio (Multi-modal Video Synth)</div>
						<div>4. Nexus Robotics & Automation Engine</div>
					</div>
				);
				break;
			case "voiceflow":
				response = "VoiceFlow: Anonymous student empowerment platform. Dual architecture: student mobile client + admin intelligence center with 41 AI agent tools.";
				break;
			case "stats":
				response = "2,639 backend API tests passing ✓ | 2,370+ UI assertions ✓ | 81 production chunks ✓ | Zero live secret leakage ✓";
				break;
			case "philosophy":
				response = '"Your voice. Real action." — Technology must serve human trust, not vanity metrics.';
				break;
			case "contact":
				response = "Email: souyash@voiceflow.org · GitHub: github.com/souyash · Built with love for real student communities.";
				break;
			case "clear":
				setTerminalCommands([]);
				setTerminalInput("");
				return;
			default:
				response = `Unknown command '${raw}'. Type 'help' for available commands.`;
		}

		setTerminalCommands((prev) => [...prev.slice(-39), { input: cmd, output: response }]);
		setTerminalInput("");
		setTimeout(() => {
			terminalBottomRef.current?.scrollIntoView({ behavior: "smooth" });
		}, 50);
	};

	const handleTerminalKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "ArrowUp") {
			e.preventDefault();
			if (!terminalHistory.length) return;
			const nextIdx = historyIndex === -1 ? terminalHistory.length - 1 : Math.max(0, historyIndex - 1);
			setHistoryIndex(nextIdx);
			setTerminalInput(terminalHistory[nextIdx] ?? "");
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			if (historyIndex === -1) return;
			const nextIdx = historyIndex + 1;
			if (nextIdx >= terminalHistory.length) {
				setHistoryIndex(-1);
				setTerminalInput("");
			} else {
				setHistoryIndex(nextIdx);
				setTerminalInput(terminalHistory[nextIdx] ?? "");
			}
		}
	};

	// Copy contact toast
	const [copiedEmail, setCopiedEmail] = useState(false);
	const handleCopyEmail = () => {
		navigator.clipboard.writeText("souyash@voiceflow.org");
		setCopiedEmail(true);
		sound("success");
		triggerHaptic("medium");
		setTimeout(() => setCopiedEmail(false), 2200);
	};

	// Tech Stack Filter
	const [techFilter, setTechFilter] = useState<"all" | "frontend" | "backend" | "ai" | "core">("all");
	const filteredTech = useMemo(
		() => (techFilter === "all" ? TECH_STACK : TECH_STACK.filter((t) => t.category === techFilter)),
		[techFilter],
	);

	// Quick dynamic role cycler
	const [roleIndex, setRoleIndex] = useState(0);
	const ROLES = useMemo(
		() => [
			"Creator of VoiceFlow",
			"Class 7B Independent Developer",
			"Aspiring AI Engineer",
			"Student Agency Advocate",
			"Full-Stack Architect",
		],
		[],
	);

	useEffect(() => {
		const interval = setInterval(() => {
			setRoleIndex((i) => (i + 1) % ROLES.length);
		}, 3200);
		return () => clearInterval(interval);
	}, [ROLES.length]);

	return (
		<div className="relative min-h-screen bg-[#fcfbfe] dark:bg-[#0a0b12] text-slate-900 dark:text-slate-100 selection:bg-[#5652d6] selection:text-white transition-colors duration-500 overflow-x-hidden">
			{/* ── Ambient studio lighting, grain and drifting dust ──────────── */}
			<AmbientField />

			{/* ── Top Navigation Bar ─────────────────────────────────────────── */}
			<header className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 dark:bg-[#0a0b12]/80 border-b border-slate-200/80 dark:border-white/10 transition-colors">
				<div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
					<div className="flex items-center gap-3">
						<Link
							to="/"
							onClick={() => sound("click")}
							className="group flex items-center gap-2.5 text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
						>
							<div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 grid place-items-center group-hover:scale-105 transition-transform">
								<ArrowLeft size={15} />
							</div>
							<span className="hidden sm:inline">Back to VoiceFlow</span>
						</Link>
						<span className="text-slate-300 dark:text-slate-700">|</span>
						<div className="flex items-center gap-2">
							<span className="w-2.5 h-2.5 rounded-full bg-[#5652d6] animate-pulse" />
							<span className="font-display font-bold text-sm tracking-tight">Souyash Bera</span>
						</div>
					</div>

					{/* Fast Jump Anchors */}
					<nav className="hidden md:flex items-center gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-full border border-slate-200/60 dark:border-white/10 text-xs font-semibold text-slate-600 dark:text-slate-300">
						<a href="#overview" onClick={() => sound("tab")} className="px-3 py-1.5 rounded-full hover:bg-white dark:hover:bg-white/10 transition-colors">Signature</a>
						<a href="#beliefs" onClick={() => sound("tab")} className="px-3 py-1.5 rounded-full hover:bg-white dark:hover:bg-white/10 transition-colors">Beliefs</a>
						<a href="#projects" onClick={() => sound("tab")} className="px-3 py-1.5 rounded-full hover:bg-white dark:hover:bg-white/10 transition-colors">Projects</a>
						<a href="#sandbox" onClick={() => sound("tab")} className="px-3 py-1.5 rounded-full hover:bg-white dark:hover:bg-white/10 transition-colors">Sandbox</a>
						<a href="#terminal" onClick={() => sound("tab")} className="px-3 py-1.5 rounded-full hover:bg-white dark:hover:bg-white/10 transition-colors">Terminal</a>
						<a href="#journey" onClick={() => sound("tab")} className="px-3 py-1.5 rounded-full hover:bg-white dark:hover:bg-white/10 transition-colors">Story</a>
						<a href="#contact" onClick={() => sound("tab")} className="px-3 py-1.5 rounded-full hover:bg-white dark:hover:bg-white/10 transition-colors">Contact</a>
					</nav>

					{/* Sound & Action Button */}
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => {
								setSoundOn((s) => !s);
								if (!soundOn) playUiSound("success");
							}}
							title={soundOn ? "Mute interactive audio feedback" : "Enable interactive audio feedback"}
							className={`p-2 rounded-xl text-xs flex items-center gap-1.5 border transition-all ${
								soundOn
									? "bg-[#5652d6]/10 border-[#5652d6]/40 text-[#5652d6] dark:text-[#8b85f5]"
									: "bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 hover:text-slate-800 dark:hover:text-white"
							}`}
							aria-label="Toggle UI sounds"
						>
							{soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
							<span className="hidden sm:inline font-medium text-[11px]">{soundOn ? "Audio On" : "Muted"}</span>
						</button>
						<button
							type="button"
							onClick={handleCopyEmail}
							className="btn btn-primary !py-1.5 !px-3 text-xs flex items-center gap-1.5 shadow-sm"
						>
							{copiedEmail ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}
							<span>{copiedEmail ? "Copied!" : "Connect"}</span>
						</button>
					</div>
				</div>
			</header>

			{/* ── SECTION A: Signature Oversized SOUYASH BERA Typography & Hero ─── */}
			<section id="overview" className="relative pt-12 pb-20 md:pt-20 md:pb-28 overflow-hidden z-10">
				{/* Studio Ambient Spotlight */}
				<div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] bg-gradient-to-tr from-[#5652d6]/25 via-[#8b5cf6]/20 to-[#38bdf8]/15 rounded-full blur-[110px] pointer-events-none" />

				<div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
					{/* Live Studio Status Pill */}
					<div className="flex justify-center lg:justify-start mb-6">
						<div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-white/90 dark:bg-white/5 border border-slate-200/90 dark:border-white/10 shadow-xs text-xs font-semibold text-slate-700 dark:text-slate-300 backdrop-blur-md">
							<span className="relative flex h-2 w-2">
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
								<span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
							</span>
							<span>Independent Digital Creator & AI Explorer</span>
							<span className="text-slate-300 dark:text-slate-700">•</span>
							<span className="text-accent font-bold">Class 7B Creator</span>
						</div>
					</div>

					<div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-14 items-center">
						{/* Left: Oversized Typography & Interactive Role */}
						<div className="lg:col-span-7 space-y-6 text-center lg:text-left">
							{/* The SOUYASH BERA Visual Signature */}
							<div className="space-y-1 select-none">
								<p className="text-xs sm:text-sm font-bold uppercase tracking-[0.35em] text-slate-400 dark:text-slate-500">
									Digital Portfolio Experience
								</p>
								<h1 className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-tight leading-[0.98] text-slate-900 dark:text-white">
									<span className="block text-slate-400 dark:text-slate-500 font-light text-3xl sm:text-5xl lg:text-6xl mb-1">
										Hi, I&apos;m
									</span>
									<SignatureName />
								</h1>
							</div>

							{/* Dynamic Interactive Role Cycler */}
							<div className="h-10 sm:h-12 flex items-center justify-center lg:justify-start">
								<AnimatePresence mode="wait">
									<motion.div
										key={roleIndex}
										initial={{ opacity: 0, y: 14 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: -14 }}
										transition={{ duration: 0.3, ease: "easeOut" }}
										className="inline-flex items-center gap-2 text-lg sm:text-2xl font-bold text-accent dark:text-[#a89dff]"
									>
										<Sparkles size={20} className="text-[#ec4899]" />
										<span>{ROLES[roleIndex]}</span>
									</motion.div>
								</AnimatePresence>
							</div>

							{/* Full-Paragraph Kinetic Typography Introduction */}
							<KineticParagraph
								text="I build purposeful software that solves real institutional problems. VoiceFlow was born from a simple belief: every student deserves a fearless voice, protected by mathematics and elevated by intelligent systems."
								highlightWords={["purposeful", "software", "voiceflow", "fearless", "voice", "mathematics", "intelligent"]}
								gradientWords={["voiceflow", "fearless", "intelligent"]}
								className="text-base sm:text-lg max-w-xl mx-auto lg:mx-0"
							/>

							{/* High-Impact Stat Pills */}
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
								<div className="p-3.5 rounded-2xl bg-white/90 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 shadow-xs backdrop-blur-md">
									<div className="text-2xl font-black text-accent">Class 7B</div>
									<div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-0.5">Grade Level</div>
								</div>
								<div className="p-3.5 rounded-2xl bg-white/90 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 shadow-xs backdrop-blur-md">
									<div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">2,639+</div>
									<div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-0.5">Automated Tests</div>
								</div>
								<div className="p-3.5 rounded-2xl bg-white/90 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 shadow-xs backdrop-blur-md">
									<div className="text-2xl font-black text-violet-600 dark:text-violet-400">41</div>
									<div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-0.5">AI Tools Built</div>
								</div>
								<div className="p-3.5 rounded-2xl bg-white/90 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 shadow-xs backdrop-blur-md">
									<div className="text-2xl font-black text-amber-600 dark:text-amber-400">Zero</div>
									<div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-0.5">Identity Leaks</div>
								</div>
							</div>

							{/* Call-to-actions */}
							<div className="flex flex-wrap items-center justify-center lg:justify-start gap-3 pt-2">
								<a
									href="#projects"
									onClick={() => sound("click")}
									className="btn btn-primary !py-2.5 !px-5 text-sm font-semibold flex items-center gap-2 shadow-md shadow-accent/20"
								>
									<Eye size={16} /> Explore Projects
								</a>
								<a
									href="#sandbox"
									onClick={() => sound("click")}
									className="btn btn-ghost !py-2.5 !px-4 text-sm font-semibold flex items-center gap-2 border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-sm"
								>
									<Play size={15} fill="currentColor" /> Interactive Sandbox
								</a>
								<a
									href="#terminal"
									onClick={() => sound("click")}
									className="btn btn-ghost !py-2.5 !px-4 text-sm font-semibold flex items-center gap-2 border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-sm"
								>
									<Terminal size={15} /> Open Terminal
								</a>
							</div>
						</div>

						{/* Right: Authentic Photograph Composition with Organic Mask */}
						<div className="lg:col-span-5 flex justify-center">
							<div className="relative w-full max-w-sm group">
								{/* Ambient Atmospheric Halo */}
								<div className="absolute -inset-4 rounded-3xl bg-gradient-to-tr from-[#5652d6]/40 via-[#8b5cf6]/30 to-[#ec4899]/30 blur-2xl opacity-60 group-hover:opacity-90 transition-opacity duration-500" />

								{/* Portrait Card */}
								<div className="relative rounded-3xl overflow-hidden bg-white dark:bg-[#12141c] border-2 border-white/70 dark:border-white/15 shadow-2xl transition-all duration-500 group-hover:shadow-[0_25px_60px_rgba(86,82,214,0.35)]">
									<div className="aspect-[4/5] w-full overflow-hidden relative">
										<img
											src="/creator/hero-portrait.jpg"
											alt="Souyash Bera, Creator of VoiceFlow"
											className="w-full h-full object-cover object-[center_18%] transition-transform duration-700 group-hover:scale-105"
											onError={(e) => {
												(e.target as HTMLImageElement).src = "/creator/souyash-portrait.jpg";
											}}
										/>
										{/* Glass Gradient Scrim */}
										<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-6 pt-20 text-white">
											<div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#a89dff]">
												<Sparkles size={14} /> Founder & Engineer
											</div>
											<h3 className="text-2xl font-bold mt-1">Souyash Bera</h3>
											<p className="text-xs text-slate-300 mt-0.5">
												Class 7B · Kolkata, India · Building for schools
											</p>
										</div>
									</div>

									{/* Bottom Quick Bar */}
									<div className="p-3.5 bg-slate-50 dark:bg-white/5 border-t border-slate-100 dark:border-white/10 flex items-center justify-between text-xs font-semibold">
										<span className="text-slate-500 dark:text-slate-400">Architecture:</span>
										<span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
											<span className="w-2 h-2 rounded-full bg-emerald-500" /> v2.0.3 Verified
										</span>
									</div>
								</div>

								{/* Floating Pill Badges */}
								<div className="absolute -top-3 -right-3 bg-white dark:bg-[#1a1c29] border border-slate-200 dark:border-white/15 rounded-full px-3.5 py-1.5 shadow-lg flex items-center gap-2 text-xs font-bold text-accent transition-transform motion-safe:hover:-translate-y-0.5">
									<ShieldCheck size={14} /> 100% Cryptographic Anonymity
								</div>
								<div className="absolute -bottom-4 -left-3 bg-white dark:bg-[#1a1c29] border border-slate-200 dark:border-white/15 rounded-full px-3.5 py-1.5 shadow-lg flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200 transition-transform motion-safe:hover:-translate-y-0.5">
									<Code2 size={14} className="text-[#ec4899]" /> 41 Automated AI Tools
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* ── SECTION B: Personal Introduction & The Core Statement ─────────── */}
			<section id="beliefs" className="py-20 bg-white/70 dark:bg-[#0e0f1a]/80 backdrop-blur-md border-y border-slate-200/80 dark:border-white/10 relative z-10">
				<div className="max-w-4xl mx-auto px-4 sm:px-6 text-center space-y-6">
					<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent font-bold text-xs uppercase tracking-wider">
						<Heart size={14} /> The Creative Conviction
					</div>

					<KineticParagraph
						as="blockquote"
						variant="quote"
						text="“I'm curious about technology, fascinated by possibilities and constantly experimenting with ideas.”"
						highlightWords={["curious", "technology", "fascinated", "experimenting"]}
						gradientWords={["possibilities", "ideas"]}
						className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-snug"
					/>

					{/* Full-Paragraph Kinetic Engine applied to the core manifesto */}
					<div className="pt-4 max-w-2xl mx-auto">
						<KineticParagraph
							text="I consider myself a learner and a builder. I don't pretend to know everything, and I don't pretend to have every answer. But I believe that the hunger to experiment, question assumptions, learn independently, and continuously refine is what turns an observation into a working reality."
							highlightWords={["learner", "builder", "experiment", "question", "independently", "refine", "reality"]}
							gradientWords={["builder", "reality"]}
							className="text-base sm:text-lg text-center justify-center text-slate-600 dark:text-slate-300"
						/>
					</div>
				</div>
			</section>

			{/* ── SECTION C: About Me & Photographic Dual Composition ──────────── */}
			<section className="py-20 bg-slate-50/50 dark:bg-[#0c0d15]/50 relative z-10">
				<div className="max-w-6xl mx-auto px-4 sm:px-6">
					<div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
						{/* Dual Photographic Editorial Collage */}
						<div className="lg:col-span-5 grid grid-cols-2 gap-4">
							<div className="space-y-4">
								<div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 shadow-md">
									<img
										src="/souyash-bera.jpeg"
										alt="Souyash Bera Editorial Portrait"
										className="w-full aspect-[3/4] object-cover object-[center_20%]"
										onError={(e) => {
											(e.target as HTMLImageElement).src = "/creator/souyash-portrait.jpg";
										}}
									/>
								</div>
								<div className="p-3 rounded-xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-center">
									<span className="text-[11px] font-bold text-accent">Kolkata, India</span>
								</div>
							</div>
							<div className="space-y-4 pt-8">
								<div className="p-3 rounded-xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-center">
									<span className="text-[11px] font-bold text-emerald-500">Student & Engineer</span>
								</div>
								<div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 shadow-md">
									<img
										src="/creator/souyash-portrait-bw.jpg"
										alt="Souyash Bera Monochrome Editorial Portrait"
										className="w-full aspect-[3/4] object-cover object-[center_20%]"
										onError={(e) => {
											(e.target as HTMLImageElement).src = "/creator/hero-portrait.jpg";
										}}
									/>
								</div>
							</div>
						</div>

						{/* Editorial Text Story */}
						<div className="lg:col-span-7 space-y-5">
							<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent font-bold text-xs uppercase tracking-wider">
								<Compass size={14} /> Beyond the Classroom
							</div>
							<KineticParagraph
								as="h2"
								variant="display"
								text="The Intersection of Curiosity & Code"
								highlightWords={["curiosity", "code"]}
								gradientWords={["curiosity"]}
								className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white"
							/>

							<KineticParagraph
								text="I don't believe that building applications is simply about writing syntax or decorating screens. A product needs a clear user experience, thoughtful design, reliable functionality, and a deep understanding of the people who rely on it every day."
								highlightWords={["syntax", "screens", "thoughtful", "reliable", "functionality", "rely"]}
								gradientWords={["thoughtful", "reliable"]}
								className="text-base sm:text-lg text-slate-600 dark:text-slate-300"
							/>

							<p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed font-normal">
								I pay relentless attention to the microscopic details: how an interface breathes, how easily someone navigates when stressed, whether an automated AI tool genuinely accelerates triage, and whether the platform honors its security contracts 100% of the time.
							</p>

							<div className="pt-2 flex flex-wrap gap-2">
								{["Curiosity Driven", "Human-Centric AI", "Zero-Knowledge Math", "High Velocity Iteration"].map((pill) => (
									<span
										key={pill}
										className="px-3 py-1.5 rounded-full text-xs font-semibold bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300"
									>
										✓ {pill}
									</span>
								))}
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* ── SECTION D: My Creative World (4 Distinct Domains) ─────────────── */}
			<section className="py-20 bg-white dark:bg-[#10121d] border-y border-slate-200/80 dark:border-white/10 relative z-10">
				<div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-12">
					<div className="text-center max-w-2xl mx-auto space-y-2">
						<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent font-bold text-xs uppercase tracking-wider">
							<Flame size={14} /> Creative Universe
						</div>
						<KineticParagraph
							as="h2"
							variant="display"
							text="My Creative World"
							highlightWords={["creative", "world"]}
							gradientWords={["creative"]}
							className="text-3xl sm:text-4xl font-black"
						/>
						<KineticParagraph
							text="Four distinct creative disciplines where I test hypotheses, invent systems, and ship real code."
							highlightWords={["creative", "hypotheses", "systems", "code"]}
							gradientWords={["invent", "code"]}
							className="text-slate-600 dark:text-slate-400 text-sm sm:text-base"
						/>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
						{/* Domain 1: AI */}
						<div className="p-6 rounded-3xl bg-slate-50 dark:bg-[#161826] border border-slate-200 dark:border-white/10 space-y-4 hover:border-accent transition-all group shadow-sm hover:shadow-xl">
							<div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-[#5652d6] grid place-items-center text-xl font-bold group-hover:scale-110 transition-transform">
								🤖
							</div>
							<h3 className="text-lg font-bold">Artificial Intelligence</h3>
							<p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
								Autonomous tool registries, zero-hallucination agent architectures, automated multi-class report categorization, and prompt evaluation frameworks.
							</p>
							<div className="text-xs font-mono font-semibold text-accent">41 Agent Tools Built</div>
						</div>

						{/* Domain 2: Systems Architecture */}
						<div className="p-6 rounded-3xl bg-slate-50 dark:bg-[#161826] border border-slate-200 dark:border-white/10 space-y-4 hover:border-emerald-500 transition-all group shadow-sm hover:shadow-xl">
							<div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-500 grid place-items-center text-xl font-bold group-hover:scale-110 transition-transform">
								⚡
							</div>
							<h3 className="text-lg font-bold">Software Engineering</h3>
							<p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
								React 19, strict TypeScript without any-escapes, sub-second HMR with Vite, idempotent PostgreSQL migrations, and 2,639 automated tests.
							</p>
							<div className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">99.8% Test Rigor</div>
						</div>

						{/* Domain 3: Cryptography */}
						<div className="p-6 rounded-3xl bg-slate-50 dark:bg-[#161826] border border-slate-200 dark:border-white/10 space-y-4 hover:border-violet-500 transition-all group shadow-sm hover:shadow-xl">
							<div className="w-12 h-12 rounded-2xl bg-violet-500/10 text-violet-500 grid place-items-center text-xl font-bold group-hover:scale-110 transition-transform">
								🔒
							</div>
							<h3 className="text-lg font-bold">Privacy Primitives</h3>
							<p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
								Client-side Web Crypto salting, HMAC school verification tokens, and zero-knowledge student anonymity guarantees.
							</p>
							<div className="text-xs font-mono font-semibold text-violet-600 dark:text-violet-400">Zero Identity Leaks</div>
						</div>

						{/* Domain 4: Creative Analytics & Simulators */}
						<div className="p-6 rounded-3xl bg-slate-50 dark:bg-[#161826] border border-slate-200 dark:border-white/10 space-y-4 hover:border-pink-500 transition-all group shadow-sm hover:shadow-xl">
							<div className="w-12 h-12 rounded-2xl bg-pink-500/10 text-pink-500 grid place-items-center text-xl font-bold group-hover:scale-110 transition-transform">
								🏏
							</div>
							<h3 className="text-lg font-bold">Simulation & Sports OS</h3>
							<p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
								Real-time cricket match predictive engines, statistical momentum modeling, and rich interactive game-day dashboards.
							</p>
							<div className="text-xs font-mono font-semibold text-pink-500">RCB Ultimate OS 2026</div>
						</div>
					</div>
				</div>
			</section>

			{/* ── SECTION E: Project Showcase (The Crown Jewel) ─────────────────── */}
			<section id="projects" className="py-20 bg-[#f8f9fc] dark:bg-[#0a0b12] relative z-10">
				<div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-12">
					<div className="text-center max-w-2xl mx-auto space-y-2">
						<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent font-bold text-xs uppercase tracking-wider">
							<Award size={14} /> Shipping Software
						</div>
						<KineticParagraph
							as="h2"
							variant="display"
							text="Featured Projects"
							highlightWords={["featured", "projects"]}
							gradientWords={["featured"]}
							className="text-3xl sm:text-4xl font-black"
						/>
						<p className="text-slate-600 dark:text-slate-400 text-sm sm:text-base">
							Authentic applications designed, architected, and coded by Souyash Bera.
						</p>
					</div>

					{/* Project 1: VoiceFlow Featured Card */}
					<div className="rounded-3xl bg-white dark:bg-[#131522] border border-slate-200 dark:border-white/10 p-6 sm:p-10 shadow-xl overflow-hidden relative group">
						<div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
							<div className="lg:col-span-7 space-y-5">
								<div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent">
									<span className="w-2 h-2 rounded-full bg-accent" /> Flagship Platform · v2.0.3
								</div>
								<h3 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
									VoiceFlow: Anonymous Student Empowerment
								</h3>
								<p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
									A dual-sided institutional platform connecting students and school administrators. Combines client-side zero-knowledge salted hashing for unbreakable anonymity with an AI command center featuring 41 automated triage and sentiment analysis tools.
								</p>

								{/* Tech Tags */}
								<div className="flex flex-wrap gap-2 pt-1">
									{["React 19", "TypeScript", "Tailwind CSS", "Supabase", "Web Crypto", "41 AI Tools", "2,639 Tests"].map((t) => (
										<span key={t} className="px-3 py-1 rounded-full text-xs font-mono font-semibold bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300">
											{t}
										</span>
									))}
								</div>

								{/* Action Buttons */}
								<div className="flex flex-wrap items-center gap-3 pt-2">
									<Link
										to="/"
										onClick={() => sound("click")}
										className="btn btn-primary !py-2.5 !px-5 text-xs sm:text-sm font-semibold flex items-center gap-2 shadow-sm"
									>
										<Maximize2 size={15} /> Open Live Feed
									</Link>
									<a
										href="#sandbox"
										onClick={() => sound("click")}
										className="btn btn-ghost !py-2.5 !px-4 text-xs sm:text-sm font-semibold flex items-center gap-2 border border-slate-200 dark:border-white/10"
									>
										<Play size={14} fill="currentColor" /> Test Interactive Sandbox Below
									</a>
								</div>
							</div>

							{/* Right: Architecture Metric Badge Grid */}
							<div className="lg:col-span-5 grid grid-cols-2 gap-3">
								<div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200/80 dark:border-white/10">
									<div className="text-xs font-semibold text-slate-400">Total API Tests</div>
									<div className="text-2xl font-black text-emerald-500 mt-1">2,639</div>
									<div className="text-[11px] text-slate-500 mt-0.5">Automated CI Suite</div>
								</div>
								<div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200/80 dark:border-white/10">
									<div className="text-xs font-semibold text-slate-400">UI Assertions</div>
									<div className="text-2xl font-black text-accent mt-1">2,370+</div>
									<div className="text-[11px] text-slate-500 mt-0.5">Component Coverage</div>
								</div>
								<div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200/80 dark:border-white/10">
									<div className="text-xs font-semibold text-slate-400">AI Agent Tools</div>
									<div className="text-2xl font-black text-violet-500 mt-1">41</div>
									<div className="text-[11px] text-slate-500 mt-0.5">Schema Validated</div>
								</div>
								<div className="p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200/80 dark:border-white/10">
									<div className="text-xs font-semibold text-slate-400">Bundle Chunks</div>
									<div className="text-2xl font-black text-pink-500 mt-1">81</div>
									<div className="text-[11px] text-slate-500 mt-0.5">Code-Split Output</div>
								</div>
							</div>
						</div>
					</div>

					{/* Secondary Projects Grid: RCB OS & AI Documentary */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						{/* RCB OS Card */}
						<div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-[#131522] border border-slate-200 dark:border-white/10 shadow-lg space-y-4 hover:border-[#ec4899] transition-all">
							<div className="flex items-center justify-between text-xs font-bold text-[#ec4899] uppercase tracking-wider">
								<span>Sports Analytics & Simulation</span>
								<span>2026 Engine</span>
							</div>
							<h4 className="text-2xl font-black text-slate-900 dark:text-white">
								RCB Ultimate Cricket Operating System
							</h4>
							<p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
								A comprehensive match tactical command center and predictive engine. Features player momentum models, team hub analytics, real-time strategy recommendations, and an exhaustive God Mode operational playbook.
							</p>
							<div className="flex flex-wrap gap-2 text-xs font-mono">
								<span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400">Match Sim</span>
								<span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400">Tactical Hub</span>
								<span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400">Player Modeling</span>
							</div>
							<div className="pt-2">
								<span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
									Repository asset · Verified standalone application
								</span>
							</div>
						</div>

						{/* AI Cinematic Studio Card */}
						<div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-[#131522] border border-slate-200 dark:border-white/10 shadow-lg space-y-4 hover:border-[#38bdf8] transition-all">
							<div className="flex items-center justify-between text-xs font-bold text-[#38bdf8] uppercase tracking-wider">
								<span>Multimodal Video Synthesizer</span>
								<span>Generative Visuals</span>
							</div>
							<h4 className="text-2xl font-black text-slate-900 dark:text-white">
								AI Cinematic Visual Studio & Frame Engine
							</h4>
							<p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
								Automated video frame synthesis and documentary production system. Integrates 3D camera kinematics, kinetic typography overlays, procedural visual transitions, and intelligent scene pacing.
							</p>
							<div className="flex flex-wrap gap-2 text-xs font-mono">
								<span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400">Kinetic Text</span>
								<span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400">WebGL & Canvas</span>
								<span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400">Procedural 3D</span>
							</div>
							<div className="pt-2">
								<span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
									Creative lab asset · In-house visual tooling
								</span>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* ── SECTION: Live Interactive Sandbox (Test What Souyash Built) ──── */}
			<section id="sandbox" className="py-20 bg-white dark:bg-[#10121d] border-y border-slate-200/80 dark:border-white/10 relative z-10">
				<div className="max-w-6xl mx-auto px-4 sm:px-6">
					<div className="text-center max-w-2xl mx-auto mb-10 space-y-3">
						<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent font-bold text-xs uppercase tracking-wider">
							<Cpu size={14} /> Interactive Experience
						</div>
						<h2 className="text-3xl sm:text-4xl font-black tracking-tight">
							Live VoiceFlow Architecture Sandbox
						</h2>
						<p className="text-slate-600 dark:text-slate-400 text-sm sm:text-base">
							Don&apos;t just read about code — test the actual algorithms and interaction models designed by Souyash right in your browser.
						</p>
					</div>

					{/* Sandbox Container */}
					<div className="rounded-3xl bg-slate-50 dark:bg-[#161826] border border-slate-200 dark:border-white/10 overflow-hidden shadow-xl">
						{/* Mode Switcher Tabs */}
						<div
							role="tablist"
							aria-label="Interactive sandbox modes"
							className="flex border-b border-slate-200 dark:border-white/10 bg-slate-100/60 dark:bg-white/5 p-1.5 gap-1.5 overflow-x-auto"
						>
							<button
								type="button"
								role="tab"
								id="tab-crypto"
								aria-selected={sandboxTab === "crypto"}
								aria-controls="panel-crypto"
								tabIndex={sandboxTab === "crypto" ? 0 : -1}
								onKeyDown={(e) => {
									if (e.key === "ArrowRight") {
										e.preventDefault();
										setSandboxTab("ai");
										sound("tab");
										document.getElementById("tab-ai")?.focus();
									} else if (e.key === "ArrowLeft") {
										e.preventDefault();
										setSandboxTab("poll");
										sound("tab");
										document.getElementById("tab-poll")?.focus();
									}
								}}
								onClick={() => {
									setSandboxTab("crypto");
									sound("tab");
								}}
								className={`flex-1 min-w-[160px] py-2.5 px-4 rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all ${
									sandboxTab === "crypto"
										? "bg-white dark:bg-[#5652d6] text-accent dark:text-white shadow-sm"
										: "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
								}`}
							>
								<Lock size={16} /> 1. Anonymity Engine
							</button>
							<button
								type="button"
								role="tab"
								id="tab-ai"
								aria-selected={sandboxTab === "ai"}
								aria-controls="panel-ai"
								tabIndex={sandboxTab === "ai" ? 0 : -1}
								onKeyDown={(e) => {
									if (e.key === "ArrowRight") {
										e.preventDefault();
										setSandboxTab("poll");
										sound("tab");
										document.getElementById("tab-poll")?.focus();
									} else if (e.key === "ArrowLeft") {
										e.preventDefault();
										setSandboxTab("crypto");
										sound("tab");
										document.getElementById("tab-crypto")?.focus();
									}
								}}
								onClick={() => {
									setSandboxTab("ai");
									sound("tab");
								}}
								className={`flex-1 min-w-[160px] py-2.5 px-4 rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all ${
									sandboxTab === "ai"
										? "bg-white dark:bg-[#5652d6] text-accent dark:text-white shadow-sm"
										: "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
								}`}
							>
								<Sparkles size={16} /> 2. AI Moderation Tester
							</button>
							<button
								type="button"
								role="tab"
								id="tab-poll"
								aria-selected={sandboxTab === "poll"}
								aria-controls="panel-poll"
								tabIndex={sandboxTab === "poll" ? 0 : -1}
								onKeyDown={(e) => {
									if (e.key === "ArrowRight") {
										e.preventDefault();
										setSandboxTab("crypto");
										sound("tab");
										document.getElementById("tab-crypto")?.focus();
									} else if (e.key === "ArrowLeft") {
										e.preventDefault();
										setSandboxTab("ai");
										sound("tab");
										document.getElementById("tab-ai")?.focus();
									}
								}}
								onClick={() => {
									setSandboxTab("poll");
									sound("tab");
								}}
								className={`flex-1 min-w-[160px] py-2.5 px-4 rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all ${
									sandboxTab === "poll"
										? "bg-white dark:bg-[#5652d6] text-accent dark:text-white shadow-sm"
										: "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
								}`}
							>
								<Activity size={16} /> 3. Live Poll Simulator
							</button>
						</div>

						{/* Tab 1: Crypto Simulator */}
						{sandboxTab === "crypto" && (
							<div
								role="tabpanel"
								id="panel-crypto"
								aria-labelledby="tab-crypto"
								className="p-6 sm:p-8 space-y-6"
							>
								<div className="space-y-1">
									<h3 className="text-lg font-bold">Client-Side Anonymity & Zero Identity Leakage</h3>
									<p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
										Type any student confession or issue. Watch how salted hashing isolates your device token before transmission to the server.
									</p>
								</div>

								<div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
									<div className="space-y-4">
										<div>
											<label htmlFor="crypto-input" className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wider">
												Simulated Student Feedback
											</label>
											<input
												id="crypto-input"
												type="text"
												maxLength={140}
												value={cryptoInput}
												onChange={(e) => {
													setCryptoInput(e.target.value);
													sound("key");
												}}
												placeholder="Type student concern..."
												className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-[#0f111a] border border-slate-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
											/>
										</div>

										<div>
											<div className="flex justify-between text-xs font-semibold mb-1 text-slate-600 dark:text-slate-400">
												<label htmlFor="entropy-slider">Cryptographic Salt Entropy</label>
												<span className="font-mono text-accent">{saltEntropy} bits</span>
											</div>
											<input
												id="entropy-slider"
												type="range"
												min={16}
												max={64}
												value={saltEntropy}
												onChange={(e) => {
													setSaltEntropy(Number(e.target.value));
													sound("key");
												}}
												className="w-full accent-accent"
											/>
										</div>
									</div>

									{/* Output Result Card */}
									<div className="p-5 rounded-2xl bg-white dark:bg-[#0f111a] border border-slate-200 dark:border-white/10 space-y-3 font-mono">
										<div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-100 dark:border-white/5 pb-2">
											<span>TRANSMITTED TICKET ID:</span>
											<span className="text-emerald-500 font-bold">VERIFIED ANONYMOUS</span>
										</div>
										<div className="text-xl sm:text-2xl font-bold text-accent break-all select-all">
											{simulatedHash}
										</div>
										<div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-sans">
											✓ Student Device Identity: <strong>Striped client-side</strong><br />
											✓ School Affiliation Proof: <strong>Preserved via HMAC</strong><br />
											✓ Database Traceability: <strong>Mathematically impossible</strong>
										</div>
										<button
											type="button"
											onClick={() => {
												navigator.clipboard.writeText(simulatedHash);
												setCopiedHash(true);
												sound("success");
												setTimeout(() => setCopiedHash(false), 2000);
											}}
											className="btn btn-ghost !py-1.5 !px-3 text-xs w-full flex items-center justify-center gap-1.5 border border-slate-200 dark:border-white/10"
										>
											{copiedHash ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
											{copiedHash ? "Hash Token Copied!" : "Copy Anonymous Token"}
										</button>
									</div>
								</div>
							</div>
						)}

						{/* Tab 2: AI Moderation Simulator */}
						{sandboxTab === "ai" && (
							<div
								role="tabpanel"
								id="panel-ai"
								aria-labelledby="tab-ai"
								className="p-6 sm:p-8 space-y-6"
							>
								<div className="space-y-1">
									<h3 className="text-lg font-bold">Real-Time School AI Moderation & Categorization</h3>
									<p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
										Souyash architected 41 AI safety and triage tools to parse student reports instantly without human bias.
									</p>
								</div>

								<div className="space-y-4">
									<div className="flex gap-2">
										<input
											type="text"
											maxLength={240}
											value={aiInput}
											onChange={(e) => {
												setAiInput(e.target.value);
												sound("key");
											}}
											placeholder="Enter sample report..."
											className="flex-1 px-4 py-2.5 rounded-xl bg-white dark:bg-[#0f111a] border border-slate-200 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
										/>
										<button
											type="button"
											onClick={handleRunAiAnalysis}
											disabled={analyzingAi}
											className="btn btn-primary !py-2.5 !px-5 text-xs sm:text-sm font-semibold flex items-center gap-2 shrink-0"
										>
											{analyzingAi ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
											Analyze Post
										</button>
									</div>

									{/* Preset Suggestion Chips */}
									<div className="flex flex-wrap items-center gap-1.5 text-xs">
										<span className="text-slate-400 text-[11px] font-semibold">Presets:</span>
										<button
											type="button"
											onClick={() => {
												setAiInput("Broken desks and chairs in room 204");
												sound("tab");
											}}
											className="px-2.5 py-1 rounded-full bg-slate-200/70 dark:bg-white/10 hover:bg-slate-300 transition-colors"
										>
											Infra Issue
										</button>
										<button
											type="button"
											onClick={() => {
												setAiInput("Feeling overwhelmed with physics exam schedule");
												sound("tab");
											}}
											className="px-2.5 py-1 rounded-full bg-slate-200/70 dark:bg-white/10 hover:bg-slate-300 transition-colors"
										>
											Mental Well-being
										</button>
										<button
											type="button"
											onClick={() => {
												setAiInput("Can we have a badminton club after school?");
												sound("tab");
											}}
											className="px-2.5 py-1 rounded-full bg-slate-200/70 dark:bg-white/10 hover:bg-slate-300 transition-colors"
										>
											New Club Suggestion
										</button>
									</div>

									{/* AI Telemetry Meter Gauges */}
									<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
										<div className="p-4 rounded-2xl bg-white dark:bg-[#0f111a] border border-slate-200 dark:border-white/10">
											<div className="text-xs font-semibold text-slate-500">Toxicity Score</div>
											<div className="text-xl font-bold mt-1 text-slate-900 dark:text-white">
												{(aiResult.toxicity * 100).toFixed(0)}%
											</div>
											<div className={`text-[10px] font-bold uppercase mt-1 ${aiResult.toxicity < 0.2 ? "text-emerald-500" : "text-rose-500"}`}>
												{aiResult.toxicity < 0.2 ? "Safe for Campus" : "Flagged for Review"}
											</div>
										</div>

										<div className="p-4 rounded-2xl bg-white dark:bg-[#0f111a] border border-slate-200 dark:border-white/10">
											<div className="text-xs font-semibold text-slate-500">Urgency Level</div>
											<div className={`text-xl font-bold mt-1 ${aiResult.urgency === "High" ? "text-amber-500" : "text-slate-700 dark:text-slate-300"}`}>
												{aiResult.urgency}
											</div>
											<div className="text-[10px] font-semibold text-slate-400 mt-1">Escalation Priority</div>
										</div>

										<div className="p-4 rounded-2xl bg-white dark:bg-[#0f111a] border border-slate-200 dark:border-white/10">
											<div className="text-xs font-semibold text-slate-500">Detected Category</div>
											<div className="text-sm font-bold mt-1 text-accent truncate">
												{aiResult.category}
											</div>
											<div className="text-[10px] font-semibold text-slate-400 mt-1">Auto-routed department</div>
										</div>

										<div className="p-4 rounded-2xl bg-white dark:bg-[#0f111a] border border-slate-200 dark:border-white/10">
											<div className="text-xs font-semibold text-slate-500">Constructive Agency</div>
											<div className="text-xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
												{(aiResult.constructive * 100).toFixed(0)}%
											</div>
											<div className="text-[10px] font-semibold text-slate-400 mt-1">Actionable Proposal</div>
										</div>
									</div>
								</div>
							</div>
						)}

						{/* Tab 3: Live Poll Simulator */}
						{sandboxTab === "poll" && (
							<div
								role="tabpanel"
								id="panel-poll"
								aria-labelledby="tab-poll"
								className="p-6 sm:p-8 space-y-6"
							>
								<div className="space-y-1">
									<h3 className="text-lg font-bold">Real-Time Democracy & Campus Polls</h3>
									<p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
										Cast a vote to experience the real-time websocket animation engine designed for VoiceFlow student polls.
									</p>
								</div>

								{/* Mock Poll Card */}
								<div className="p-5 rounded-2xl bg-white dark:bg-[#0f111a] border border-slate-200 dark:border-white/10 max-w-xl mx-auto space-y-4 shadow-sm">
									<div className="flex items-center justify-between text-xs text-slate-400">
										<span className="font-semibold text-accent uppercase tracking-wider">Campus Question of the Week</span>
										<span>Live Vote</span>
									</div>
									<h4 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
										Should our school provide open access to generative AI tools for research in the computer labs?
									</h4>

									<div className="space-y-2.5 pt-2">
										{/* Option 1: Yes */}
										{(() => {
											const total = pollVotes.yes + pollVotes.no + pollVotes.needInfo;
											const pct = Math.round((pollVotes.yes / total) * 100);
											const active = userVoted === "yes";
											return (
												<button
													type="button"
													onClick={() => handleVote("yes")}
													className={`w-full relative overflow-hidden p-3 rounded-xl border text-left transition-all ${
														active
															? "border-accent ring-2 ring-accent/30 bg-accent/5 font-bold"
															: "border-slate-200 dark:border-white/10 hover:border-slate-300"
													}`}
												>
													<div
														className="absolute inset-y-0 left-0 bg-[#5652d6]/15 dark:bg-[#5652d6]/30 transition-all duration-500 rounded-lg"
														style={{ width: `${pct}%` }}
													/>
													<div className="relative z-10 flex justify-between items-center text-xs sm:text-sm">
														<span className="flex items-center gap-2">
															{active && <CheckCircle2 size={15} className="text-accent" />}
															Yes, absolutely (with ethics guidelines)
														</span>
														<span className="font-bold text-accent">{pct}% ({pollVotes.yes})</span>
													</div>
												</button>
											);
										})()}

										{/* Option 2: Need Info */}
										{(() => {
											const total = pollVotes.yes + pollVotes.no + pollVotes.needInfo;
											const pct = Math.round((pollVotes.needInfo / total) * 100);
											const active = userVoted === "needInfo";
											return (
												<button
													type="button"
													onClick={() => handleVote("needInfo")}
													className={`w-full relative overflow-hidden p-3 rounded-xl border text-left transition-all ${
														active
															? "border-accent ring-2 ring-accent/30 bg-accent/5 font-bold"
															: "border-slate-200 dark:border-white/10 hover:border-slate-300"
													}`}
												>
													<div
														className="absolute inset-y-0 left-0 bg-violet-400/15 dark:bg-violet-400/25 transition-all duration-500 rounded-lg"
														style={{ width: `${pct}%` }}
													/>
													<div className="relative z-10 flex justify-between items-center text-xs sm:text-sm">
														<span className="flex items-center gap-2">
															{active && <CheckCircle2 size={15} className="text-accent" />}
															Need structured workshops first
														</span>
														<span className="font-bold text-violet-600 dark:text-violet-400">{pct}% ({pollVotes.needInfo})</span>
													</div>
												</button>
											);
										})()}

										{/* Option 3: No */}
										{(() => {
											const total = pollVotes.yes + pollVotes.no + pollVotes.needInfo;
											const pct = Math.round((pollVotes.no / total) * 100);
											const active = userVoted === "no";
											return (
												<button
													type="button"
													onClick={() => handleVote("no")}
													className={`w-full relative overflow-hidden p-3 rounded-xl border text-left transition-all ${
														active
															? "border-accent ring-2 ring-accent/30 bg-accent/5 font-bold"
															: "border-slate-200 dark:border-white/10 hover:border-slate-300"
													}`}
												>
													<div
														className="absolute inset-y-0 left-0 bg-slate-300/20 dark:bg-white/10 transition-all duration-500 rounded-lg"
														style={{ width: `${pct}%` }}
													/>
													<div className="relative z-10 flex justify-between items-center text-xs sm:text-sm">
														<span className="flex items-center gap-2">
															{active && <CheckCircle2 size={15} className="text-accent" />}
															No, keep focus on foundational coding
														</span>
														<span className="font-bold text-slate-500">{pct}% ({pollVotes.no})</span>
													</div>
												</button>
											);
										})()}
									</div>

									<p className="text-[11px] text-center text-slate-400 pt-1">
										{userVoted ? "✓ Your vote has been anonymously cast!" : "Click any option to simulate vote casting."}
									</p>
								</div>
							</div>
						)}
					</div>
				</div>
			</section>

			{/* ── SECTION: Interactive Developer CLI Terminal ─────────────────── */}
			<section id="terminal" className="py-20 bg-[#f8f9fc] dark:bg-[#0a0b12] relative z-10">
				<div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-6">
					<div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
						<div className="space-y-1">
							<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300 font-bold text-xs">
								<Terminal size={14} /> Interactive Developer Console
							</div>
							<h2 className="text-2xl sm:text-3xl font-black">SouyashOS Shell</h2>
							<p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
								Type commands below or click suggestion chips to interrogate the build and philosophy.
							</p>
						</div>

						{/* Quick command buttons */}
						<div className="flex flex-wrap items-center gap-1.5 text-xs">
							{["whoami", "skills", "projects", "voiceflow", "stats", "philosophy", "clear"].map((cmd) => (
								<button
									key={cmd}
									type="button"
									onClick={() => executeTerminal(cmd)}
									className="px-2.5 py-1 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:text-accent font-mono text-[11px] font-semibold transition-colors shadow-2xs"
								>
									{cmd}
								</button>
							))}
						</div>
					</div>

					{/* Terminal Window Box */}
					<div className="rounded-2xl overflow-hidden bg-[#0d1117] border border-slate-800 shadow-2xl font-mono text-xs sm:text-sm">
						{/* Terminal Window Header */}
						<div className="bg-[#161b22] px-4 py-2.5 flex items-center justify-between border-b border-slate-800">
							<div className="flex items-center gap-2">
								<span className="w-3 h-3 rounded-full bg-rose-500/80" />
								<span className="w-3 h-3 rounded-full bg-amber-500/80" />
								<span className="w-3 h-3 rounded-full bg-emerald-500/80" />
							</div>
							<span className="text-slate-400 text-xs">souyash@voiceflow-core:~ (zsh)</span>
							<span className="text-[10px] text-slate-500">v2.0.3-prod</span>
						</div>

						{/* Terminal Body */}
						<div
							role="log"
							aria-live="polite"
							className="p-4 sm:p-6 space-y-4 max-h-[360px] overflow-y-auto"
						>
							<div className="text-slate-400 text-xs leading-relaxed">
								Welcome to Souyash Bera&apos;s Interactive Portfolio Console.<br />
								Type <span className="text-accent font-bold">&apos;help&apos;</span> to discover available system commands.
							</div>

							{terminalCommands.map((item, idx) => (
								<div key={idx} className="space-y-1">
									<div className="flex items-center gap-2 text-emerald-400">
										<span className="text-slate-500">souyash@vf:~$</span>
										<span className="font-semibold">{item.input}</span>
									</div>
									<div className="pl-4 text-slate-200 text-xs sm:text-sm leading-relaxed">
										{item.output}
									</div>
								</div>
							))}
							<div ref={terminalBottomRef} />
						</div>

						{/* Terminal Input Line */}
						<form
							onSubmit={(e) => {
								e.preventDefault();
								executeTerminal(terminalInput);
							}}
							className="border-t border-slate-800 bg-[#161b22]/50 px-4 py-3 flex items-center gap-2"
						>
							<span className="text-emerald-400 font-bold shrink-0">souyash@vf:~$</span>
							<input
								type="text"
								maxLength={100}
								aria-label="Terminal command input"
								value={terminalInput}
								onChange={(e) => setTerminalInput(e.target.value)}
								onKeyDown={handleTerminalKeyDown}
								placeholder="type command (e.g. whoami, skills, stats)..."
								className="flex-1 bg-transparent text-white text-xs sm:text-sm focus:outline-none caret-accent"
							/>
							<button
								type="submit"
								className="text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-sans"
							>
								Run ↵
							</button>
						</form>
					</div>
				</div>
			</section>

			{/* ── SECTION: Interactive Story & Journey Milestones ─────────────── */}
			<section id="journey" className="py-20 bg-white dark:bg-[#10121d] border-t border-slate-200/80 dark:border-white/10 relative z-10">
				<div className="max-w-6xl mx-auto px-4 sm:px-6">
					<div className="text-center max-w-2xl mx-auto mb-12 space-y-2">
						<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent font-bold text-xs uppercase tracking-wider">
							<BookOpen size={14} /> The Journey
						</div>
						<KineticParagraph
							as="h2"
							variant="display"
							text="From Class 7B to Shipping VoiceFlow"
							highlightWords={["shipping", "voiceflow"]}
							gradientWords={["voiceflow"]}
							className="text-3xl sm:text-4xl font-black tracking-tight"
						/>
						<KineticParagraph
							text="Explore the chapters of this journey. Click any milestone to dive into the thought process behind the platform."
							highlightWords={["chapters", "journey", "milestone", "process"]}
							gradientWords={["journey"]}
							className="text-slate-600 dark:text-slate-400 text-sm sm:text-base"
						/>
					</div>

					<div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
						{/* Left: Milestone Picker List */}
						<div className="lg:col-span-5 space-y-2">
							{MILESTONES.map((milestone) => {
								const isSelected = milestone.id === activeMilestoneId;
								return (
									<button
										key={milestone.id}
										type="button"
										onClick={() => {
											setActiveMilestoneId(milestone.id);
											sound("tab");
											triggerHaptic("light");
										}}
										className={`w-full text-left p-4 rounded-2xl border transition-all flex items-start gap-3.5 ${
											isSelected
												? "bg-[#5652d6] text-white border-[#5652d6] shadow-lg shadow-[#5652d6]/25"
												: "bg-slate-50 dark:bg-white/5 border-slate-200/80 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/20"
										}`}
									>
										<span
											className={`text-xs font-mono font-bold px-2 py-0.5 rounded-md ${
												isSelected
													? "bg-white/20 text-white"
													: "bg-slate-200/70 dark:bg-white/10 text-slate-500 dark:text-slate-400"
											}`}
										>
											{milestone.number}
										</span>
										<div className="flex-1 min-w-0">
											<div className={`text-xs font-semibold ${isSelected ? "text-white/80" : "text-accent"}`}>
												{milestone.label}
											</div>
											<div className="text-sm font-bold truncate mt-0.5">
												{milestone.title}
											</div>
										</div>
										<ChevronRight
											size={16}
											className={`shrink-0 transition-transform ${isSelected ? "rotate-90 text-white" : "text-slate-400"}`}
										/>
									</button>
								);
							})}
						</div>

						{/* Right: Milestone Deep Dive Card */}
						<div className="lg:col-span-7">
							<AnimatePresence initial={false}>
								<motion.div
									key={activeMilestone.id}
									initial={{ opacity: 0, x: 20 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: -20 }}
									transition={{ duration: 0.15 }}
									className="p-6 sm:p-8 rounded-3xl bg-slate-50 dark:bg-[#161826] border border-slate-200 dark:border-white/10 shadow-lg space-y-6"
								>
									{/* Card Header */}
									<div className="border-b border-slate-200 dark:border-white/10 pb-5 space-y-2">
										<div className="flex items-center justify-between text-xs font-mono text-accent font-bold">
											<span>CHAPTER {activeMilestone.number}</span>
											<span className="text-slate-400">VOICEFLOW FOUNDATION</span>
										</div>
										<h3 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white leading-tight">
											{activeMilestone.title}
										</h3>
										<p className="text-sm sm:text-base font-medium text-slate-600 dark:text-slate-300 leading-relaxed">
											{activeMilestone.summary}
										</p>
									</div>

									{/* Quote if present */}
									{activeMilestone.quote && (
										<blockquote className="border-l-4 border-accent pl-4 py-2 bg-accent/5 rounded-r-xl text-base sm:text-lg font-bold text-slate-900 dark:text-white italic">
											&ldquo;{activeMilestone.quote}&rdquo;
										</blockquote>
									)}

									{/* Detailed paragraphs */}
									<div className="space-y-4 text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed font-normal">
										{activeMilestone.details.map((p, i) => (
											<p key={i}>{p}</p>
										))}
									</div>

									{/* Milestone Tags */}
									<div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
										{activeMilestone.tags.map((tag) => (
											<span
												key={tag}
												className="px-3 py-1 rounded-full text-xs font-semibold bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300"
											>
												#{tag}
											</span>
										))}
									</div>
								</motion.div>
							</AnimatePresence>
						</div>
					</div>
				</div>
			</section>

			{/* ── SECTION F: Skills & Technology Matrix ─────────────────────────── */}
			<section id="stack" className="py-20 bg-[#f8f9fc] dark:bg-[#0a0b12] relative z-10">
				<div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-8">
					<div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
						<div className="space-y-1">
							<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent font-bold text-xs uppercase tracking-wider">
								<Layers size={14} /> Technical Mastery
							</div>
							<h2 className="text-3xl sm:text-4xl font-black">Engineering Stack</h2>
							<p className="text-slate-600 dark:text-slate-400 text-sm">
								Technologies rigorously applied across VoiceFlow to ensure resilience, velocity, and privacy.
							</p>
						</div>

						{/* Category Filters */}
						<div className="flex flex-wrap items-center gap-1.5 bg-slate-200/80 dark:bg-white/5 p-1 rounded-xl">
							{(["all", "frontend", "backend", "ai", "core"] as const).map((cat) => (
								<button
									key={cat}
									type="button"
									onClick={() => {
										setTechFilter(cat);
										sound("tab");
									}}
									className={`px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
										techFilter === cat
											? "bg-white dark:bg-[#5652d6] text-accent dark:text-white shadow-xs"
											: "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
									}`}
								>
									{cat}
								</button>
							))}
						</div>
					</div>

					{/* Grid of Interactive Tech Cards */}
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
						{filteredTech.map((tech) => (
							<div
								key={tech.name}
								className="p-5 rounded-2xl bg-white dark:bg-[#12141f] border border-slate-200/80 dark:border-white/10 hover:border-accent dark:hover:border-accent transition-all duration-300 shadow-xs hover:shadow-lg space-y-3 group"
							>
								<div className="flex items-center justify-between">
									<span className="text-2xl">{tech.icon}</span>
									<span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-accent">
										{tech.level}%
									</span>
								</div>
								<div>
									<h4 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white group-hover:text-accent transition-colors">
										{tech.name}
									</h4>
									<p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
										{tech.roleInVoiceFlow}
									</p>
								</div>
								{/* Proficiency Bar */}
								<div className="h-1.5 w-full bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
									<div
										className="h-full bg-gradient-to-r from-[#5652d6] to-[#8b5cf6] rounded-full transition-all duration-1000"
										style={{ width: `${tech.level}%` }}
									/>
								</div>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* ── SECTION G: Personal Philosophy (Dramatic Statements) ─────────── */}
			<section className="py-20 bg-white dark:bg-[#10121d] border-t border-slate-200/80 dark:border-white/10 relative z-10">
				<div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-12">
					<div className="text-center max-w-xl mx-auto space-y-2">
						<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent font-bold text-xs uppercase tracking-wider">
							<Compass size={14} /> Philosophy
						</div>
						<KineticParagraph
							as="h2"
							variant="display"
							text="Guiding Principles"
							highlightWords={["guiding", "principles"]}
							gradientWords={["principles"]}
							className="text-3xl font-black"
						/>
						<KineticParagraph
							text="Four non-negotiable rules that govern every feature and line of code I author."
							highlightWords={["rules", "feature", "code", "author"]}
							gradientWords={["non-negotiable"]}
							className="text-slate-600 dark:text-slate-400 text-sm"
						/>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
						<div className="p-6 rounded-3xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-3 hover:scale-102 transition-transform">
							<div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-[#5652d6] grid place-items-center font-bold">
								<Lock size={20} />
							</div>
							<h3 className="font-bold text-base">Privacy by Math</h3>
							<p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
								Never ask for trust when cryptography can guarantee it. If a system doesn&apos;t store identifying tokens, it can never betray them.
							</p>
						</div>

						<div className="p-6 rounded-3xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-3 hover:scale-102 transition-transform">
							<div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-500 grid place-items-center font-bold">
								<Zap size={20} />
							</div>
							<h3 className="font-bold text-base">Speed is a Feature</h3>
							<p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
								Lag breaks focus. Every modal, filter, and submission transition is optimized to fire in under 50 milliseconds.
							</p>
						</div>

						<div className="p-6 rounded-3xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-3 hover:scale-102 transition-transform">
							<div className="w-10 h-10 rounded-2xl bg-pink-500/10 text-pink-500 grid place-items-center font-bold">
								<Heart size={20} />
							</div>
							<h3 className="font-bold text-base">Age is No Excuse</h3>
							<p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
								Being in Class 7B does not justify inferior architecture. Youth brings fresh perspective; rigorous engineering delivers results.
							</p>
						</div>

						<div className="p-6 rounded-3xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-3 hover:scale-102 transition-transform">
							<div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-500 grid place-items-center font-bold">
								<Compass size={20} />
							</div>
							<h3 className="font-bold text-base">Action over Noise</h3>
							<p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
								Complaining without resolution breeds cynicism. VoiceFlow links student submissions to real administrative resolutions.
							</p>
						</div>
					</div>
				</div>
			</section>

			{/* ── SECTION H: Closing Interaction & Contact ─────────────────────── */}
			<section id="contact" className="py-24 bg-gradient-to-b from-slate-50 to-white dark:from-[#0a0b12] dark:to-[#121420] border-t border-slate-200 dark:border-white/10 relative z-10">
				<div className="max-w-3xl mx-auto px-4 sm:px-6 text-center space-y-8">
					<div className="space-y-3">
						<span className="inline-block p-3 rounded-full bg-accent/10 text-accent font-bold">
							<Award size={24} />
						</span>
						<KineticParagraph
							as="h2"
							variant="display"
							text="Let's Build the Future"
							highlightWords={["build", "future"]}
							gradientWords={["future"]}
							className="text-4xl sm:text-6xl font-black tracking-tight text-slate-900 dark:text-white"
						/>
						<KineticParagraph
							text="Have questions about VoiceFlow's architecture, want to collaborate on AI projects, or have advice for a young developer?"
							highlightWords={["questions", "architecture", "collaborate", "advice"]}
							gradientWords={["collaborate"]}
							className="text-slate-600 dark:text-slate-300 text-sm sm:text-base max-w-lg mx-auto"
						/>
					</div>

					<div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-[#161826] border border-slate-200 dark:border-white/10 shadow-2xl space-y-5">
						<div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200/60 dark:border-white/5">
							<div className="text-left">
								<div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Direct Creator Contact</div>
								<div className="text-base sm:text-lg font-bold text-slate-900 dark:text-white font-mono mt-0.5">
									souyash@voiceflow.org
								</div>
							</div>
							<button
								type="button"
								onClick={handleCopyEmail}
								className="btn btn-primary !py-2.5 !px-5 text-xs sm:text-sm font-semibold flex items-center gap-2 shadow-sm"
							>
								{copiedEmail ? <Check size={16} /> : <Copy size={16} />}
								{copiedEmail ? "Copied to Clipboard!" : "Copy Email"}
							</button>
						</div>

						<div className="flex flex-wrap items-center justify-center gap-3 pt-2">
							<Link
								to="/"
								onClick={() => sound("click")}
								className="btn btn-ghost !py-2.5 !px-5 text-sm font-semibold flex items-center gap-2 border border-slate-200 dark:border-white/10"
							>
								<ArrowLeft size={16} /> Return to VoiceFlow Main Feed
							</Link>
							<Link
								to="/about"
								onClick={() => sound("click")}
								className="btn btn-ghost !py-2.5 !px-5 text-sm font-semibold flex items-center gap-2"
							>
								Platform About Page <ExternalLink size={14} />
							</Link>
						</div>
					</div>
				</div>
			</section>

			{/* Static Standard Footer */}
			<StaticFooter />
		</div>
	);
}
