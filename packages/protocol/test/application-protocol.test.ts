import { describe, expect, test } from "vitest";
import {
	APPLICATION_PROTOCOL_VERSION,
	type ApplicationClientMessage,
	ApplicationClientMessageDecoder,
	ApplicationServerMessageDecoder,
	encodeApplicationClientMessage,
	encodeApplicationServerMessage,
	isSupportedApplicationProtocolVersion,
	ProtocolValidationError,
	parseApplicationClientMessage,
	parseApplicationServerMessage,
} from "../src/index.ts";

const snapshot = {
	sequence: 0,
	revision: 0,
	project: { cwd: "/workspace" },
	session: { id: "session-1" },
	status: { type: "idle" as const },
	thinkingLevel: "off" as const,
	messages: [],
	queue: { steering: [], followUp: [] },
	capabilities: ["prompt" as const, "abort" as const, "thinking" as const],
};

describe("application protocol", () => {
	test("validates a typed intent and rejects unknown fields", () => {
		const message: ApplicationClientMessage = {
			type: "execute",
			requestId: "request-1",
			intent: {
				id: "intent-1",
				action: { type: "prompt.submit", text: "inspect", delivery: "now" },
			},
		};

		expect(parseApplicationClientMessage(message)).toEqual(message);
		expect(() => parseApplicationClientMessage({ ...message, token: "secret" })).toThrow(ProtocolValidationError);
	});

	test("validates desktop workflow intents", () => {
		const actions: ApplicationClientMessage[] = [
			{
				type: "execute",
				requestId: "request-shell",
				intent: {
					id: "intent-shell",
					action: { type: "shell.run", command: "git status", excludeFromContext: false },
				},
			},
			{
				type: "execute",
				requestId: "request-auth",
				intent: {
					id: "intent-auth",
					action: { type: "model.authenticate", provider: "openai-codex", method: "oauth" },
				},
			},
			{
				type: "execute",
				requestId: "request-interaction",
				intent: {
					id: "intent-interaction",
					action: { type: "interaction.respond", interactionId: "dialog-1", response: "approve" },
				},
			},
			{
				type: "execute",
				requestId: "request-session",
				intent: {
					id: "intent-session",
					action: { type: "session.resume", sessionPath: "/tmp/session.jsonl" },
				},
			},
			{
				type: "execute",
				requestId: "request-settings",
				intent: {
					id: "intent-settings",
					action: { type: "settings.patch", scope: "global", patch: { retryEnabled: true } },
				},
			},
		];
		for (const message of actions) expect(parseApplicationClientMessage(message)).toEqual(message);
	});

	test("validates an authoritative hello snapshot", () => {
		const message = {
			type: "hello" as const,
			version: APPLICATION_PROTOCOL_VERSION,
			connectionId: "connection-1",
			snapshot,
		};
		expect(parseApplicationServerMessage(message)).toEqual(message);
	});

	test("round trips fragmented client and server frames", () => {
		const client: ApplicationClientMessage = { type: "hello", version: APPLICATION_PROTOCOL_VERSION };
		const clientWire = encodeApplicationClientMessage(client);
		const clientDecoder = new ApplicationClientMessageDecoder();
		expect([...clientDecoder.push(clientWire.subarray(0, 3)), ...clientDecoder.push(clientWire.subarray(3))]).toEqual(
			[client],
		);
		clientDecoder.end();

		const server = {
			type: "hello" as const,
			version: APPLICATION_PROTOCOL_VERSION,
			connectionId: "connection-1",
			snapshot,
		};
		const serverDecoder = new ApplicationServerMessageDecoder();
		expect(serverDecoder.push(encodeApplicationServerMessage(server))).toEqual([server]);
		serverDecoder.end();
	});

	test("negotiates an independent application protocol version", () => {
		expect(isSupportedApplicationProtocolVersion(APPLICATION_PROTOCOL_VERSION)).toBe(true);
		expect(isSupportedApplicationProtocolVersion(APPLICATION_PROTOCOL_VERSION + 1)).toBe(false);
	});
});
