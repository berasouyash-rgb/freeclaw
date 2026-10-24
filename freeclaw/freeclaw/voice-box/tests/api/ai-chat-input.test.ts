// ═══════════════════════════════════════════════════════════════════
// AI chat input normalization — prompt-bomb protection
// ═══════════════════════════════════════════════════════════════════
// Pure-function tests: no DB, no LLM, no mocks needed.

import { describe, expect, it } from "vitest";

import {
	CHAT_INPUT_LIMITS,
	normalizeChatInput,
} from "../../api/_ai-chat.js";

const msg = (content) => ({ role: "user", content });

describe("normalizeChatInput", () => {
	it("caps the last message at 4000 chars", () => {
		const { userMessage } = normalizeChatInput({
			messages: [msg("hi"), msg("x".repeat(9000))],
		});
		expect(userMessage).toHaveLength(CHAT_INPUT_LIMITS.maxMessageChars);
	});

	it("keeps only the last 50 turns", () => {
		const messages = Array.from({ length: 120 }, (_, i) =>
			msg(`message ${i}`),
		);
		const out = normalizeChatInput({ messages });
		expect(out.messages).toHaveLength(50);
		expect(out.messages[49].content).toBe("message 119");
		expect(out.userMessage).toBe("message 119");
	});

	it("handles missing/garbage bodies without throwing", () => {
		expect(normalizeChatInput(null)).toEqual({ messages: [], userMessage: "" });
		expect(normalizeChatInput({})).toEqual({ messages: [], userMessage: "" });
		expect(normalizeChatInput({ messages: [{ role: "user" }] })).toEqual({
			messages: [{ role: "user" }],
			userMessage: "",
		});
	});
});
