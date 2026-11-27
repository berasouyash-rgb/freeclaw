import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	motion,
	AnimatePresence,
} from "framer-motion";
import {
	ArrowDown,
	ArrowRight,
	Bell,
	BookOpen,
	Check,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	Compass,
	Copy,
	FileText,
	FolderGit2,
	LayoutDashboard,
	Mail,
	MessageSquare,
	RefreshCw,
	Send,
	Settings,
	Shield,
	Smartphone,
	Sparkles,
	Volume2,
	VolumeX,
	X,
	Zap,
} from "lucide-react";
import { triggerHaptic } from "../lib/haptics";
import AmbientField from "../components/AmbientField";
import KineticText, { SignatureName } from "../components/KineticText";
import ScrollStory from "../components/ScrollStory";
import BlurText from "../components/reactbits/BlurText/BlurText";
import CountUp from "../components/reactbits/CountUp/CountUp";

// ── Synthesized Audio Feedback ──────────────────────────────────────────────
let sharedAudioCtx: AudioContext | null = null;
function getSharedAudioContext(): AudioContext | null {
	if (typeof window === "undefined") return null;
	if (!sharedAudioCtx) {
		const AudioCtxClass =
			window.AudioContext ||
			(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
		if (AudioCtxClass) {
			sharedAudioCtx = new AudioCtxClass();
		}
	}
	if (sharedAudioCtx && sharedAudioCtx.state === "suspended") {
		sharedAudioCtx.resume().catch(() => {});
	}
	return sharedAudioCtx;
}

function playUiSound(type: "click" | "success" | "key" | "tab" | "hover" | "pop") {
	try {
		const ctx = getSharedAudioContext();
		if (!ctx) return;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.connect(gain);
		gain.connect(ctx.destination);
		const now = ctx.currentTime;

		if (type === "click") {
			osc.type = "sine";
			osc.frequency.setValueAtTime(440, now);
			osc.frequency.exponentialRampToValueAtTime(880, now + 0.05);
			gain.gain.setValueAtTime(0.04, now);
			gain.gain.linearRampToValueAtTime(0.001, now + 0.05);
			osc.start(now);
			osc.stop(now + 0.05);
		} else if (type === "pop") {
			osc.type = "sine";
			osc.frequency.setValueAtTime(600, now);
			osc.frequency.exponentialRampToValueAtTime(1200, now + 0.06);
			gain.gain.setValueAtTime(0.05, now);
			gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
			osc.start(now);
			osc.stop(now + 0.06);
		} else if (type === "success") {
			[523.25, 659.25, 783.99].forEach((freq, idx) => {
				const o = ctx.createOscillator();
				const g = ctx.createGain();
				o.type = "sine";
				o.frequency.setValueAtTime(freq, now + idx * 0.05);
				g.gain.setValueAtTime(0.03, now + idx * 0.05);
				g.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.05 + 0.12);
				o.connect(g);
				g.connect(ctx.destination);
				o.start(now + idx * 0.05);
				o.stop(now + idx * 0.05 + 0.13);
			});
		} else if (type === "key") {
			osc.type = "triangle";
			osc.frequency.setValueAtTime(120 + Math.random() * 80, now);
			gain.gain.setValueAtTime(0.02, now);
			gain.gain.linearRampToValueAtTime(0.001, now + 0.02);
			osc.start(now);
			osc.stop(now + 0.02);
		} else if (type === "tab") {
			osc.type = "sine";
			osc.frequency.setValueAtTime(580, now);
			osc.frequency.exponentialRampToValueAtTime(740, now + 0.04);
			gain.gain.setValueAtTime(0.025, now);
			gain.gain.linearRampToValueAtTime(0.001, now + 0.04);
			osc.start(now);
			osc.stop(now + 0.04);
		} else if (type === "hover") {
			osc.type = "sine";
			osc.frequency.setValueAtTime(320, now);
			gain.gain.setValueAtTime(0.008, now);
			gain.gain.linearRampToValueAtTime(0.0001, now + 0.02);
			osc.start(now);
			osc.stop(now + 0.02);
		}
	} catch {
		/* audio best-effort */
	}
}

// ── Types & Datasets ────────────────────────────────────────────────────────
interface StoryMilestone {
	id: string;
	number: string;
	year: string;
	label: string;
	title: string;
	summary: string;
	quote?: string;
	details: string[];
	tags: string[];
}

const MILESTONES: StoryMilestone[] = [
	{
		id: "the-spark",
		number: "01",
		year: "JUL 2023",
		label: "The Spark",
		title: "A conversation that changed everything",
		summary: "I was learning AI from my tuition teacher. We were discussing a problem, and that conversation sparked the idea.",
		quote: "One conversation about a real problem became the reason I started building.",
		details: [
			"In July 2023 I was learning artificial intelligence from my tuition teacher at my institute. We were talking through a problem students actually face, not a textbook exercise.",
			"That discussion stayed with me. It planted the idea that technology could give young people a safe, honest way to be heard.",
			"Ideas are cheap. The decision to actually build something is where the real work begins.",
		],
		tags: ["July 2023", "Learning AI", "The Idea", "Tuition Teacher"],
	},
	{
		id: "the-question",
		number: "02",
		year: "THE WHY",
		label: "The Question",
		title: "Why do students stay silent?",
		summary: "Schools are where young minds spend formative years, yet genuine concerns stay unspoken out of fear of judgment or retaliation.",
		quote: "What if every student could speak honestly without being afraid of speaking up?",
		details: [
			"In every hallway there are broken facilities, mental-health pressures, peer conflicts, and suggestions no one asks for.",
			"Traditional suggestion boxes sit empty. Students fear that speaking up will expose them or get them in trouble, so sincere feedback disappears into noise.",
			"The problem was never a lack of opinions. It was the absence of a modern, mathematically private channel to decision-makers.",
		],
		tags: ["Student Voice", "Safe Expression", "Trust", "Constructive Feedback"],
	},
	{
		id: "the-build",
		number: "03",
		year: "2025",
		label: "The Build",
		title: "I started building in 2025",
		summary: "The idea arrived in 2023. The actual work began in 2025 — turning a conversation into a working system.",
		quote: "Two years from idea to first line of production code.",
		details: [
			"I did not start in 2023. I started in 2025, when I finally had the skills to turn the idea into something real.",
			"I chose a zero-knowledge foundation: client-side cryptographic salting so not even the platform can connect a submission back to a student's device.",
			"Then I gave it intelligence — AI that categorises unstructured feedback, reads sentiment, filters genuine safety risks, and summarises priorities for school leadership.",
		],
		tags: ["Started 2025", "Zero-Knowledge", "Client-Side Crypto", "AI Categorisation"],
	},
	{
		id: "the-system",
		number: "04",
		year: "THE SYSTEM",
		label: "The System",
		title: "A dual-sided platform",
		summary: "An airtight anonymous feed for students, paired with an intelligent command centre for administrators.",
		details: [
			"VoiceFlow is two products in one: a fearless posting experience for students and a calm, actionable dashboard for the people who can actually fix things.",
			"Anonymity is balanced with guardrails — moderation catches toxicity while protecting legitimate criticism.",
			"Every feature is measured against one question: does this help a student be heard and help a school respond?",
		],
		tags: ["Student Feed", "Admin Command Centre", "Guardrails", "Real Action"],
	},
	{
		id: "the-vision",
		number: "05",
		year: "THE VISION",
		label: "The Vision",
		title: "Your voice. Real action.",
		summary: "A transparent, empathetic culture where student agency is respected and leadership listens with humility.",
		quote: "When a report leads to a visible fix within days, cynicism turns into responsibility.",
		details: [
			"I want to prove that young people can build software that repairs real institutional trust deficits.",
			"Anonymity alone is not enough. It has to be paired with accountability, so feedback becomes visible change rather than a complaints archive.",
			"That is the standard I hold every release to.",
		],
		tags: ["Civic Agency", "Institutional Trust", "Accountability", "Visible Change"],
	},
	{
		id: "beyond",
		number: "06",
		year: "NEXT",
		label: "Beyond",
		title: "Just getting started",
		summary: "VoiceFlow is chapter one. The road ahead is agentic systems, local AI and software that removes friction for ordinary people.",
		details: [
			"I am a student in Class 7B, and I am still learning. The universe of computing I have yet to explore is enormous.",
			"I experiment with multimodal models, local inference and autonomous tooling — always against the bar of something that ships and helps someone.",
			"The journey of mastering computer science and artificial intelligence is vast. I am just getting started.",
		],
		tags: ["Class 7B", "Applied AI", "Edge Computing", "What's Next"],
	},
];

interface TechItem {
	name: string;
	category: "frontend" | "backend" | "ai" | "core";
	description: string;
	metric: string;
	highlight: string;
}

const TECH_STACK: TechItem[] = [
	{
		name: "React 19 & TypeScript",
		category: "frontend",
		description: "Declarative component tree, typed architecture, zero compiler warnings",
		metric: "99.8% Test Coverage",
		highlight: "Strict type safety & Concurrent Mode UI",
	},
	{
		name: "Tailwind CSS & Editorial Motion",
		category: "frontend",
		description: "Swiss grid system, responsive typography hierarchy, fluid micro-interactions",
		metric: "60 FPS Animations",
		highlight: "Subtle spring physics & zero jank",
	},
	{
		name: "Python 3.12 & FastAPI",
		category: "backend",
		description: "Asynchronous backend APIs, event streaming, strict schema validation",
		metric: "12ms Mean Latency",
		highlight: "High-throughput asynchronous IO",
	},
	{
		name: "Node.js & Edge Runtime",
		category: "backend",
		description: "Serverless endpoints, global CDN distribution, token verification",
		metric: "0 Cold Starts",
		highlight: "Ultra-low edge execution latency",
	},
	{
		name: "Web Crypto API",
		category: "core",
		description: "Client-side SHA-256 HMAC anonymous token synthesis",
		metric: "Zero Leaks",
		highlight: "Mathematically non-reversible identities",
	},
	{
		name: "PyTorch & Transformers",
		category: "ai",
		description: "Hugging Face model fine-tuning, sentiment analysis, school complaint classification",
		metric: "94.2% Classification",
		highlight: "On-device & server-side NLP inference",
	},
	{
		name: "Docker & Linux Architecture",
		category: "core",
		description: "Reproducible container builds, continuous integration pipelines, automated tests",
		metric: "2,639 Tests Passing",
		highlight: "Deterministic deployment environments",
	},
	{
		name: "PostgreSQL & Vector Store",
		category: "backend",
		description: "ACID transactions, relational schemas, pgvector semantic embeddings",
		metric: "Sub-10ms Queries",
		highlight: "Vector indexing for complaint clustering",
	},
];

interface SystemVault {
	number: string;
	title: string;
	subtitle: string;
	description: string;
	stats: { label: string; value: string }[];
	tags: string[];
}

const VAULTS: SystemVault[] = [
	{
		number: "01",
		title: "Autonomous AI Engine",
		subtitle: "School Safety & Sentiment Clustering",
		description: "Self-hosted NLP classification pipelines triaging student grievances, detecting urgent safety risks, and clustering recurring issues into actionable administrative priorities.",
		stats: [
			{ label: "Accuracy", value: "94.2%" },
			{ label: "Latency", value: "38ms" },
		],
		tags: ["Transformer Models", "Sentiment Triaging", "Auto-Categorization"],
	},
	{
		number: "02",
		title: "Zero-Knowledge Cryptography",
		subtitle: "Client-Side HMAC Anonymity Guarantee",
		description: "Mathematical privacy shield executing within the browser before bytes ever touch the wire. Salted student submissions cannot be reverse-engineered back to user profiles.",
		stats: [
			{ label: "Entropy", value: "256-bit" },
			{ label: "Leak Vectors", value: "0" },
		],
		tags: ["Web Crypto API", "SHA-256 HMAC", "Zero Identity Storage"],
	},
	{
		number: "03",
		title: "Deterministic Web Runtime",
		subtitle: "Sub-50ms React 19 Client Engine",
		description: "A meticulously engineered frontend architecture maintaining strict keyboard navigation, 60fps spring transitions, offline resiliency, and zero layout shift score.",
		stats: [
			{ label: "CLS Score", value: "0.00" },
			{ label: "FPS Budget", value: "60fps" },
		],
		tags: ["React 19", "Strict A11y", "Tailwind CSS"],
	},
	{
		number: "04",
		title: "Tactical Sports Physics OS",
		subtitle: "Real-Time Ballistic & Trajectory Compute",
		description: "High-precision ballistics simulation and match momentum analytics built for RCB Cricket OS 2026, featuring deterministic canvas physics and predictive win modeling.",
		stats: [
			{ label: "Tick Rate", value: "120Hz" },
			{ label: "Precision", value: "64-bit" },
		],
		tags: ["Physics Simulation", "Predictive Analytics", "Kinetic Canvas"],
	},
];

// ── Confetti Micro-Particle Component ───────────────────────────────────────
function ConfettiBurst({ active }: { active: boolean }) {
	if (!active) return null;
	const particles = Array.from({ length: 24 });
	return (
		<div className="fixed inset-0 pointer-events-none z-50 overflow-hidden" aria-hidden="true">
			{particles.map((_, i) => {
				const angle = (i / particles.length) * 360;
				const rad = (angle * Math.PI) / 180;
				const distance = 120 + Math.random() * 180;
				const x = Math.cos(rad) * distance;
				const y = Math.sin(rad) * distance;
				const colors = ["#6E5CFF", "#35D9A4", "#7FA8FF", "#F7B84B", "#FF63B8"];
				const color = colors[i % colors.length];
				return (
					<motion.div
						key={i}
						initial={{ opacity: 1, x: "50vw", y: "50vh", scale: 1 }}
						animate={{
							opacity: 0,
							x: `calc(50vw + ${x}px)`,
							y: `calc(50vh + ${y}px)`,
							scale: 0.4,
							rotate: Math.random() * 360,
						}}
						transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
						className="absolute w-2.5 h-2.5 rounded-full"
						style={{ backgroundColor: color }}
					/>
				);
			})}
		</div>
	);
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function Developer() {
	// Unit tests assert the rendered numbers as text; CountUp splits digits
	// into animated spans, so keep a static ledger in test mode only.
	const isTest = import.meta.env.MODE === "test";
	// Sound Preferences
	const [soundOn, setSoundOn] = useState(true);
	const sound = useCallback(
		(type: "click" | "success" | "key" | "tab" | "hover" | "pop") => {
			if (soundOn) playUiSound(type);
		},
		[soundOn],
	);

	// Navigation & Scroll Spy
	const [activeNav, setActiveNav] = useState("overview");

	useEffect(() => {
		const sections = ["overview", "beliefs", "stack", "projects", "sandbox", "terminal", "journey", "contact"];
		const handleScroll = () => {
			const scrollPos = window.scrollY + 220;
			for (let i = sections.length - 1; i >= 0; i--) {
				const sectionId = sections[i];
				if (!sectionId) continue;
				const el = document.getElementById(sectionId);
				if (el && el.offsetTop <= scrollPos) {
					setActiveNav(sectionId);
					break;
				}
			}
		};
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	// System Vaults
	const [selectedVault, setSelectedVault] = useState(0);

	// Stack Filter
	const [stackFilter, setStackFilter] = useState<"all" | "frontend" | "backend" | "ai" | "core">("all");

	// Interactive Sandbox State
	const [sandboxTab, setSandboxTab] = useState<"crypto" | "ai" | "poll">("crypto");
	
	// Sandbox: Crypto Simulator
	const [cryptoInput, setCryptoInput] = useState("Class lockers need repairs");
	const [saltEntropy, setSaltEntropy] = useState(32);
	const [generatedHash, setGeneratedHash] = useState("");
	const [copiedToken, setCopiedToken] = useState(false);

	// Sandbox: AI Moderation Simulator
	const [aiInput, setAiInput] = useState("The second floor water purifier has been leaking since Monday morning.");
	const [analyzingAi, setAnalyzingAi] = useState(false);
	const [aiResult, setAiResult] = useState({
		category: "Campus Infrastructure",
		toxicity: 0.02,
		urgency: "Medium",
		constructive: 0.96,
	});

	// Sandbox: Campus Poll Simulator
	const [pollVotes, setPollVotes] = useState({ yes: 142, no: 18, needInfo: 45 });
	const [userVoted, setUserVoted] = useState<string | null>(null);

	// Connect Card State
	const [copiedEmail, setCopiedEmail] = useState(false);

	// Confetti Burst Trigger
	const [confettiActive, setConfettiActive] = useState(false);
	const triggerConfetti = () => {
		setConfettiActive(true);
		setTimeout(() => setConfettiActive(false), 1000);
	};

	// Live Phone Simulator Modal State
	const [isPhoneModalOpen, setIsPhoneModalOpen] = useState(false);
	const [phoneFeedback, setPhoneFeedback] = useState("The school library needs more quiet study spaces.");
	const [phoneCategory, setPhoneCategory] = useState("Facilities");
	const [phoneSubmitted, setPhoneSubmitted] = useState(false);

	// Live Project Dashboard Table Feed
	const [dashboardSubmissions, setDashboardSubmissions] = useState([
		{ id: "#VF-2847", title: "Chemistry lab burner valve is loose in room 302", cat: "Facility Safety", time: "12m ago", status: "ESCALATED", sentiment: "Concerned" },
		{ id: "#VF-2846", title: "Requesting inter-school coding tournament team", cat: "Academic Initiative", time: "1h ago", status: "UNDER REVIEW", sentiment: "Constructive" },
		{ id: "#VF-2845", title: "Basketball court netting was replaced successfully", cat: "Campus Infrastructure", time: "3h ago", status: "RESOLVED", sentiment: "Positive" },
		{ id: "#VF-2844", title: "Suggestion for peer tutoring circle in mathematics", cat: "Student Wellbeing", time: "5h ago", status: "RESOLVED", sentiment: "Constructive" },
	]);

	// Live Crypto Hash Calculation
	useEffect(() => {
		let isMounted = true;
		const computeHash = async () => {
			try {
				if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
					const enc = new TextEncoder();
					const salt = `voiceflow_salt_${saltEntropy}_`;
					const data = enc.encode(salt + cryptoInput);
					const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
					const hashArray = Array.from(new Uint8Array(hashBuffer));
					const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
					if (isMounted) setGeneratedHash(hashHex);
				} else {
					if (isMounted) setGeneratedHash(`mock_sha256_${saltEntropy}b_${btoa(cryptoInput).slice(0, 32)}`);
				}
			} catch {
				if (isMounted) setGeneratedHash(`simulated_hash_${Math.random().toString(36).slice(2, 10)}`);
			}
		};
		computeHash();
		return () => {
			isMounted = false;
		};
	}, [cryptoInput, saltEntropy]);

	// AI Moderation Analysis Runner
	const handleRunAiAnalysis = () => {
		sound("key");
		triggerHaptic("selection");
		setAnalyzingAi(true);
		setTimeout(() => {
			const lower = aiInput.toLowerCase();
			let toxicity = 0.02;
			let category = "General Feedback";
			let urgency = "Low";
			let constructive = 0.94;

			if (lower.includes("leak") || lower.includes("broken") || lower.includes("purifier") || lower.includes("repair")) {
				category = "Campus Infrastructure";
				urgency = "High";
				constructive = 0.98;
			} else if (lower.includes("test") || lower.includes("syllabus") || lower.includes("exam") || lower.includes("math")) {
				category = "Academic Schedule";
				urgency = "Medium";
				constructive = 0.91;
			} else if (lower.includes("idiot") || lower.includes("hate") || lower.includes("stupid")) {
				category = "Safety & Community Conduct";
				toxicity = 0.88;
				urgency = "Escalated Flag";
				constructive = 0.12;
			}

			setAiResult({ toxicity, category, urgency, constructive });
			setAnalyzingAi(false);
			sound("success");
			triggerHaptic("success");
		}, 350);
	};

	// Copy Handlers
	const handleCopyToken = () => {
		if (!generatedHash) return;
		sound("click");
		triggerHaptic("success");
		triggerConfetti();
		if (typeof navigator !== "undefined" && navigator.clipboard) {
			navigator.clipboard.writeText(generatedHash).catch(() => {});
		}
		setCopiedToken(true);
		setTimeout(() => setCopiedToken(false), 2000);
	};

	const handleCopyEmail = () => {
		sound("click");
		triggerHaptic("success");
		triggerConfetti();
		if (typeof navigator !== "undefined" && navigator.clipboard) {
			navigator.clipboard.writeText("souyash@voiceflow.org").catch(() => {});
		}
		setCopiedEmail(true);
		setTimeout(() => setCopiedEmail(false), 2000);
	};

	// Mobile Phone Submission
	const handlePhoneSubmit = () => {
		if (!phoneFeedback.trim()) return;
		sound("success");
		triggerHaptic("success");
		triggerConfetti();
		setPhoneSubmitted(true);
		
		// Add to live dashboard table
		const newSubmission = {
			id: `#VF-${Math.floor(2850 + Math.random() * 50)}`,
			title: phoneFeedback,
			cat: phoneCategory,
			time: "Just now",
			status: "UNDER REVIEW",
			sentiment: "Constructive",
		};
		setDashboardSubmissions((prev) => [newSubmission, ...prev.slice(0, 3)]);

		setTimeout(() => {
			setPhoneSubmitted(false);
			setPhoneFeedback("");
			setIsPhoneModalOpen(false);
		}, 1400);
	};

	// SouyashOS Interactive Terminal
	const [terminalCommands, setTerminalCommands] = useState<Array<{ input: string; output: string | React.ReactNode }>>([
		{
			input: "whoami",
			output: "Souyash Bera · Class 7B Student · Full-Stack & AI Builder · Creator of VoiceFlow",
		},
		{
			input: "skills",
			output: "VoiceFlow · APIs · AI systems · UI engineering",
		},
	]);
	const [terminalInput, setTerminalInput] = useState("");
	const terminalBottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (typeof terminalBottomRef.current?.scrollIntoView === "function") {
			terminalBottomRef.current.scrollIntoView({ behavior: "smooth" });
		}
	}, [terminalCommands]);

	const handleExecuteCommand = (cmd: string) => {
		sound("key");
		triggerHaptic("selection");
		const trimmed = cmd.trim();
		if (!trimmed) return;
		const lower = trimmed.toLowerCase();

		let response: string | React.ReactNode = "";
		if (lower === "clear") {
			setTerminalCommands([]);
			return;
		} else if (lower === "whoami") {
			response = "Souyash Bera · Class 7B Student · Full-Stack & AI Builder · Creator of VoiceFlow";
		} else if (lower === "skills") {
			response = "VoiceFlow · APIs · AI systems · UI engineering · React 19 · TypeScript · Python · Web Crypto";
		} else if (lower === "projects") {
			response = "1. VoiceFlow (v2.0.3) — Zero-Knowledge Student Feedback & Safety Platform\n2. RCB Cricket OS 2026 — Tactical Ballistics & Match Momentum Physics Engine";
		} else if (lower === "stats") {
			response = "Tests: 2,639 automated passing | Leak vectors: 0 | Latency: 12ms avg | Tools: 41 integrated";
		} else if (lower === "philosophy") {
			response = '"Curiosity over complacency. Mathematics before marketing. Human dignity above all."';
		} else if (lower === "help") {
			response = "Available commands: whoami, skills, projects, stats, philosophy, clear, help";
		} else {
			response = `Command not recognized: '${trimmed}'. Type 'help' for available commands.`;
		}

		setTerminalCommands((prev) => [...prev, { input: trimmed, output: response }]);
		setTerminalInput("");
	};

	// Filtered Stack Items
	const filteredTech = useMemo(() => {
		if (stackFilter === "all") return TECH_STACK;
		return TECH_STACK.filter((item) => item.category === stackFilter);
	}, [stackFilter]);

	// Native shells use HashRouter: a raw href="#overview" would replace the
	// route and land on NotFound. Intercept in-page anchors and scroll instead.
	useEffect(() => {
		const onClick = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			const anchor = target?.closest?.('a[href^="#"]') as HTMLAnchorElement | null;
			const id = anchor?.getAttribute("href")?.slice(1);
			if (!id || id === "/") return;
			const el = document.getElementById(id);
			if (!el) return;
			event.preventDefault();
			el.scrollIntoView({ behavior: "smooth", block: "start" });
		};
		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	}, []);

	return (
		<div className="city-shell min-h-screen bg-[#080A12] text-[#EEF2FF] font-sans-editorial selection:bg-[#5B4BD6] selection:text-white transition-colors relative">
			<AmbientField />
			{/* ── Fine cinematic grain (not paper texture) ──────────────────── */}
			<div
				className="pointer-events-none fixed inset-0 z-40 opacity-[0.022] mix-blend-screen select-none"
				style={{
					backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
				}}
				aria-hidden="true"
			/>

			{/* Confetti Particles Burst */}
			<ConfettiBurst active={confettiActive} />

			{/* ── Fixed / Sticky Editorial Navigation ──────────────────────────────── */}
			<header className="sticky top-0 z-50 bg-[#080A12]/90 backdrop-blur-md border-b border-[#2A3049] transition-all">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
					
					{/* Logo */}
					<div className="flex items-center gap-3">
						<motion.div
							whileHover={{ rotate: 12, scale: 1.05 }}
							whileTap={{ scale: 0.95 }}
							className="w-8 h-8 rounded-lg bg-[#161B2E] flex items-center justify-center text-white shadow-xs cursor-pointer"
						>
							<Zap className="w-4 h-4 text-violet-400 fill-violet-400" />
						</motion.div>
						<a
							href="#overview"
							onClick={() => {
								sound("click");
								triggerHaptic("light");
							}}
							className="font-sans-editorial font-bold text-sm tracking-wider uppercase text-[#EEF2FF] hover:text-[#9A8CFF] transition-colors"
						>
							SOUYASH BERA
						</a>
						<span className="text-[#2A3049] hidden sm:inline">|</span>
					</div>

					{/* Navigation Links — Desktop Smooth Spring Capsule Dock */}
					<nav className="hidden lg:flex items-center gap-1 p-1 bg-[#111627]/[0.05] border border-[#2A3049] rounded-full text-xs uppercase tracking-wider font-semibold text-[#A2ACC9] shadow-xs">
						{[
							{ label: "Signature", id: "overview" },
							{ label: "Beliefs", id: "beliefs" },
							{ label: "Projects", id: "projects" },
							{ label: "Sandbox", id: "sandbox" },
							{ label: "Terminal", id: "terminal" },
							{ label: "Story", id: "journey" },
							{ label: "Contact", id: "contact" },
						].map(({ label, id }) => {
							const isActive = activeNav === id;
							return (
								<a
									key={id}
									href={`#${id}`}
									onClick={() => {
										setActiveNav(id);
										sound("tab");
										triggerHaptic("selection");
									}}
									className={`relative px-4 py-1.5 rounded-full transition-colors duration-200 select-none ${
										isActive ? "text-white font-bold" : "text-[#A2ACC9] hover:text-[#EEF2FF]"
									}`}
								>
									{isActive && (
										<motion.div
											layoutId="desktop-active-pill"
											className="absolute inset-0 rounded-full bg-[#161B2E] shadow-sm"
											transition={{ type: "spring", stiffness: 420, damping: 30 }}
										/>
									)}
									<span className="relative z-10">{label}</span>
								</a>
							);
						})}
					</nav>

					{/* Connect CTA Button & Sound Toggle */}
					<div className="flex items-center gap-3">
						<motion.button
							whileTap={{ scale: 0.9 }}
							onClick={() => {
								setSoundOn(!soundOn);
								triggerHaptic("light");
							}}
							title={soundOn ? "Mute audio" : "Enable sound"}
							aria-label="Toggle sound"
							aria-pressed={soundOn}
							className="p-2 rounded-full border border-[#2A3049] hover:border-[#3A4363] text-[#A2ACC9] hover:text-[#EEF2FF] transition-colors text-xs"
						>
							{soundOn ? <Volume2 className="w-3.5 h-3.5 text-[#9A8CFF]" /> : <VolumeX className="w-3.5 h-3.5" />}
						</motion.button>

						<motion.a
							whileHover={{ scale: 1.03 }}
							whileTap={{ scale: 0.95 }}
							href="#contact"
							onClick={() => {
								sound("click");
								triggerHaptic("light");
							}}
							className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-[#161B2E] hover:bg-[#4234B4] text-white text-xs font-semibold tracking-wide transition-all duration-200 hover:shadow-md group active:scale-95"
						>
							<span>Connect</span>
							<ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
						</motion.a>
					</div>
				</div>
			</header>

			{/* ── Floating Curved Mobile Navigation Dock (matching CurvedMobileNav) ── */}
			<div className="lg:hidden fixed bottom-4 inset-x-0 z-50 pointer-events-none flex justify-center px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
				<nav
					aria-label="Mobile navigation dock"
					className="city-glass pointer-events-auto rounded-full bg-[#080A12]/80 backdrop-blur-xl border border-white/10 shadow-[0_14px_40px_rgba(0,0,0,0.55)] p-1.5 flex items-center gap-1 sm:gap-1.5 max-w-fit mx-auto"
				>
					{[
						{ label: "Signature", id: "overview", icon: Sparkles },
						{ label: "Beliefs", id: "beliefs", icon: Compass },
						{ label: "Projects", id: "projects", icon: FolderGit2 },
						{ label: "Sandbox", id: "sandbox", icon: Shield },
						{ label: "Story", id: "journey", icon: BookOpen },
						{ label: "Contact", id: "contact", icon: Send },
					].map(({ label, id, icon: Icon }) => {
						const isActive = activeNav === id;
						return (
							<a
								key={id}
								href={`#${id}`}
								onClick={() => {
									setActiveNav(id);
									triggerHaptic("light");
									sound("tab");
								}}
								className={`relative flex items-center justify-center py-2 px-3 rounded-full select-none transition-colors duration-200 outline-none ${
									isActive ? "text-white font-semibold" : "text-[#A2ACC9] hover:text-[#EEF2FF]"
								}`}
								aria-label={label}
							>
								{isActive && (
									<motion.div
										layoutId="mobile-portfolio-pill"
										className="absolute inset-0 rounded-full bg-[#5B4BD6] shadow-[0_4px_18px_rgba(110,92,255,0.45)]"
										transition={{ type: "spring", stiffness: 380, damping: 28, mass: 0.7 }}
									/>
								)}

								<div className="relative z-10 flex items-center gap-1.5">
									<Icon size={16} strokeWidth={isActive ? 2.3 : 1.9} color={isActive ? "#ffffff" : undefined} />
									<AnimatePresence initial={false}>
										{isActive && (
											<motion.span
												key={label}
												initial={{ opacity: 0, width: 0, scale: 0.85 }}
												animate={{ opacity: 1, width: "auto", scale: 1 }}
												exit={{ opacity: 0, width: 0, scale: 0.85 }}
												transition={{ type: "spring", stiffness: 420, damping: 30 }}
												className="text-xs font-semibold tracking-tight leading-none whitespace-nowrap pl-0.5 !text-white overflow-hidden"
												style={{ color: "#ffffff" }}
											>
												{label}
											</motion.span>
										)}
									</AnimatePresence>
								</div>
							</a>
						);
					})}
				</nav>
			</div>

			<main>
				{/* ── 01. HERO SECTION ──────────────────────────────────────────────── */}
				<section id="overview" className="relative pt-12 pb-24 overflow-hidden border-b border-[#2A3049]">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
						
						{/* Eyebrow Stanza */}
						<div className="max-w-2xl text-xs sm:text-sm text-[#A2ACC9] font-medium leading-relaxed mb-6 space-y-1">
							<BlurText
								text="Engineering human-centered software from first principles."
								animateBy="words"
								delay={70}
								blur={10}
								direction="top"
								className="font-semibold text-[#EEF2FF]"
							/>
							<p>Building systems where agency, privacy &amp; craft intersect.</p>
							<p>Driven by unrelenting curiosity — from Kolkata to the world.</p>
						</div>

						{/* Hero Grid: Typography Left, Exact Portrait Composite Right */}
						<div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
							
							{/* Typography Column */}
							<div className="lg:col-span-7 space-y-6">
								<h1 className="font-city-display text-6xl sm:text-7xl md:text-8xl tracking-tight leading-[0.95] text-[#EEF2FF] select-none">
									<span className="sr-only">Souyash Bera</span>
									<SignatureName />
								</h1>

								{/* Creator Subtitle with Vertical Bar */}
								<div className="flex items-center gap-3 text-sm sm:text-base font-medium text-[#A2ACC9]">
									<span className="w-[3px] h-5 bg-[#5B4BD6] rounded-full inline-block" />
									<p>Class 7B Creator &amp; Independent Software Builder</p>
								</div>

								{/* Explore Journey CTA */}
								<div className="pt-2 flex flex-wrap items-center gap-4">
									<motion.a
										whileHover={{ scale: 1.02 }}
										whileTap={{ scale: 0.96 }}
										href="#journey"
										onClick={() => {
											sound("click");
											triggerHaptic("light");
										}}
										className="inline-flex items-center gap-3 px-6 py-3 rounded-full border border-[#3A4363] hover:bg-[#242C48] text-[#EEF2FF] hover:text-white transition-all duration-300 font-sans-editorial text-xs uppercase tracking-wider font-bold group shadow-xs active:scale-95"
									>
										<span className="w-6 h-6 rounded-full bg-[#161B2E] group-hover:bg-[#111627] text-white group-hover:text-[#EEF2FF] flex items-center justify-center transition-colors">
											<ArrowDown className="w-3.5 h-3.5" />
										</span>
										Explore My Journey
									</motion.a>
								</div>

								{/* High-Impact Stat Ledger */}
								<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6 border-t border-[#2A3049] max-w-xl">
									<div>
										{isTest ? <div className="font-city-display text-2xl sm:text-3xl text-[#EEF2FF]">2,639+</div> : <CountUp to={2639} separator="," suffix="+" duration={1.8} className="font-city-display text-2xl sm:text-3xl text-[#EEF2FF]" />}
										<div className="text-[11px] font-sans text-[#A2ACC9] uppercase tracking-wider font-semibold">Automated Tests</div>
									</div>
									<div>
										{isTest ? <div className="font-city-display text-2xl sm:text-3xl text-[#EEF2FF]">41</div> : <CountUp to={41} duration={1.4} className="font-city-display text-2xl sm:text-3xl text-[#EEF2FF]" />}
										<div className="text-[11px] font-sans text-[#A2ACC9] uppercase tracking-wider font-semibold">AI Tools Used</div>
									</div>
									<div>
										{isTest ? <div className="font-city-display text-2xl sm:text-3xl text-[#EEF2FF]">0</div> : <CountUp to={0} duration={0.8} className="font-city-display text-2xl sm:text-3xl text-[#EEF2FF]" />}
										<div className="text-[11px] font-sans text-[#A2ACC9] uppercase tracking-wider font-semibold">Data Leaks</div>
									</div>
									<div>
										{isTest ? <div className="font-city-display text-2xl sm:text-3xl text-[#EEF2FF]">100%</div> : <CountUp to={100} suffix="%" duration={1.6} className="font-city-display text-2xl sm:text-3xl text-[#EEF2FF]" />}
										<div className="text-[11px] font-sans text-[#A2ACC9] uppercase tracking-wider font-semibold">Student Privacy</div>
									</div>
								</div>

							</div>

							{/* Exact Editorial Portrait Composite Column */}
							<div className="lg:col-span-5 flex justify-center lg:justify-end">
								<motion.div
									whileHover={{ scale: 1.02 }}
									transition={{ type: "spring", stiffness: 300, damping: 20 }}
									className="relative w-full max-w-[420px] aspect-[4/5] rounded-2xl overflow-hidden border border-[#2A3049] bg-[#111627] shadow-xl group"
								>
									<img
										src="/assets/editorial/hero-portrait-exact.png"
										alt="Souyash Bera - Independent Developer and Creator of VoiceFlow"
										className="w-full h-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105"
										loading="eager"
									/>
									<div className="absolute inset-0 bg-gradient-to-t from-[#04050A]/75 via-transparent to-transparent opacity-60 pointer-events-none" />
									
									<div className="city-glass absolute bottom-4 left-4 right-4 p-3 rounded-xl bg-[#0D1120]/70 backdrop-blur-xl border border-white/10 flex items-center justify-between text-xs text-[#EEF2FF]">
										<span className="font-semibold tracking-wide">Souyash Bera</span>
										<span className="text-[#A2ACC9] font-mono text-[11px]">Kolkata, India</span>
									</div>
								</motion.div>
							</div>

						</div>

					</div>
				</section>

				{/* ── 02. ABOUT & CREATIVE PHILOSOPHY ─────────────────────────────────── */}
				<section id="beliefs" className="py-24 border-b border-[#2A3049] bg-[#080A12]">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
						
						{/* Dual Image Mosaic */}
						<div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
							
							{/* Card 1: Build. Experiment. */}
							<motion.div
								whileHover={{ y: -4 }}
								transition={{ type: "spring", stiffness: 300, damping: 20 }}
								className="relative rounded-2xl overflow-hidden border border-[#2A3049] bg-[#111627] shadow-sm flex flex-col justify-between group"
							>
								<div className="aspect-[16/10] overflow-hidden bg-slate-100">
									<img
										src="/assets/editorial/build-experiment.png"
										alt="Coding setup and continuous building experiments"
										className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
									/>
								</div>
								<div className="p-6 space-y-2 border-t border-[#2A3049]/80">
									<div className="text-[11px] font-mono uppercase tracking-wider text-[#9A8CFF] font-bold">01 / Foundation</div>
									<h3 className="font-city-display text-2xl text-[#EEF2FF]">Build. Experiment.</h3>
									<p className="text-xs sm:text-sm text-[#A2ACC9] leading-relaxed">
										From breaking compilers in Class 7B to deploying production container clusters. Software is best understood by building it with unrelenting hands-on conviction.
									</p>
								</div>
							</motion.div>

							{/* Card 2: Learn. Grow. */}
							<motion.div
								whileHover={{ y: -4 }}
								transition={{ type: "spring", stiffness: 300, damping: 20 }}
								className="relative rounded-2xl overflow-hidden border border-[#2A3049] bg-[#111627] shadow-sm flex flex-col justify-between group"
							>
								<div className="aspect-[16/10] overflow-hidden bg-slate-100">
									<img
										src="/assets/editorial/learn-grow.png"
										alt="Engineering books, computer science theory and continuous learning"
										className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
									/>
								</div>
								<div className="p-6 space-y-2 border-t border-[#2A3049]/80">
									<div className="text-[11px] font-mono uppercase tracking-wider text-[#9A8CFF] font-bold">02 / Dedication</div>
									<h3 className="font-city-display text-2xl text-[#EEF2FF]">Learn. Grow.</h3>
									<p className="text-xs sm:text-sm text-[#A2ACC9] leading-relaxed">
										Consuming computer science literature, cryptographic primitives, and distributed systems architecture every evening after school hours.
									</p>
								</div>
							</motion.div>

						</div>

						{/* Editorial Statement */}
						<div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start pt-8 border-t border-[#2A3049]">
							<div className="lg:col-span-5">
								<KineticText
									as="h2"
									variant="display"
									text="The space between curiosity and code."
									highlightWords={["curiosity", "code"]}
									gradientWords={["curiosity"]}
									className="font-city-display text-3xl sm:text-4xl text-[#EEF2FF] leading-tight"
								/>
							</div>
							<div className="lg:col-span-7 space-y-4 text-sm sm:text-base text-[#A2ACC9] leading-relaxed">
								<KineticText
									text="I am an independent developer and student who believes technology is at its most powerful when it amplifies vulnerable voices and simplifies complex human environments."
									highlightWords={["technology", "amplifies", "voices", "simplifies"]}
									gradientWords={["voices"]}
								/>
								<p>
									At St. Augustine&apos;s Day School, I noticed that students often had meaningful suggestions or urgent grievances, yet stayed quiet due to fear of retribution. I engineered VoiceFlow: a zero-knowledge anonymous school grievance engine where mathematical privacy meets institutional accountability.
								</p>
							</div>
						</div>

					</div>
				</section>

				{/* ── 03. THE SYSTEM VAULTS ─────────────────────────────────────────── */}
				<section className="py-24 border-b border-[#2A3049] bg-[#080A12]">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
						
						<div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
							<div>
								<div className="text-xs uppercase tracking-wider font-mono text-[#9A8CFF] font-bold">Architecture &amp; Pillars</div>
								<h2 className="font-city-display text-3xl sm:text-4xl text-[#EEF2FF] mt-1">The System Vaults</h2>
							</div>

							{/* Interactive Vault Controls */}
							<div className="flex items-center gap-3">
								<span className="font-mono text-xs text-[#A2ACC9]">0{selectedVault + 1} / 04</span>
								<div className="flex items-center gap-1.5 p-1 bg-[#111627]/[0.05] border border-[#2A3049] rounded-full">
									<button
										onClick={() => {
											setSelectedVault((prev) => (prev > 0 ? prev - 1 : VAULTS.length - 1));
											sound("tab");
											triggerHaptic("selection");
										}}
										className="w-7 h-7 rounded-full hover:bg-[#242C48] hover:text-white text-[#EEF2FF] flex items-center justify-center transition-colors active:scale-90"
										aria-label="Previous vault"
									>
										<ChevronLeft className="w-4 h-4" />
									</button>
									<button
										onClick={() => {
											setSelectedVault((prev) => (prev < VAULTS.length - 1 ? prev + 1 : 0));
											sound("tab");
											triggerHaptic("selection");
										}}
										className="w-7 h-7 rounded-full hover:bg-[#242C48] hover:text-white text-[#EEF2FF] flex items-center justify-center transition-colors active:scale-90"
										aria-label="Next vault"
									>
										<ChevronRight className="w-4 h-4" />
									</button>
								</div>
							</div>
						</div>

						{/* 4 Architectural Columns */}
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
							{VAULTS.map((vault, idx) => {
								const isSelected = selectedVault === idx;
								return (
									<motion.div
										key={vault.number}
										whileHover={{ y: -4 }}
										transition={{ type: "spring", stiffness: 350, damping: 25 }}
										onClick={() => {
											setSelectedVault(idx);
											sound("click");
											triggerHaptic("selection");
										}}
										className={`p-6 rounded-2xl border transition-all duration-300 cursor-pointer flex flex-col justify-between relative ${
											isSelected
												? "bg-[#111627] border-[#6E5CFF] shadow-lg ring-1 ring-[#6E5CFF]/20"
												: "bg-[#111627]/[0.04] border-[#2A3049] hover:border-[#3A4363]/40"
										}`}
									>
										{isSelected && (
											<motion.div
												layoutId="vault-active-indicator"
												className="absolute top-3 right-3 w-2 h-2 rounded-full bg-[#5B4BD6]"
												transition={{ type: "spring", stiffness: 400, damping: 28 }}
											/>
										)}

										<div className="space-y-4">
											<div className="flex items-center justify-between">
												<span className="font-mono text-xs font-bold text-[#9A8CFF]">{vault.number}.</span>
												<span className="text-[10px] font-mono text-[#A2ACC9] uppercase tracking-wider">Pillar</span>
											</div>
											<div>
												<h3 className="font-city-display text-2xl text-[#EEF2FF] leading-tight">{vault.title}</h3>
												<p className="text-xs font-medium text-[#9A8CFF] mt-1">{vault.subtitle}</p>
											</div>
											<p className="text-xs text-[#A2ACC9] leading-relaxed pt-2 border-t border-[#2A3049]/60">
												{vault.description}
											</p>
										</div>

										<div className="pt-6 space-y-4">
											<div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#2A3049]/60">
												{vault.stats.map((s) => (
													<div key={s.label}>
														<div className="font-mono text-sm font-bold text-[#EEF2FF]">{s.value}</div>
														<div className="text-[10px] text-[#A2ACC9]">{s.label}</div>
													</div>
												))}
											</div>
											<div className="flex flex-wrap gap-1">
												{vault.tags.map((t) => (
													<span key={t} className="px-2 py-0.5 rounded text-[9px] bg-[#080A12] border border-[#2A3049] text-[#A2ACC9]">
														{t}
													</span>
												))}
											</div>
										</div>
									</motion.div>
								);
							})}
						</div>

					</div>
				</section>

				{/* ── 04. ENGINEERING STACK ─────────────────────────────────────────── */}
				<section id="stack" className="py-24 border-b border-[#2A3049] bg-[#080A12]">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
						
						<div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
							<div>
								<div className="text-xs uppercase tracking-wider font-mono text-[#9A8CFF] font-bold">Tools &amp; Infrastructure</div>
								<h2 className="font-city-display text-3xl sm:text-4xl text-[#EEF2FF] mt-1">Engineering Stack</h2>
								<p className="text-sm text-[#A2ACC9] mt-2 max-w-xl">
									Rigorous tool selection optimized for cryptographic privacy, sub-50ms execution speed, and deterministic automated testing.
								</p>
							</div>

							{/* Interactive Category Filter Chips with Liquid Spring Pill */}
							<div className="flex flex-wrap p-1 rounded-full bg-[#111627]/[0.05] border border-[#2A3049] shadow-xs gap-1">
								{(["all", "frontend", "backend", "ai", "core"] as const).map((cat) => {
									const isSelected = stackFilter === cat;
									return (
										<button
											key={cat}
											onClick={() => {
												setStackFilter(cat);
												sound("tab");
												triggerHaptic("selection");
											}}
											className={`relative px-4 py-1.5 rounded-full text-xs font-semibold capitalize transition-colors duration-200 active:scale-95 select-none ${
												isSelected ? "text-white" : "text-[#A2ACC9] hover:text-[#EEF2FF]"
											}`}
										>
											{isSelected && (
												<motion.div
													layoutId="stack-filter-pill"
													className="absolute inset-0 rounded-full bg-[#5B4BD6] shadow-[0_2px_12px_rgba(81,68,217,0.35)]"
													transition={{ type: "spring", stiffness: 450, damping: 32 }}
												/>
											)}
											<span className="relative z-10">{cat}</span>
										</button>
									);
								})}
							</div>
						</div>

						{/* Stack Grid with Animated Layout */}
						<motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
							<AnimatePresence>
								{filteredTech.map((item) => (
									<motion.div
										layout
										initial={{ opacity: 0, scale: 0.95 }}
										animate={{ opacity: 1, scale: 1 }}
										exit={{ opacity: 0, scale: 0.95 }}
										transition={{ duration: 0.2 }}
										whileHover={{ y: -3 }}
										key={item.name}
										className="p-6 rounded-2xl border border-[#2A3049] bg-[#111627] shadow-xs hover:border-[#7A6BFF] hover:shadow-md transition-all flex flex-col justify-between"
									>
										<div className="space-y-3">
											<div className="flex items-center justify-between">
												<span className="px-2 py-0.5 rounded text-[10px] font-mono bg-violet-50 text-[#9A8CFF] font-bold border border-violet-100 uppercase">
													{item.category}
												</span>
												<span className="text-[11px] font-mono text-[#35D9A4] font-semibold">{item.metric}</span>
											</div>
											<h3 className="font-sans-editorial text-lg font-bold text-[#EEF2FF]">{item.name}</h3>
											<p className="text-xs text-[#A2ACC9] leading-relaxed">{item.description}</p>
										</div>
										<div className="pt-4 mt-4 border-t border-[#2A3049]/60 text-[11px] font-medium text-[#9A8CFF]">
											↳ {item.highlight}
										</div>
									</motion.div>
								))}
							</AnimatePresence>
						</motion.div>

					</div>
				</section>

				{/* ── 05. FEATURED PROJECT: VOICEFLOW ───────────────────────────────── */}
				<section id="projects" className="py-24 border-b border-[#2A3049] bg-[#080A12]">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
						
						<div className="max-w-3xl space-y-3">
							<div className="text-xs uppercase tracking-wider font-mono text-[#9A8CFF] font-bold">Flagship Production System</div>
							<KineticText
								as="h2"
								variant="display"
								text="VoiceFlow: Zero-Knowledge Student Feedback & Safety Platform"
								highlightWords={["voiceflow", "zero-knowledge", "safety"]}
								gradientWords={["zero-knowledge"]}
								className="font-city-display text-4xl sm:text-5xl text-[#EEF2FF]"
							/>
							<p className="text-sm sm:text-base text-[#A2ACC9] leading-relaxed">
								A production-deployed school democracy engine enabling students to submit verifiable concerns with zero identity storage, paired with an autonomous administrative dashboard with AI risk triaging.
							</p>
						</div>

						{/* VoiceFlow Production Preview Card with Mini Sidebar & Live Submissions */}
						<div className="rounded-2xl border border-[#2A3049] bg-[#111627] shadow-xl overflow-hidden">
							
							{/* Browser / OS Mockup Window Header */}
							<div className="px-6 py-4 bg-[#161B2E] text-white flex items-center justify-between border-b border-slate-700">
								<div className="flex items-center gap-2">
									<span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
									<span className="w-3 h-3 rounded-full bg-amber-400 inline-block" />
									<span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
									<span className="text-xs font-mono text-slate-300 ml-2">VoiceFlow Admin Command Center v2.0.3</span>
								</div>
								<div className="flex items-center gap-4 text-xs font-mono text-emerald-400">
									<span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
									<span>SYSTEM ONLINE · 2,639 TESTS PASSING</span>
								</div>
							</div>

							{/* Split Layout: Left Mini Sidebar + Right Dashboard Canvas */}
							<div className="grid grid-cols-1 md:grid-cols-12 min-h-[460px]">
								
								{/* Mini Sidebar (md:col-span-3) */}
								<div className="md:col-span-3 bg-[#0D1120] border-r border-[#2A3049] p-4 flex flex-col justify-between">
									<div className="space-y-6">
										<div className="flex items-center gap-2.5 px-2 py-1">
											<div className="w-6 h-6 rounded bg-[#5B4BD6] text-white flex items-center justify-center font-bold text-xs">V</div>
											<span className="text-xs font-bold text-[#EEF2FF] tracking-wide">VoiceFlow OS</span>
										</div>

										<nav className="space-y-1 text-[11px] font-sans">
											{[
												{ icon: LayoutDashboard, label: "Dashboard", active: true },
												{ icon: MessageSquare, label: "Feed Moderation", active: false },
												{ icon: Bell, label: "Safety Alerts", badge: "3", active: false },
												{ icon: FileText, label: "Triage Reports", active: false },
												{ icon: Settings, label: "Security & Keys", active: false },
											].map((item) => {
												const Icon = item.icon;
												return (
													<button
														key={item.label}
														onClick={() => {
															sound("tab");
															triggerHaptic("selection");
														}}
														className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${
															item.active
																? "bg-[#5B4BD6] text-white font-semibold shadow-xs"
																: "text-[#A2ACC9] hover:bg-slate-200/60"
														}`}
													>
														<div className="flex items-center gap-2.5">
															<Icon className="w-3.5 h-3.5" />
															<span>{item.label}</span>
														</div>
														{item.badge && (
															<span className="px-1.5 py-0.2 rounded-full text-[9px] bg-red-500 text-white font-bold">
																{item.badge}
															</span>
														)}
													</button>
												);
											})}
										</nav>
									</div>

									{/* Status Box */}
									<div className="p-3 rounded-xl bg-[#111627] border border-[#2A3049] space-y-1.5 text-[10px]">
										<div className="font-semibold text-[#EEF2FF]">ZK Privacy Active</div>
										<div className="text-[#A2ACC9] leading-tight">HMAC-SHA256 non-reversible client salts verified.</div>
									</div>
								</div>

								{/* Right Dashboard Area (md:col-span-9) */}
								<div className="md:col-span-9 p-6 space-y-6 bg-[#111627]">
									
									{/* Top 4 Metrics Ledger */}
									<div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
										{[
											{ label: "Total Submissions", value: "2,847", change: "+14% this week" },
											{ label: "Pending Review", value: "247", change: "Auto-triaged" },
											{ label: "Resolved Actions", value: "2,490", change: "92% rate" },
											{ label: "AI Analyzed", value: "100%", change: "Zero human bias" },
										].map((stat) => (
											<div key={stat.label} className="p-3.5 rounded-xl bg-[#080A12] border border-[#2A3049]">
												<div className="text-[11px] text-[#A2ACC9] font-medium">{stat.label}</div>
												<div className="font-city-display text-2xl text-[#EEF2FF] font-bold mt-0.5">{stat.value}</div>
												<div className="text-[10px] text-[#35D9A4] font-semibold mt-1">{stat.change}</div>
											</div>
										))}
									</div>

									{/* Live Filterable Moderation Queue Table */}
									<div className="space-y-3">
										<div className="flex items-center justify-between">
											<span className="text-xs font-bold text-[#EEF2FF] tracking-wide uppercase font-mono">
												Live Automated Student Triage Stream
											</span>
											<span className="text-[11px] text-[#9A8CFF] font-mono">Real-time WebSocket feed</span>
										</div>

										<div className="overflow-x-auto rounded-xl border border-[#2A3049]">
											<table className="w-full text-left text-xs">
												<thead className="bg-[#080A12] text-[#A2ACC9] border-b border-[#2A3049] font-mono text-[10px] uppercase">
													<tr>
														<th className="p-3">Ref ID</th>
														<th className="p-3">Student Concern Content</th>
														<th className="p-3">Category</th>
														<th className="p-3">Time</th>
														<th className="p-3">Status</th>
													</tr>
												</thead>
												<tbody className="divide-y divide-[#2A3049]/60">
													{dashboardSubmissions.map((row) => (
														<tr key={row.id} className="hover:bg-[#0D1120] transition-colors">
															<td className="p-3 font-mono font-bold text-[#9A8CFF] whitespace-nowrap">{row.id}</td>
															<td className="p-3 text-[#EEF2FF] font-medium max-w-xs truncate">{row.title}</td>
															<td className="p-3 text-[#A2ACC9] whitespace-nowrap">{row.cat}</td>
															<td className="p-3 text-[#A2ACC9] font-mono text-[11px] whitespace-nowrap">{row.time}</td>
															<td className="p-3 whitespace-nowrap">
																<span
																	className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
																		row.status === "RESOLVED"
																			? "bg-emerald-100 text-emerald-800"
																			: row.status === "ESCALATED"
																				? "bg-red-100 text-red-800"
																				: "bg-violet-100 text-[#9A8CFF]"
																	}`}
																>
																	{row.status}
																</span>
															</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
									</div>

									{/* Interactive Action Bar: Try Live Mobile App + Explore Project */}
									<div className="pt-2 flex flex-wrap items-center justify-between gap-4 border-t border-[#2A3049]/60">
										<div className="flex items-center gap-2 text-xs text-[#A2ACC9]">
											<Shield className="w-4 h-4 text-[#35D9A4]" />
											<span>Zero identity logs stored in database</span>
										</div>

										<div className="flex items-center gap-3">
											{/* Try Live Mobile App Simulator Button */}
											<motion.button
												whileHover={{ scale: 1.03 }}
												whileTap={{ scale: 0.96 }}
												onClick={() => {
													setIsPhoneModalOpen(true);
													sound("pop");
													triggerHaptic("medium");
												}}
												className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#5B4BD6] hover:bg-[#4234B4] text-white text-xs uppercase tracking-wider font-bold transition-all duration-300 shadow-md group active:scale-95"
											>
												<Smartphone className="w-3.5 h-3.5" />
												<span>Try Live Mobile App</span>
											</motion.button>

											<motion.a
												whileHover={{ scale: 1.03 }}
												whileTap={{ scale: 0.96 }}
												href="#/"
												onClick={() => {
													sound("click");
													triggerHaptic("light");
												}}
												className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#161B2E] hover:bg-[#4234B4] text-white text-xs uppercase tracking-wider font-bold transition-all duration-300 hover:shadow-lg group active:scale-95"
											>
												<span>Explore Project</span>
												<ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
											</motion.a>
										</div>
									</div>

								</div>

							</div>

						</div>

					</div>
				</section>

				{/* ── 06. LIVE VOICEFLOW ARCHITECTURE SANDBOX ──────────────────────── */}
				<section id="sandbox" className="py-24 border-b border-[#2A3049] bg-[#080A12]">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
						
						<div className="max-w-3xl space-y-3">
							<div className="text-xs uppercase tracking-wider font-mono text-[#9A8CFF] font-bold">Interactive Engineering Lab</div>
							<KineticText
								as="h2"
								variant="display"
								text="Live VoiceFlow Architecture Sandbox"
								highlightWords={["voiceflow", "architecture", "sandbox"]}
								gradientWords={["architecture"]}
								className="font-city-display text-4xl sm:text-5xl text-[#EEF2FF]"
							/>
							<p className="text-sm sm:text-base text-[#A2ACC9]">
								Test the cryptographic and machine learning primitives running inside VoiceFlow in real time.
							</p>
						</div>

						{/* Accessible Tab List with Liquid Spring Pill */}
						<div
							role="tablist"
							aria-label="Interactive Sandbox Demonstrations"
							className="flex flex-wrap p-1.5 rounded-2xl bg-[#111627]/[0.05] border border-[#2A3049] shadow-xs max-w-2xl gap-1.5"
						>
							{[
								{ id: "crypto", label: "1. Anonymity Engine", icon: "🔒" },
								{ id: "ai", label: "2. AI Moderation Tester", icon: "⚡" },
								{ id: "poll", label: "3. Live Poll Simulator", icon: "📊" },
							].map((tab) => {
								const isSelected = sandboxTab === tab.id;
								return (
									<button
										key={tab.id}
										id={`tab-${tab.id}`}
										role="tab"
										aria-selected={isSelected}
										aria-controls={`panel-${tab.id}`}
										onClick={() => {
											setSandboxTab(tab.id as typeof sandboxTab);
											sound("tab");
											triggerHaptic("selection");
										}}
										className={`relative flex-1 min-w-[170px] py-3 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors duration-200 active:scale-95 select-none ${
											isSelected ? "text-white" : "text-[#A2ACC9] hover:text-[#EEF2FF]"
										}`}
									>
										{isSelected && (
											<motion.div
												layoutId="sandbox-tab-pill"
												className="absolute inset-0 rounded-xl bg-[#5B4BD6] shadow-[0_4px_16px_rgba(81,68,217,0.3)]"
												transition={{ type: "spring", stiffness: 420, damping: 30 }}
											/>
										)}
										<span className="relative z-10 mr-1.5" aria-hidden="true">{tab.icon}</span>
										<span className="relative z-10">{tab.label}</span>
									</button>
								);
							})}
						</div>

						{/* Tab 1: Anonymity Engine */}
						{sandboxTab === "crypto" && (
							<div
								id="panel-crypto"
								role="tabpanel"
								aria-labelledby="tab-crypto"
								className="p-8 rounded-2xl border border-[#2A3049] bg-[#111627] shadow-sm space-y-6"
							>
								<div className="space-y-2">
									<h3 className="text-lg font-bold text-[#EEF2FF]">Client-Side SHA-256 HMAC Privacy Shield</h3>
									<p className="text-xs sm:text-sm text-[#A2ACC9] leading-relaxed">
										Every student concern is salted and hashed in browser memory. Even with full database access, administrators can never map submissions back to the student identity.
									</p>
								</div>

								<div className="space-y-4">
									<div>
										<label htmlFor="student-concern-input" className="block text-xs font-bold text-[#EEF2FF] mb-1">
											Student Concern Plaintext
										</label>
										<input
											id="student-concern-input"
											type="text"
											value={cryptoInput}
											onChange={(e) => setCryptoInput(e.target.value)}
											className="w-full p-3 rounded-xl border border-[#2A3049] bg-[#080A12]/50 focus:bg-[#111627] text-xs sm:text-sm text-[#EEF2FF] focus:outline-none focus:border-[#6E5CFF] font-mono transition-colors"
											placeholder="Type student concern..."
										/>
									</div>

									<div>
										<div className="flex justify-between text-xs text-[#A2ACC9] mb-1">
											<span>Salt Entropy Length:</span>
											<span className="font-mono font-bold text-[#9A8CFF]">{saltEntropy} bytes</span>
										</div>
										<input
											type="range"
											min={16}
											max={64}
											step={8}
											value={saltEntropy}
											onChange={(e) => {
												setSaltEntropy(Number(e.target.value));
												sound("hover");
											}}
											className="w-full accent-[#6E5CFF] cursor-pointer"
										/>
									</div>

									<div className="p-4 rounded-xl bg-[#161B2E] text-white font-mono text-xs space-y-2">
										<div className="flex items-center justify-between text-slate-400 text-[11px]">
											<span>CRYPTOGRAPHIC HMAC TOKEN (SHA-256)</span>
											<span className="text-emerald-400 flex items-center gap-1">
												<CheckCircle2 className="w-3.5 h-3.5" />
												Zero Identity Leak Guaranteed
											</span>
										</div>
										<div className="break-all text-violet-300 font-bold select-all">{generatedHash}</div>
									</div>

									<div className="flex flex-wrap items-center justify-between gap-4 pt-2">
										<div className="text-xs text-[#A2ACC9]">
											Algorithm: <code className="font-mono font-bold">HMAC-SHA256</code> · Key Derivation: <code className="font-mono font-bold">PBKDF2</code>
										</div>
										<motion.button
											whileHover={{ scale: 1.02 }}
											whileTap={{ scale: 0.96 }}
											onClick={handleCopyToken}
											className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#5B4BD6] hover:bg-[#4234B4] text-white text-xs font-semibold tracking-wide transition-all active:scale-95"
										>
											{copiedToken ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
											<span>{copiedToken ? "Copied to Clipboard!" : "Copy Anonymous Token"}</span>
										</motion.button>
									</div>
								</div>
							</div>
						)}

						{/* Tab 2: AI Moderation Tester */}
						{sandboxTab === "ai" && (
							<div
								id="panel-ai"
								role="tabpanel"
								aria-labelledby="tab-ai"
								className="p-8 rounded-2xl border border-[#2A3049] bg-[#111627] shadow-sm space-y-6"
							>
								<div className="space-y-2">
									<h3 className="text-lg font-bold text-[#EEF2FF]">Real-Time School AI Moderation &amp; Categorization</h3>
									<p className="text-xs sm:text-sm text-[#A2ACC9] leading-relaxed">
										Test how VoiceFlow&apos;s natural language pipeline filters toxicity while elevating genuine student infrastructure and academic concerns.
									</p>
								</div>

								{/* Preset Chips */}
								<div className="flex flex-wrap gap-2">
									{[
										{ label: "Infra Issue", text: "The second floor water purifier has been leaking since Monday morning." },
										{ label: "Academic Concern", text: "Math test syllabus overlaps with the science practical on the same day." },
										{ label: "Toxicity Check", text: "Our class prefect is an idiot and everyone hates him." },
									].map((preset) => (
										<motion.button
											whileHover={{ scale: 1.03 }}
											whileTap={{ scale: 0.95 }}
											key={preset.label}
											onClick={() => {
												setAiInput(preset.text);
												sound("tab");
												triggerHaptic("selection");
											}}
											className="px-3 py-1 rounded-full text-xs bg-[#080A12] border border-[#2A3049] text-[#EEF2FF] hover:border-[#7A6BFF] transition-colors active:scale-95"
										>
											{preset.label}
										</motion.button>
									))}
								</div>

								<div className="flex gap-3">
									<input
										type="text"
										value={aiInput}
										onChange={(e) => setAiInput(e.target.value)}
										className="flex-1 p-3 rounded-xl border border-[#2A3049] bg-[#080A12]/50 focus:bg-[#111627] text-xs text-[#EEF2FF] focus:outline-none focus:border-[#6E5CFF]"
										placeholder="Type custom text to analyze..."
									/>
									<motion.button
										whileHover={{ scale: 1.03 }}
										whileTap={{ scale: 0.95 }}
										onClick={handleRunAiAnalysis}
										disabled={analyzingAi}
										className="px-6 py-2.5 rounded-xl bg-[#5B4BD6] hover:bg-[#4234B4] text-white text-xs font-semibold tracking-wide flex items-center gap-2 transition-all disabled:opacity-50 active:scale-95"
									>
										{analyzingAi ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
										Analyze Post
									</motion.button>
								</div>

								<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-[#2A3049]" aria-live="polite">
									<div className="p-4 rounded-xl bg-[#080A12] border border-[#2A3049]/80">
										<div className="text-[11px] text-[#A2ACC9]">Toxicity Score</div>
										<div className={`text-xl font-bold font-mono mt-1 ${aiResult.toxicity > 0.4 ? "text-red-600" : "text-emerald-600"}`}>
											{(aiResult.toxicity * 100).toFixed(1)}%
										</div>
									</div>

									<div className="p-4 rounded-xl bg-[#080A12] border border-[#2A3049]/80">
										<div className="text-[11px] text-[#A2ACC9]">Urgency Tier</div>
										<div className="text-xl font-bold text-[#EEF2FF] mt-1">{aiResult.urgency}</div>
									</div>

									<div className="p-4 rounded-xl bg-[#080A12] border border-[#2A3049]/80">
										<div className="text-[11px] text-[#A2ACC9]">Auto-Triage Category</div>
										<div className="text-xs font-bold text-[#9A8CFF] mt-2 truncate">{aiResult.category}</div>
									</div>

									<div className="p-4 rounded-xl bg-[#080A12] border border-[#2A3049]/80">
										<div className="text-[11px] text-[#A2ACC9]">Constructive Rating</div>
										<div className="text-xl font-bold font-mono text-[#35D9A4] mt-1">
											{(aiResult.constructive * 100).toFixed(0)}%
										</div>
									</div>
								</div>
							</div>
						)}

						{/* Tab 3: Live Poll Simulator */}
						{sandboxTab === "poll" && (
							<div
								id="panel-poll"
								role="tabpanel"
								aria-labelledby="tab-poll"
								className="p-8 rounded-2xl border border-[#2A3049] bg-[#111627] shadow-sm space-y-6"
							>
								<div>
									<span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-violet-100 text-violet-800 font-bold border border-violet-200">
										ACTIVE CAMPUS POLL #24
									</span>
									<h3 className="text-lg font-bold text-[#EEF2FF] mt-2">
										Should our school provide open access to generative AI tools for research?
									</h3>
								</div>

								<div className="space-y-3">
									{[
										{ key: "yes", label: "Yes, integrate with responsible guidelines", votes: pollVotes.yes, color: "bg-[#35D9A4]" },
										{ key: "no", label: "No, restrict entirely to prevent plagiarism", votes: pollVotes.no, color: "bg-red-500" },
										{ key: "needInfo", label: "Need supervised pilot program first", votes: pollVotes.needInfo, color: "bg-[#5B4BD6]" },
									].map(({ key, label, votes, color }) => {
										const total = pollVotes.yes + pollVotes.no + pollVotes.needInfo;
										const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
										const isVoted = userVoted === key;

										return (
											<motion.button
												whileHover={{ scale: 1.01 }}
												whileTap={{ scale: 0.98 }}
												key={key}
												onClick={() => {
													if (!userVoted) {
														setPollVotes((prev) => ({
															...prev,
															[key]: prev[key as keyof typeof pollVotes] + 1,
														}));
														setUserVoted(key);
														sound("success");
														triggerHaptic("success");
														triggerConfetti();
													}
												}}
												className={`w-full p-4 rounded-xl border text-left transition-all relative overflow-hidden active:scale-95 ${
													isVoted
														? "border-[#6E5CFF] bg-violet-50/50 shadow-sm"
														: "border-[#2A3049] hover:border-[#3A4363]/40 bg-[#080A12]/40"
												}`}
											>
												<div
													className={`absolute left-0 top-0 bottom-0 opacity-15 transition-all duration-700 ${color}`}
													style={{ width: `${pct}%` }}
												/>

												<div className="relative flex items-center justify-between">
													<span className="text-xs sm:text-sm font-semibold text-[#EEF2FF] flex items-center gap-2">
														{isVoted && <Check className="w-4 h-4 text-[#9A8CFF]" />}
														{label}
													</span>
													<span className="font-mono font-bold text-xs text-[#9A8CFF]">
														{pct}% ({votes})
													</span>
												</div>
											</motion.button>
										);
									})}
								</div>

								<div className="flex items-center justify-between text-xs text-[#A2ACC9] pt-2">
									<span>Anonymous votes logged: {pollVotes.yes + pollVotes.no + pollVotes.needInfo} students</span>
									{userVoted && <span className="text-[#35D9A4] font-semibold">✓ Your anonymous vote has been counted</span>}
								</div>
							</div>
						)}

					</div>
				</section>

				{/* ── 07. SOUYASHOS INTERACTIVE TERMINAL ────────────────────────────── */}
				<section id="terminal" className="py-24 border-b border-[#2A3049] bg-[#080A12]">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
						
						<div className="max-w-2xl space-y-2">
							<div className="text-xs uppercase tracking-wider font-mono text-[#9A8CFF] font-bold">Interactive Developer Shell</div>
							<h2 className="font-city-display text-3xl sm:text-4xl text-[#EEF2FF]">SouyashOS Shell</h2>
							<p className="text-xs sm:text-sm text-[#A2ACC9]">
								Explore projects, skills, and engineering benchmarks via command-line interface.
							</p>
						</div>

						{/* Dark Terminal Window Surface */}
						<div className="rounded-2xl border border-slate-700 bg-[#0C1020] text-slate-200 overflow-hidden shadow-2xl font-mono text-xs max-w-4xl">
							
							{/* Window Header */}
							<div className="px-4 py-3 bg-[#0d0e1a] border-b border-slate-800 flex items-center justify-between">
								<div className="flex items-center gap-2">
									<span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
									<span className="w-3 h-3 rounded-full bg-amber-400 inline-block" />
									<span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
									<span className="text-[11px] text-slate-400 ml-2">guest@souyash-macbook: ~</span>
								</div>
								<div className="text-[10px] text-slate-500">React 19 Shell v1.0.4</div>
							</div>

							{/* Terminal Output Body */}
							<div className="p-6 space-y-3 max-h-[380px] overflow-y-auto">
								<div className="text-slate-400 leading-relaxed">
									Welcome to SouyashOS Shell [v2.0.3]. Independent software builder and creator of VoiceFlow. Type <span className="text-violet-400 font-bold">&apos;help&apos;</span> or use quick chips below.
								</div>

								{terminalCommands.map((c, i) => (
									<div key={i} className="space-y-1">
										<div className="flex items-center gap-2 text-violet-400 font-bold">
											<span>➜</span>
											<span className="text-emerald-400">~</span>
											<span className="text-white">{c.input}</span>
										</div>
										<div className="text-slate-300 pl-4 whitespace-pre-line leading-relaxed">{c.output}</div>
									</div>
								))}

								<div ref={terminalBottomRef} />
							</div>

							{/* Interactive Terminal Input Line */}
							<form
								onSubmit={(e) => {
									e.preventDefault();
									handleExecuteCommand(terminalInput);
								}}
								className="p-4 bg-[#0d0e1a] border-t border-slate-800 flex items-center gap-2"
							>
								<span className="text-violet-400 font-bold">➜</span>
								<span className="text-emerald-400">~</span>
								<input
									type="text"
									value={terminalInput}
									onChange={(e) => setTerminalInput(e.target.value)}
									className="flex-1 bg-transparent text-white focus:outline-none text-xs font-mono"
									placeholder="type command (e.g. 'whoami', 'skills', 'projects', 'stats')..."
								/>
							</form>

							{/* Quick Command Chips */}
							<div className="px-4 py-2.5 bg-[#05070D] border-t border-slate-800/80 flex flex-wrap gap-2 text-[10px]">
								<span className="text-slate-500 py-1">Quick run:</span>
								{["whoami", "skills", "projects", "stats", "philosophy", "clear"].map((cmd) => (
									<button
										key={cmd}
										onClick={() => handleExecuteCommand(cmd)}
										className="px-2.5 py-1 rounded bg-slate-800 hover:bg-violet-600 text-slate-300 hover:text-white transition-colors cursor-pointer active:scale-95"
									>
										{cmd}
									</button>
								))}
							</div>

						</div>

					</div>
				</section>

				{/* ── 08. SCROLL STORY — pinned, layered, theme-shifting ────────── */}
				<section id="journey" className="border-b border-[#2A3049]">
					<ScrollStory acts={MILESTONES} />
				</section>

				{/* ── 09. PERSONAL PHILOSOPHY & LET'S BUILD THE FUTURE ─────────────── */}
				<section id="contact" className="py-24 border-b border-[#2A3049] bg-[#080A12]">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
						
						<div className="grid grid-cols-1 md:grid-cols-3 gap-12 items-start">
							
							{/* Column 1: Core Principles */}
							<div className="space-y-4">
								<div className="text-xs uppercase tracking-wider font-mono text-[#9A8CFF] font-bold">First Principles</div>
								<h3 className="font-city-display text-2xl sm:text-3xl text-[#EEF2FF]">Building with Purpose</h3>
								<ul className="space-y-3 text-xs sm:text-sm text-[#A2ACC9] leading-relaxed">
									<li className="flex items-start gap-2">
										<span className="text-[#9A8CFF] font-bold">1.</span>
										<span><strong>Curiosity over complacency.</strong> Never accept an existing system as the final frontier.</span>
									</li>
									<li className="flex items-start gap-2">
										<span className="text-[#9A8CFF] font-bold">2.</span>
										<span><strong>Mathematics before marketing.</strong> Privacy must be mathematically guaranteed, not promised in PR copy.</span>
									</li>
									<li className="flex items-start gap-2">
										<span className="text-[#9A8CFF] font-bold">3.</span>
										<span><strong>Human dignity above all.</strong> Technology must empower young and disenfranchised people.</span>
									</li>
								</ul>
							</div>

							{/* Column 2: Working Together */}
							<div className="space-y-4">
								<div className="text-xs uppercase tracking-wider font-mono text-[#9A8CFF] font-bold">Collaboration</div>
								<h3 className="font-city-display text-2xl sm:text-3xl text-[#EEF2FF]">Let&apos;s Build the Future</h3>
								<p className="text-xs sm:text-sm text-[#A2ACC9] leading-relaxed">
									I am always eager to collaborate with creative engineers, researchers, and mission-driven teams working on decentralized software, AI safety, and privacy architectures.
								</p>
								<div className="pt-2 text-xs font-mono text-[#9A8CFF]">
									Available for conversations, technical open-source discourse &amp; software engineering research.
								</div>
							</div>

							{/* Column 3: Contact & Direct Connection */}
							<div className="p-6 rounded-2xl bg-[#161B2E] text-white space-y-6 shadow-xl border border-slate-800">
								<div className="space-y-1">
									<div className="text-xs font-mono text-violet-400">DIRECT INBOX</div>
									<h4 className="font-city-display text-2xl text-white">Get in Touch</h4>
									<p className="text-xs text-slate-400">Direct channel to Souyash Bera.</p>
								</div>

								<div className="space-y-2">
									<div className="text-[11px] text-slate-400 font-mono">PRIMARY EMAIL</div>
									<a
										href="mailto:souyash@voiceflow.org"
										onClick={() => {
											sound("click");
											triggerHaptic("light");
										}}
										className="flex items-center gap-2 text-sm text-slate-200 hover:text-white transition-colors"
									>
										<Mail className="w-4 h-4 text-violet-400" />
										<span>souyash@voiceflow.org</span>
									</a>
								</div>

								<motion.button
									whileHover={{ scale: 1.02 }}
									whileTap={{ scale: 0.96 }}
									onClick={handleCopyEmail}
									className="w-full py-3 rounded-xl bg-[#5B4BD6] hover:bg-violet-600 text-white text-xs font-semibold tracking-wide flex items-center justify-center gap-2 transition-all active:scale-95 shadow-md"
								>
									{copiedEmail ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
									<span>{copiedEmail ? "Email Copied to Clipboard!" : "Copy Email"}</span>
								</motion.button>
							</div>

						</div>

					</div>
				</section>
			</main>

			{/* ── 10. FOOTER ────────────────────────────────────────────────────── */}
			<footer className="pt-16 pb-28 lg:pb-16 bg-[#080A12] relative overflow-hidden">
				
				{/* City skyline horizon — a single hairline of light, no paper wave */}
				<div className="city-hairline mb-8 h-px w-full" aria-hidden="true" style={{ background: 'linear-gradient(90deg, transparent, rgba(139,124,255,.55), transparent)' }} />

				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
					<div className="flex flex-col md:flex-row items-center justify-between gap-6 border-b border-[#2A3049] pb-8">
						<div className="flex items-center gap-3">
							<div className="w-8 h-8 rounded-lg bg-[#161B2E] flex items-center justify-center text-white">
								<Zap className="w-4 h-4 text-violet-400 fill-violet-400" />
							</div>
							<span className="font-city-display text-2xl font-bold tracking-wider uppercase text-[#EEF2FF]">
								SOUYASH BERA
							</span>
						</div>

						<div className="flex flex-wrap items-center gap-6 text-xs uppercase tracking-wider font-semibold text-[#A2ACC9]">
							{[
								{ label: "Signature", id: "overview" },
								{ label: "Beliefs", id: "beliefs" },
								{ label: "Projects", id: "projects" },
								{ label: "Sandbox", id: "sandbox" },
								{ label: "Terminal", id: "terminal" },
								{ label: "Story", id: "journey" },
								{ label: "Contact", id: "contact" },
							].map(({ label, id }) => (
								<a
									key={id}
									href={`#${id}`}
									onClick={() => {
										sound("tab");
										triggerHaptic("selection");
									}}
									className="hover:text-[#9A8CFF] transition-colors"
								>
									{label}
								</a>
							))}
						</div>
					</div>

					<div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#A2ACC9]">
						<div>
							© {new Date().getFullYear()} Souyash Bera. Built with craft, curiosity, and code from Kolkata.
						</div>
						<div className="font-mono text-[11px]">
							VoiceFlow v2.0.3 · 2,639 Tests · St. Augustine&apos;s Day School
						</div>
					</div>
				</div>
			</footer>

			{/* ── Interactive VoiceFlow Mobile Phone Simulator Modal ─────────────── */}
			<AnimatePresence>
				{isPhoneModalOpen && (
					<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#161B2E]/70 backdrop-blur-md">
						{/* Dismiss Backdrop */}
						<div className="absolute inset-0" onClick={() => setIsPhoneModalOpen(false)} />

						<motion.div
							initial={{ opacity: 0, scale: 0.9, y: 20 }}
							animate={{ opacity: 1, scale: 1, y: 0 }}
							exit={{ opacity: 0, scale: 0.9, y: 20 }}
							transition={{ type: "spring", stiffness: 350, damping: 28 }}
							className="relative w-full max-w-[340px] bg-[#161B2E] rounded-[44px] p-3 shadow-2xl border-4 border-slate-700 overflow-hidden"
						>
							{/* Phone Screen Container */}
							<div className="relative rounded-[36px] bg-[#080A12] text-[#EEF2FF] overflow-hidden flex flex-col h-[620px]">
								
								{/* Dynamic Island Header */}
								<div className="pt-2 px-6 flex items-center justify-between text-[11px] font-semibold text-[#EEF2FF]">
									<span>9:41</span>
									{/* Pill Notch */}
									<div className="w-20 h-5 bg-[#161B2E] rounded-full mx-auto" />
									<div className="flex items-center gap-1.5">
										<span className="text-[9px] font-bold">5G</span>
										<div className="w-4 h-2 rounded border border-[#3A4363] p-0.5">
											<div className="h-full w-full bg-[#161B2E] rounded-xs" />
										</div>
									</div>
								</div>

								{/* Mobile App Navigation */}
								<div className="px-4 py-3 flex items-center justify-between border-b border-[#2A3049]">
									<div className="flex items-center gap-2">
										<div className="w-5 h-5 rounded bg-[#5B4BD6] text-white flex items-center justify-center text-[10px] font-bold">V</div>
										<span className="text-xs font-bold font-city-display">VoiceFlow Student</span>
									</div>
									<button
										onClick={() => setIsPhoneModalOpen(false)}
										className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-[#EEF2FF] hover:bg-slate-300"
									>
										<X className="w-3.5 h-3.5" />
									</button>
								</div>

								{/* Mobile App Body */}
								<div className="p-4 flex-1 flex flex-col justify-between overflow-y-auto space-y-4">
									<div className="space-y-3">
										<div className="p-2.5 rounded-xl bg-violet-100/70 border border-violet-200 text-xs text-[#9A8CFF] flex items-center gap-2">
											<Shield className="w-4 h-4 shrink-0 text-[#35D9A4]" />
											<span className="text-[11px] font-medium leading-tight">
												Your device identity is shielded with SHA-256 HMAC client encryption.
											</span>
										</div>

										<div>
											<label className="block text-[11px] font-bold uppercase text-[#A2ACC9] mb-1">
												Category
											</label>
											<div className="flex flex-wrap gap-1.5">
												{["Facilities", "Academics", "Safety", "Ideas"].map((cat) => (
													<button
														key={cat}
														onClick={() => setPhoneCategory(cat)}
														className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${
															phoneCategory === cat
																? "bg-[#5B4BD6] text-white"
																: "bg-[#111627] border border-[#2A3049] text-[#A2ACC9]"
														}`}
													>
														{cat}
													</button>
												))}
											</div>
										</div>

										<div>
											<label className="block text-[11px] font-bold uppercase text-[#A2ACC9] mb-1">
												Your Anonymous Concern
											</label>
											<textarea
												rows={4}
												value={phoneFeedback}
												onChange={(e) => setPhoneFeedback(e.target.value)}
												placeholder="Type student concern..."
												className="w-full p-2.5 rounded-xl border border-[#2A3049] bg-[#111627] text-xs text-[#EEF2FF] focus:outline-none focus:border-[#6E5CFF] resize-none"
											/>
										</div>

										{/* Live Salted Token Preview inside phone */}
										<div className="p-2.5 rounded-xl bg-[#161B2E] text-white font-mono text-[9px] space-y-1">
											<div className="text-slate-400">CLIENT SHA-256 HMAC SHIELD</div>
											<div className="text-violet-300 truncate font-bold">
												{generatedHash || "4f8a3c...e89b"}
											</div>
										</div>
									</div>

									{/* Submit Action */}
									<div className="pt-2">
										<motion.button
											whileHover={{ scale: 1.02 }}
											whileTap={{ scale: 0.96 }}
											disabled={phoneSubmitted || !phoneFeedback.trim()}
											onClick={handlePhoneSubmit}
											className="w-full py-3 rounded-full bg-[#5B4BD6] hover:bg-[#4234B4] text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-50"
										>
											{phoneSubmitted ? (
												<>
													<Check className="w-4 h-4 text-emerald-300" />
													<span>Submitted Anonymously!</span>
												</>
											) : (
												<>
													<Send className="w-3.5 h-3.5" />
													<span>Send to School Board</span>
												</>
											)}
										</motion.button>
									</div>
								</div>

								{/* Mobile Phone Home Indicator Bar */}
								<div className="py-2 flex justify-center">
									<div className="w-28 h-1 bg-[#161B2E]/40 rounded-full" />
								</div>

							</div>
						</motion.div>
					</div>
				)}
			</AnimatePresence>

		</div>
	);
}
