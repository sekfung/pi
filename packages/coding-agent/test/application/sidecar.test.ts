import { PassThrough } from "node:stream";
import {
	APPLICATION_PROTOCOL_VERSION,
	type ApplicationServerMessage,
	ApplicationServerMessageDecoder,
	type ApplicationSnapshot,
	encodeApplicationClientMessage,
} from "@earendil-works/pi-protocol";
import { describe, expect, test } from "vitest";
import type { ConnectedApplication } from "../../src/application/pi-application.ts";
import { serveApplicationSidecar } from "../../src/application/sidecar.ts";

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

describe("application sidecar", () => {
	test("handshakes and correlates intent receipts over framed CBOR", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		let releaseEvents: () => void = () => {};
		let executeCount = 0;
		const application: ConnectedApplication = {
			snapshot,
			connection: {
				async execute() {
					executeCount++;
					return { status: "accepted", revision: 0 };
				},
				async *events() {
					await new Promise<void>((resolve) => {
						releaseEvents = resolve;
					});
				},
				async close() {
					releaseEvents();
				},
			},
		};

		const decoder = new ApplicationServerMessageDecoder();
		const messages: ApplicationServerMessage[] = [];
		const waiters: Array<() => void> = [];
		output.on("data", (chunk: Buffer) => {
			messages.push(...decoder.push(new Uint8Array(chunk)));
			for (const resolve of waiters.splice(0)) resolve();
		});
		const nextMessage = async (): Promise<ApplicationServerMessage> => {
			while (messages.length === 0) {
				await new Promise<void>((resolve) => waiters.push(resolve));
			}
			const message = messages.shift();
			if (!message) throw new Error("Sidecar output ended unexpectedly");
			return message;
		};

		const serving = serveApplicationSidecar({ application, input, output });
		input.write(encodeApplicationClientMessage({ type: "hello", version: APPLICATION_PROTOCOL_VERSION }));
		await expect(nextMessage()).resolves.toMatchObject({ type: "hello", snapshot });

		input.write(
			encodeApplicationClientMessage({
				type: "execute",
				requestId: "request-1",
				intent: {
					id: "intent-1",
					action: { type: "prompt.submit", text: "hello", delivery: "now" },
				},
			}),
		);
		await expect(nextMessage()).resolves.toMatchObject({
			type: "receipt",
			requestId: "request-1",
			receipt: { status: "accepted" },
		});
		expect(executeCount).toBe(1);

		input.write(encodeApplicationClientMessage({ type: "close", requestId: "request-2" }));
		await expect(nextMessage()).resolves.toEqual({ type: "closed", requestId: "request-2" });
		input.end();
		await serving;
	});
});
