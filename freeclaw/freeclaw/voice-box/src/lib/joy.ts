/**
 * Joy moments — the small, honest celebrations that make a real action feel
 * remembered. Every call here follows a confirmed server success; nothing
 * fires on an optimistic guess or a held/reviewed post.
 *
 * One shared place keeps the feel consistent across the platform (publish,
 * vote, support) and keeps it accessible: triggerHaptic honours the user's
 * sound setting, fireConfetti honours prefers-reduced-motion.
 */
import { fireConfetti } from "../components/Confetti";
import { triggerHaptic } from "./haptics";

export type JoyMoment = "publish" | "poll_publish" | "vote" | "support";

/** Warm, short confirmation copy for young students. Fact-first: the action
 *  already succeeded before this is shown; the emoji is a smile, not a claim. */
export const JOY_COPY: Record<JoyMoment, string> = {
	publish: "Your voice is out there — nice one! 🎉",
	poll_publish: "Your poll is live — thanks for asking! 🎉",
	vote: "Vote counted — your voice made a difference! 🗳️",
	support: "Support added — you helped this get seen! ✨",
};

export function celebrate(moment: JoyMoment): void {
	const big = moment === "publish" || moment === "poll_publish";
	triggerHaptic(big ? "success" : "medium");
	fireConfetti(big ? "full" : "small");
}
