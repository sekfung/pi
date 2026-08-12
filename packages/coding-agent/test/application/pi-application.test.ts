import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { describe, expect, test } from "vitest";
import {
	type ApplicationSession,
	connectExistingAgentSessionApplication,
	type InternalApplicationSessionEvent,
	submitPrompt,
} from "../../src/application/pi-application.ts";

class FakeApplicationSession implements ApplicationSession {
	isBashRunning = false;
	isCompacting = false;
	isStreaming = false;
	messages: unknown[] = [];
	model = { provider: "fake", id: "test", name: "Fake Test" };
	sessionFile = "/tmp/session.jsonl";
	sessionId = "session-1";
	sessionName: string | undefined;
	thinkingLevel: ThinkingLevel = "off";
	disposed = false;
	prompts: string[] = [];
	shellCommands: string[] = [];
	interactions: unknown[] = [{ id: "dialog-1", kind: "confirm", title: "Approve" }];
	interactionResponses: unknown[] = [];
	newSessionError: Error | undefined;
	private readonly listeners: Array<(event: InternalApplicationSessionEvent) => void> = [];

	abort(): Promise<void> {
		this.isStreaming = false;
		return Promise.resolve();
	}

	dispose(): void {
		this.disposed = true;
	}

	getFollowUpMessages(): readonly string[] {
		return [];
	}

	getSteeringMessages(): readonly string[] {
		return [];
	}

	async prompt(text: string, options: { preflightResult: (success: boolean) => void }): Promise<void> {
		this.prompts.push(text);
		this.isStreaming = true;
		options.preflightResult(true);
		const message = { role: "user" as const, content: [{ type: "text" as const, text }], timestamp: 1 };
		this.messages.push(message);
		for (const listener of this.listeners) {
			listener({ type: "message_end", message });
		}
	}

	async runShell(command: string): Promise<unknown> {
		this.shellCommands.push(command);
		return { output: "ok", exitCode: 0 };
	}

	newSession(): Promise<void> {
		if (this.newSessionError) return Promise.reject(this.newSessionError);
		return Promise.resolve();
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.thinkingLevel = level;
	}

	respondInteraction(interactionId: string, response: unknown): void {
		if (interactionId !== "dialog-1") throw new Error("Interaction not found");
		this.interactionResponses.push(response);
		this.interactions = [];
	}

	subscribe(listener: (event: InternalApplicationSessionEvent) => void): () => void {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index !== -1) this.listeners.splice(index, 1);
		};
	}
}

describe("AgentSessionApplication", () => {
	test("provides an authoritative initial snapshot and ordered events", async () => {
		const session = new FakeApplicationSession();
		const { snapshot, connection } = connectExistingAgentSessionApplication(session, "/workspace");
		expect(snapshot).toMatchObject({
			sequence: 0,
			revision: 0,
			project: { cwd: "/workspace" },
			session: { id: "session-1" },
			status: { type: "idle" },
		});

		const events = connection.events()[Symbol.asyncIterator]();
		await expect(submitPrompt(connection, "intent-1", "inspect this project")).resolves.toEqual({
			status: "accepted",
			revision: 1,
		});
		await expect(events.next()).resolves.toMatchObject({
			done: false,
			value: {
				sequence: 1,
				revision: 1,
				event: { type: "session_event", event: { type: "message_end" } },
			},
		});
		await expect(
			connection.execute({
				id: "intent-2",
				ifRevision: 1,
				action: { type: "thinking.set", level: "medium" },
			}),
		).resolves.toEqual({ status: "accepted", revision: 2 });
		await expect(events.next()).resolves.toMatchObject({
			value: {
				sequence: 2,
				revision: 2,
				event: { type: "snapshot_replaced", snapshot: { sequence: 2, revision: 2 } },
			},
		});

		await connection.close();
		expect(session.disposed).toBe(true);
	});

	test("deduplicates intent IDs and rejects stale revisions", async () => {
		const session = new FakeApplicationSession();
		const { connection } = connectExistingAgentSessionApplication(session, "/workspace");
		const intent = {
			id: "intent-1",
			action: { type: "prompt.submit" as const, text: "once", delivery: "now" as const },
		};

		await connection.execute(intent);
		await connection.execute(intent);
		expect(session.prompts).toEqual(["once"]);

		await expect(
			connection.execute({
				id: "intent-2",
				ifRevision: 0,
				action: { type: "thinking.set", level: "medium" },
			}),
		).resolves.toMatchObject({ status: "rejected", error: { code: "stale_revision" } });
	});

	test("accepts long operations before publishing their correlated result", async () => {
		const session = new FakeApplicationSession();
		const { snapshot, connection } = connectExistingAgentSessionApplication(session, "/workspace");
		expect(snapshot.capabilities).toContain("shell");
		const events = connection.events()[Symbol.asyncIterator]();

		await expect(
			connection.execute({
				id: "shell-1",
				action: { type: "shell.run", command: "pwd", excludeFromContext: false },
			}),
		).resolves.toEqual({ status: "accepted", revision: 1 });
		expect(session.shellCommands).toEqual(["pwd"]);
		await expect(events.next()).resolves.toMatchObject({
			value: {
				event: {
					type: "snapshot_replaced",
				},
			},
		});
		await expect(events.next()).resolves.toMatchObject({
			value: {
				causedBy: "shell-1",
				event: {
					type: "snapshot_replaced",
				},
			},
		});
		await expect(events.next()).resolves.toMatchObject({
			value: {
				causedBy: "shell-1",
				event: {
					type: "operation_completed",
					intentId: "shell-1",
					result: { output: "ok", exitCode: 0 },
				},
			},
		});
	});

	test("projects pending host interactions and applies their response", async () => {
		const session = new FakeApplicationSession();
		const { snapshot, connection } = connectExistingAgentSessionApplication(session, "/workspace");
		expect(snapshot.interactions).toEqual([{ id: "dialog-1", kind: "confirm", title: "Approve" }]);
		await expect(
			connection.execute({
				id: "respond-1",
				action: { type: "interaction.respond", interactionId: "dialog-1", response: true },
			}),
		).resolves.toEqual({ status: "accepted", revision: 1 });
		expect(session.interactionResponses).toEqual([true]);
	});

	test("rejects session-changing actions and commands while an operation is active", async () => {
		const session = new FakeApplicationSession();
		session.isStreaming = true;
		const { connection } = connectExistingAgentSessionApplication(session, "/workspace");

		await expect(connection.execute({ id: "new-action", action: { type: "session.new" } })).resolves.toMatchObject({
			status: "rejected",
			error: { code: "busy" },
		});
		await expect(
			connection.execute({ id: "new-command", action: { type: "command.execute", line: "/new" } }),
		).resolves.toMatchObject({ status: "rejected", error: { code: "busy" } });
	});

	test("returns immediate runtime failures as receipts without closing the connection", async () => {
		const session = new FakeApplicationSession();
		session.newSessionError = new Error("session storage unavailable");
		const { connection } = connectExistingAgentSessionApplication(session, "/workspace");

		await expect(connection.execute({ id: "new-fails", action: { type: "session.new" } })).resolves.toMatchObject({
			status: "rejected",
			error: { code: "internal", message: "session storage unavailable" },
		});
		await expect(
			connection.execute({ id: "still-open", action: { type: "thinking.set", level: "low" } }),
		).resolves.toMatchObject({ status: "accepted" });
	});
});
