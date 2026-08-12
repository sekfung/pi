import {
	APPLICATION_PROTOCOL_VERSION,
	type ApplicationEventEnvelope,
	type ApplicationIntent,
	type ApplicationServerMessage,
	ApplicationServerMessageDecoder,
	type ApplicationSnapshot,
	encodeApplicationClientMessage,
	type JsonValue,
} from "@earendil-works/pi-protocol";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type ServerMessageListener = (message: ApplicationServerMessage) => void;
type ErrorListener = (message: string) => void;

export class DesktopApplicationClient {
	private decoder = new ApplicationServerMessageDecoder();
	private readonly errorListeners = new Set<ErrorListener>();
	private readonly listeners = new Set<ServerMessageListener>();
	private unlisten: UnlistenFn[] = [];
	private sidecarGeneration: number | undefined;
	private eventSequence = 0;

	startupProject(): Promise<string | null> {
		return invoke<string | null>("startup_project");
	}

	openExternalUrl(url: string): Promise<void> {
		return invoke("open_external_url", { url });
	}

	writeDiagnosticExport(path: string, content: string): Promise<void> {
		return invoke("write_diagnostic_export", { path, content });
	}

	openSettingsFile(path: string): Promise<void> {
		return invoke("open_settings_file", { path });
	}

	async openProject(path: string): Promise<ApplicationSnapshot> {
		for (const unlisten of this.unlisten.splice(0)) unlisten();
		this.decoder = new ApplicationServerMessageDecoder();
		this.sidecarGeneration = undefined;
		this.eventSequence = 0;
		this.unlisten.push(
			await listen<number[]>("pi-sidecar-data", (event) => {
				for (const message of this.decoder.push(Uint8Array.from(event.payload))) {
					if (message.type === "event") {
						if (message.envelope.sequence !== this.eventSequence + 1) {
							for (const listener of this.errorListeners)
								listener("Pi sidecar event sequence is inconsistent; restart the project connection");
							continue;
						}
						this.eventSequence = message.envelope.sequence;
					}
					if (message.type === "fatal") {
						for (const listener of this.errorListeners) listener(message.error.message);
					}
					for (const listener of this.listeners) listener(message);
				}
			}),
		);
		this.unlisten.push(
			await listen<{ generation: number; code: number | null }>("pi-sidecar-exit", (event) => {
				if (event.payload.generation !== this.sidecarGeneration) return;
				for (const listener of this.errorListeners) {
					listener(
						event.payload.code === null
							? "Pi sidecar exited"
							: `Pi sidecar exited with code ${event.payload.code}`,
					);
				}
			}),
		);
		const hello = new Promise<ApplicationSnapshot>((resolve, reject) => {
			let listener: ServerMessageListener = () => {};
			const timeout = window.setTimeout(() => {
				this.listeners.delete(listener);
				reject(new Error("Pi sidecar did not complete its handshake"));
			}, 15_000);
			listener = (message) => {
				if (message.type === "hello") {
					this.eventSequence = message.snapshot.sequence;
					window.clearTimeout(timeout);
					this.listeners.delete(listener);
					resolve(message.snapshot);
				} else if (message.type === "hello_error" || message.type === "fatal") {
					window.clearTimeout(timeout);
					this.listeners.delete(listener);
					reject(new Error(message.error.message));
				}
			};
			this.listeners.add(listener);
		});
		this.sidecarGeneration = await invoke<number>("open_project", { path });
		await this.send({ type: "hello", version: APPLICATION_PROTOCOL_VERSION });
		return hello;
	}

	async execute(intent: ApplicationIntent): Promise<void> {
		const requestId = crypto.randomUUID();
		let listener: ServerMessageListener = () => {};
		let errorListener: ErrorListener = () => {};
		let timeout = 0;
		const cleanup = () => {
			window.clearTimeout(timeout);
			this.listeners.delete(listener);
			this.errorListeners.delete(errorListener);
		};
		const receipt = new Promise<void>((resolve, reject) => {
			listener = (message) => {
				if (message.type !== "receipt" || message.requestId !== requestId) return;
				cleanup();
				if (message.receipt.status === "accepted") resolve();
				else reject(new Error(message.receipt.error.message));
			};
			errorListener = (message) => {
				cleanup();
				reject(new Error(message));
			};
			timeout = window.setTimeout(() => {
				cleanup();
				reject(new Error("Pi sidecar did not acknowledge the operation"));
			}, 15_000);
			this.listeners.add(listener);
			this.errorListeners.add(errorListener);
		});
		try {
			await this.send({ type: "execute", requestId, intent });
		} catch (error) {
			cleanup();
			throw error;
		}
		return receipt;
	}

	async executeAndWait(action: ApplicationIntent["action"]): Promise<JsonValue | undefined> {
		const intentId = crypto.randomUUID();
		let operationListener: ServerMessageListener = () => {};
		let operationErrorListener: ErrorListener = () => {};
		const completed = new Promise<JsonValue | undefined>((resolve, reject) => {
			const cleanup = () => {
				this.listeners.delete(operationListener);
				this.errorListeners.delete(operationErrorListener);
			};
			operationListener = (message) => {
				if (message.type !== "event") return;
				const event = message.envelope.event;
				if (
					(event.type !== "operation_completed" && event.type !== "operation_failed") ||
					event.intentId !== intentId
				) {
					return;
				}
				cleanup();
				if (event.type === "operation_completed") resolve(event.result);
				else reject(new Error(event.error.message));
			};
			operationErrorListener = (message) => {
				cleanup();
				reject(new Error(message));
			};
			this.listeners.add(operationListener);
			this.errorListeners.add(operationErrorListener);
		});
		try {
			await this.execute({ id: intentId, action });
		} catch (error) {
			this.listeners.delete(operationListener);
			this.errorListeners.delete(operationErrorListener);
			throw error;
		}
		return completed;
	}

	onEvent(listener: (event: ApplicationEventEnvelope) => void): () => void {
		const messageListener: ServerMessageListener = (message) => {
			if (message.type === "event") listener(message.envelope);
		};
		this.listeners.add(messageListener);
		return () => this.listeners.delete(messageListener);
	}

	onError(listener: ErrorListener): () => void {
		this.errorListeners.add(listener);
		return () => this.errorListeners.delete(listener);
	}

	async close(): Promise<void> {
		this.listeners.clear();
		this.errorListeners.clear();
		for (const unlisten of this.unlisten.splice(0)) unlisten();
		await invoke("close_sidecar");
	}

	private async send(message: Parameters<typeof encodeApplicationClientMessage>[0]): Promise<void> {
		const frame = encodeApplicationClientMessage(message);
		await invoke("write_sidecar", { bytes: Array.from(frame) });
	}
}
