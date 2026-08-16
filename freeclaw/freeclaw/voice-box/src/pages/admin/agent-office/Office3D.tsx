import { Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DIV_COLORS, ROOMS } from "./constants";
import type { Agent, AgentActivation, AgentState } from "./types";

/* ═══════════════════════════════════════════════════════════════
   OFFICE 3D — Pure-CSS isometric office
   The floor is a rotated plane; each agent is a counter-rotated
   "billboard" desk that stands upright and faces the camera.
   All motion is transform/opacity only (GPU), driven by REAL
   agent state from the backend — never simulated.
   ═══════════════════════════════════════════════════════════════ */

const CELL_W = 300; // world px per room column
const CELL_H = 280; // world px per room row
const COLS = 4;
const DESK_SPACING = 66;
const CARD_LIFT = 76; // px the card floats above the floor

/** Stage world size (before projection). */
const WORLD_W = COLS * CELL_W;
const WORLD_H =
	Math.ceil(ROOMS.filter((r) => r.divisions.length > 0).length / COLS) * CELL_H;

/** Screen projection of the stage (rotateX(60) rotateZ(45)). */
function project(x: number, y: number): { sx: number; sy: number } {
	return { sx: 0.7071 * (x - y), sy: 0.3536 * (x + y) };
}

/** Bounding box of the projected stage so we can center it. */
const PROJECTED = (() => {
	const corners = [
		project(0, 0),
		project(WORLD_W, 0),
		project(0, WORLD_H),
		project(WORLD_W, WORLD_H),
	];
	const xs = corners.map((c) => c.sx);
	const ys = corners.map((c) => c.sy);
	return {
		minX: Math.min(...xs),
		maxX: Math.max(...xs),
		minY: Math.min(...ys),
		maxY: Math.max(...ys),
	};
})();
const STAGE_W = Math.ceil(PROJECTED.maxX - PROJECTED.minX) + 220;
const STAGE_H = Math.ceil(PROJECTED.maxY - PROJECTED.minY) + 260;
// Floor rect top-left so its projected bbox centers in the stage
const FLOOR_L = STAGE_W / 2 - (PROJECTED.minX + PROJECTED.maxX) / 2;
const FLOOR_T = STAGE_H / 2 - (PROJECTED.minY + PROJECTED.maxY) / 2 + 60;

/** Layout: room (from ROOMS with divisions) → grid cell → desk slots. */
interface DeskSlot {
	agent: Agent;
	x: number;
	y: number;
	roomId: string;
}
interface RoomInfo {
	id: string;
	name: string;
	icon: string;
	divisions: string[];
	cx: number;
	cy: number;
}

function buildLayout(agents: Agent[]): {
	rooms: RoomInfo[];
	desks: DeskSlot[];
} {
	const rooms: RoomInfo[] = [];
	const desks: DeskSlot[] = [];
	let col = 0;
	let row = 0;
	for (const room of ROOMS) {
		if (!room.divisions.length) continue;
		const cx = col * CELL_W + CELL_W / 2;
		const cy = row * CELL_H + CELL_H / 2;
		rooms.push({
			id: room.id,
			name: room.name,
			icon: room.icon,
			divisions: room.divisions,
			cx,
			cy,
		});
		const roomAgents = agents.filter((a) =>
			room.divisions.includes(a.division),
		);
		const count = roomAgents.length;
		if (count === 0) {
			col++;
			if (col >= COLS) {
				col = 0;
				row++;
			}
			continue;
		}
		const gridCols = count <= 3 ? count : count <= 6 ? 3 : 4;
		const gridRows = Math.ceil(count / gridCols);
		roomAgents.forEach((agent, i) => {
			const gx = i % gridCols;
			const gy = Math.floor(i / gridCols);
			const x = cx + (gx - (gridCols - 1) / 2) * DESK_SPACING;
			const y = cy + (gy - (gridRows - 1) / 2) * DESK_SPACING;
			desks.push({ agent, x, y, roomId: room.id });
		});
		col++;
		if (col >= COLS) {
			col = 0;
			row++;
		}
	}
	return { rooms, desks };
}

const IDLE_STATE: AgentState = {
	agent_id: "",
	state: "idle",
	task: null,
	started_at: null,
	completed_at: null,
	progress: 0,
	result: null,
	updated_at: "",
};

function useFitScale(maxWidth: number): number {
	const ref = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () =>
			setScale(Math.max(0.35, Math.min(1, (el.clientWidth - 24) / maxWidth)));
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [maxWidth]);
	return scale;
}

/* ── Single agent desk (counter-rotated billboard) ─────────── */
function AgentDesk3D({
	slot,
	state,
	selected,
	onSelect,
	highlight,
	activation,
	working,
	searchActive,
}: {
	slot: DeskSlot;
	state: AgentState;
	selected: boolean;
	onSelect: (a: Agent) => void;
	highlight: boolean;
	activation?: AgentActivation;
	working: boolean;
	searchActive: boolean;
}) {
	const { agent, x, y } = slot;
	const divColor = DIV_COLORS[agent.division] ??
		DIV_COLORS.specialist ?? {
			bg: "bg-surface2",
			text: "text-ink2",
			border: "border-border",
		};
	const isWorking = state.state === "working" || working;
	const isVerifying = state.state === "verifying";
	const isCompleted = state.state === "completed";
	const isError = state.state === "error";
	const isActive = activation?.active !== false;
	const isAutonomous = activation?.autonomous || false;
	const dimmed = searchActive && !highlight;
	const matched = highlight && searchActive;

	return (
		<div
			className="vb3d-desk"
			style={{
				left: x,
				top: y,
				transform: `translateZ(0) rotateZ(-45deg) rotateX(-60deg)`,
			}}
		>
			{/* Light beam for working agents */}
			{isWorking && isActive && (
				<div
					className="vb3d-beam"
					style={{
						transform: `translate(-50%, -100%) translateZ(6px)`,
						height: CARD_LIFT,
					}}
				/>
			)}
			{/* Status shadow on floor */}
			<div
				className={`vb3d-desk-shadow ${isError ? "vb3d-shadow-error" : isWorking ? "vb3d-shadow-working" : isVerifying ? "vb3d-shadow-verifying" : ""}`}
				style={{ transform: `translate(-50%, -50%) translateZ(1px)` }}
			/>
			<button
				onClick={() => onSelect(agent)}
				className={`vb3d-card ${isWorking ? "vb3d-card-working" : ""} ${isVerifying ? "vb3d-card-verifying" : ""} ${isError ? "vb3d-card-error" : ""} ${isCompleted ? "vb3d-card-completed" : ""} ${!isActive ? "vb3d-card-off" : ""} ${selected ? "vb3d-card-selected" : ""} ${matched ? "vb3d-card-match" : ""}`}
				style={{
					transform: `translate(-50%, -100%) translateZ(${CARD_LIFT}px)`,
				}}
				title={`${agent.name} — ${agent.role}\n${!isActive ? "OFFLINE" : isWorking ? `Working: ${state.task?.slice(0, 60) || "..."}` : isVerifying ? `Verifying: ${state.task?.slice(0, 60) || "..."}` : isCompleted ? "Completed task" : isError ? "Error" : "Idle"}${isAutonomous ? "\n⚡ Autonomous" : ""}${dimmed ? "\n(not matching search)" : ""}`}
			>
				<div className={`vb3d-card-icon ${divColor.bg}`}>
					{agent.icon}
					{/* status dot */}
					<span
						className={`vb3d-status-dot ${!isActive ? "vb3d-dot-off" : isWorking ? "vb3d-dot-work" : isVerifying ? "vb3d-dot-verify" : isCompleted ? "vb3d-dot-done" : isError ? "vb3d-dot-error" : "vb3d-dot-idle"}`}
					/>
					{isAutonomous && isActive && <span className="vb3d-autonomous-dot" />}
				</div>
				<span
					className={`vb3d-card-name ${dimmed ? "vb3d-name-dim" : ""} ${!isActive ? "vb3d-name-off" : ""}`}
				>
					{agent.name}
				</span>
			</button>
		</div>
	);
}

/* ═══════════════════════════════════════════════════════════════
   OFFICE 3D MAIN
   ═══════════════════════════════════════════════════════════════ */
export default function Office3D({
	agents,
	agentStates,
	selectedAgentId,
	onSelectAgent,
	searchQuery,
	isConnected,
	activations,
}: {
	agents: Agent[];
	agentStates: Record<string, AgentState>;
	selectedAgentId: string | null;
	onSelectAgent: (a: Agent) => void;
	searchQuery: string;
	isConnected: boolean;
	activations?: Record<string, AgentActivation>;
}) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const scale = useFitScale(STAGE_W);

	const { rooms, desks } = useMemo(() => buildLayout(agents), [agents]);

	const stats = useMemo(() => {
		const working = Object.values(agentStates).filter(
			(s) => s.state === "working",
		).length;
		const verifying = Object.values(agentStates).filter(
			(s) => s.state === "verifying",
		).length;
		const completed = Object.values(agentStates).filter(
			(s) => s.state === "completed",
		).length;
		const error = Object.values(agentStates).filter(
			(s) => s.state === "error",
		).length;
		const inactive = activations
			? agents.filter((a) => activations[a.id]?.active === false).length
			: 0;
		const idle =
			agents.length - working - verifying - completed - error - inactive;
		return {
			working,
			verifying,
			completed,
			error,
			idle: Math.max(0, idle),
			inactive,
		};
	}, [agentStates, agents, activations]);

	const workingIds = useMemo(
		() =>
			new Set(
				Object.entries(agentStates)
					.filter(([, s]) => s.state === "working")
					.map(([id]) => id),
			),
		[agentStates],
	);
	const searchActive = searchQuery.trim().length > 0;

	return (
		<div className="space-y-3">
			{/* Connection status + live stats bar */}
			<div className="flex items-center justify-between px-1">
				<div className="flex items-center gap-3">
					<div
						className={`flex items-center gap-1.5 text-[10px] font-mono ${isConnected ? "text-emerald-400" : "text-red-400"}`}
					>
						{isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
						{isConnected ? "Live" : "Disconnected"}
					</div>
					<div className="flex items-center gap-2 text-[10px] font-mono text-ink3">
						<span className="flex items-center gap-1">
							<span className="w-2 h-2 rounded-full bg-emerald-400" />{" "}
							{stats.working} working
						</span>
						{stats.verifying > 0 && (
							<span className="flex items-center gap-1">
								<span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />{" "}
								{stats.verifying} verifying
							</span>
						)}
						<span className="flex items-center gap-1">
							<span className="w-2 h-2 rounded-full bg-sky-400" />{" "}
							{stats.completed} done
						</span>
						<span className="flex items-center gap-1">
							<span className="w-2 h-2 rounded-full bg-ink3/40" /> {stats.idle}{" "}
							idle
						</span>
						{stats.inactive > 0 && (
							<span className="flex items-center gap-1">
								<span className="w-2 h-2 rounded-full bg-ink3/20" />{" "}
								{stats.inactive} offline
							</span>
						)}
						{stats.error > 0 && (
							<span className="flex items-center gap-1">
								<span className="w-2 h-2 rounded-full bg-red-400" />{" "}
								{stats.error} error
							</span>
						)}
					</div>
				</div>
				<span className="text-[10px] text-ink3 font-mono">
					{agents.length} agents
				</span>
			</div>

			{/* ── 3D stage ─────────────────────────────────────── */}
			<div ref={wrapRef} className="vb3d-wrap">
				<div
					className="vb3d-viewport"
					style={{
						height: STAGE_H * scale,
						transform: `scale(${scale})`,
						transformOrigin: "top center",
					}}
				>
					<div
						className="vb3d-stage"
						style={{ transform: "rotateX(60deg) rotateZ(45deg)" }}
					>
						{/* Floor */}
						<div
							className="vb3d-floor"
							style={{
								left: FLOOR_L,
								top: FLOOR_T,
								width: WORLD_W,
								height: WORLD_H,
							}}
						/>
						{/* Room plaques (flat on the floor) */}
						{rooms.map((room) => {
							const d = room.divisions[0];
							const c = d
								? (DIV_COLORS[d] ?? DIV_COLORS.specialist)
								: DIV_COLORS.specialist;
							return (
								<div
									key={room.id}
									className="vb3d-room"
									style={{
										left: room.cx,
										top: room.cy,
										transform: "translate(-50%, -50%)",
									}}
								>
									<span className={`vb3d-room-name ${c?.text ?? "text-ink3"}`}>
										{room.icon} {room.name}
									</span>
								</div>
							);
						})}
						{/* Desks */}
						{desks.map((slot) => {
							const agent = slot.agent;
							const state = agentStates[agent.id] || {
								...IDLE_STATE,
								agent_id: agent.id,
							};
							const q = searchQuery.trim().toLowerCase();
							const highlight =
								q.length === 0 ||
								agent.name.toLowerCase().includes(q) ||
								agent.role.toLowerCase().includes(q) ||
								agent.description.toLowerCase().includes(q);
							return (
								<AgentDesk3D
									key={agent.id}
									slot={slot}
									state={state}
									selected={selectedAgentId === agent.id}
									onSelect={onSelectAgent}
									highlight={highlight}
									activation={activations?.[agent.id]}
									working={workingIds.has(agent.id)}
									searchActive={searchActive}
								/>
							);
						})}
					</div>
				</div>
			</div>

			<p className="text-[10px] text-ink3 font-mono px-1 flex items-center gap-2 flex-wrap">
				<span className="flex items-center gap-1">
					<span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />{" "}
					working (bobbing + beam)
				</span>
				<span className="flex items-center gap-1">
					<span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />{" "}
					verifying
				</span>
				<span className="flex items-center gap-1">
					<span className="w-2 h-2 rounded-full bg-sky-400" /> completed
				</span>
				<span className="flex items-center gap-1">
					<span className="w-2 h-2 rounded-full bg-red-400" /> error
				</span>
				<span className="flex items-center gap-1">
					<span className="w-2 h-2 rounded-full bg-violet-400" /> autonomous
				</span>
				<span className="ml-auto hidden sm:inline">
					click a desk to inspect · states are live from the agent API
				</span>
			</p>
		</div>
	);
}
