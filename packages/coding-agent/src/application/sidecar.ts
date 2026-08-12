import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import {
	APPLICATION_PROTOCOL_VERSION,
	ApplicationClientMessageDecoder,
	type ApplicationError,
	type ApplicationServerMessage,
	encodeApplicationServerMessage,
	isSupportedApplicationProtocolVersion,
} from "@earendil-works/pi-protocol";
import type { ConnectedApplication } from "./pi-application.ts";

export interface ApplicationSidecarOptions {
	application: ConnectedApplication;
	input: Readable;
	output: Writable;
}

function sidecarError(code: ApplicationError["code"], message: string): ApplicationError {
	return { code, message, retryable: false };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function writeMessage(output: Writable, message: ApplicationServerMessage): Promise<void> {
	const frame = encodeApplicationServerMessage(message);
	if (output.write(frame)) return;
	await new Promise<void>((resolve, reject) => {
		const onDrain = () => {
			cleanup();
			resolve();
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const cleanup = () => {
			output.off("drain", onDrain);
			output.off("error", onError);
		};
		output.once("drain", onDrain);
		output.once("error", onError);
	});
}

export async function serveApplicationSidecar(options: ApplicationSidecarOptions): Promise<void> {
	const { application, input, output } = options;
	const decoder = new ApplicationClientMessageDecoder();
	let helloReceived = false;
	let closing = false;
	let eventPump: Promise<void> | undefined;
	let processing = Promise.resolve();

	const close = async (): Promise<void> => {
		if (closing) return;
		closing = true;
		await application.connection.close();
	};

	const startEventPump = (): void => {
		eventPump = (async () => {
			for await (const envelope of application.connection.events()) {
				await writeMessage(output, { type: "event", envelope });
			}
		})().catch(async (error: unknown) => {
			if (!closing) {
				await writeMessage(output, {
					type: "fatal",
					error: sidecarError("internal", errorMessage(error)),
				});
			}
		});
	};

	const handleMessage = async (message: ReturnType<ApplicationClientMessageDecoder["push"]>[number]) => {
		if (!helloReceived) {
			if (message.type !== "hello") {
				await writeMessage(output, {
					type: "hello_error",
					error: sidecarError("invalid_intent", "The first application message must be hello"),
				});
				await close();
				return;
			}
			if (!isSupportedApplicationProtocolVersion(message.version)) {
				await writeMessage(output, {
					type: "hello_error",
					error: sidecarError("unsupported", `Unsupported application protocol version ${message.version}`),
				});
				await close();
				return;
			}
			helloReceived = true;
			await writeMessage(output, {
				type: "hello",
				version: APPLICATION_PROTOCOL_VERSION,
				connectionId: randomUUID(),
				snapshot: application.snapshot,
			});
			startEventPump();
			return;
		}

		if (message.type === "hello") {
			await writeMessage(output, {
				type: "fatal",
				error: sidecarError("invalid_intent", "Application hello may only be sent once"),
			});
			await close();
			return;
		}
		if (message.type === "execute") {
			const receipt = await application.connection.execute(message.intent);
			await writeMessage(output, { type: "receipt", requestId: message.requestId, receipt });
			return;
		}

		await close();
		await writeMessage(output, { type: "closed", requestId: message.requestId });
	};

	await new Promise<void>((resolve, reject) => {
		input.on("data", (chunk: Buffer | Uint8Array) => {
			processing = processing
				.then(async () => {
					for (const message of decoder.push(new Uint8Array(chunk))) {
						await handleMessage(message);
					}
				})
				.catch(reject);
		});
		input.once("end", () => {
			processing
				.then(async () => {
					decoder.end();
					await close();
					await eventPump;
				})
				.then(resolve, reject);
		});
		input.once("error", reject);
		output.once("error", reject);
	});
}
