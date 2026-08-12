import type { ApplicationSnapshot } from "@earendil-works/pi-protocol";
import { describe, expect, test } from "vitest";
import { applySessionEvent, messageText, sessionEventNotice } from "../src/lib/application-state.ts";

const snapshot: ApplicationSnapshot = {
	sequence: 0,
	revision: 0,
	project: { cwd: "/workspace" },
	session: { id: "session-1" },
	status: { type: "idle" },
	thinkingLevel: "off",
	messages: [],
	queue: { steering: [], followUp: [] },
	capabilities: ["prompt"],
};

describe("application state", () => {
	test("projects streaming message updates by role and timestamp", () => {
		const started = applySessionEvent(snapshot, {
			type: "message_start",
			message: { role: "assistant", timestamp: 1, content: [{ type: "text", text: "hel" }] },
		});
		const updated = applySessionEvent(started, {
			type: "message_update",
			message: { role: "assistant", timestamp: 1, content: [{ type: "text", text: "hello" }] },
		});

		expect(updated.messages).toHaveLength(1);
		expect(messageText(updated.messages[0]!)).toBe("hello");
	});

	test("projects queue updates", () => {
		const updated = applySessionEvent(snapshot, {
			type: "queue_update",
			steering: ["redirect"],
			followUp: ["then test"],
		});
		expect(updated.queue).toEqual({ steering: ["redirect"], followUp: ["then test"] });
	});

	test("describes retry and compaction lifecycle", () => {
		expect(
			sessionEventNotice({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "rate limit" }),
		).toContain("rate limit");
		expect(sessionEventNotice({ type: "compaction_end", aborted: true })).toBe("Compaction aborted");
	});
});
