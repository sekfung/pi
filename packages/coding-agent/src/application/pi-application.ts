import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
	ApplicationAction,
	ApplicationError,
	ApplicationEvent,
	ApplicationEventEnvelope,
	ApplicationIntent,
	ApplicationSnapshot,
	ImageContent,
	IntentReceipt,
	JsonValue,
} from "@earendil-works/pi-protocol";
import type { AgentSessionEvent } from "../core/agent-session.ts";

export type InternalApplicationSessionEvent = AgentSessionEvent | { type: "application_snapshot_invalidated" };

export interface ApplicationSession {
	readonly cwd?: string;
	readonly isBashRunning: boolean;
	readonly isCompacting: boolean;
	readonly isStreaming: boolean;
	readonly messages: readonly unknown[];
	readonly model:
		| {
				readonly provider: string;
				readonly id: string;
				readonly name: string;
		  }
		| undefined;
	readonly sessionFile: string | undefined;
	readonly sessionId: string;
	readonly sessionName: string | undefined;
	readonly thinkingLevel: ThinkingLevel;
	readonly availableThinkingLevels?: readonly ThinkingLevel[];
	readonly diagnostics?: readonly unknown[];
	readonly models?: readonly unknown[];
	readonly projectTrusted?: boolean;
	readonly resources?: unknown;
	readonly commands?: readonly unknown[];
	readonly settings?: unknown;
	readonly stats?: unknown;
	readonly tools?: readonly unknown[];
	readonly tree?: unknown;
	readonly interactions?: readonly unknown[];
	readonly extensionPresentation?: unknown;
	abort(): Promise<void>;
	clearQueue?(): unknown;
	removeQueueItem?(queue: "steering" | "followUp", index: number): Promise<unknown>;
	compact?(instructions?: string): Promise<unknown>;
	cycleModel?(direction: "forward" | "backward"): Promise<unknown>;
	authenticateProvider?(provider: string, method: "api_key" | "oauth"): Promise<void>;
	logoutProvider?(provider: string): Promise<void>;
	dispose(): void | Promise<void>;
	exportSession?(format: "html" | "jsonl", destination?: string): Promise<string>;
	getFollowUpMessages(): readonly string[];
	getSteeringMessages(): readonly string[];
	prompt(
		text: string,
		options: {
			images?: ImageContent[];
			streamingBehavior?: "steer" | "followUp";
			source: "rpc";
			preflightResult: (success: boolean) => void;
		},
	): Promise<void>;
	queryCatalog?(
		catalog: "models" | "sessions" | "tree" | "tools" | "resources" | "files" | "updates",
		query?: string,
	): Promise<unknown>;
	reloadResources?(): Promise<void>;
	trustProject?(trusted: boolean, remember: boolean): Promise<void>;
	runShell?(command: string, excludeFromContext: boolean): Promise<unknown>;
	selectModel?(provider: string, modelId: string): Promise<void>;
	setActiveTools?(names: string[]): void;
	setSessionName?(name: string): void;
	patchSettings?(scope: "global" | "project", patch: JsonValue): Promise<void>;
	newSession?(): Promise<unknown>;
	resumeSession?(sessionPath: string): Promise<unknown>;
	forkSession?(entryId: string, position: "before" | "at"): Promise<unknown>;
	importSession?(path: string): Promise<unknown>;
	cloneSession?(): Promise<unknown>;
	shareSession?(): Promise<unknown>;
	copyLastMessage?(): unknown;
	navigateTree?(entryId: string, summarize: boolean, instructions?: string): Promise<unknown>;
	labelTree?(entryId: string, label?: string): void;
	respondInteraction?(interactionId: string, response: JsonValue): void;
	setThinkingLevel(level: ThinkingLevel): void;
	subscribe(listener: (event: InternalApplicationSessionEvent) => void): () => void;
}

export interface ApplicationConnection {
	execute(intent: ApplicationIntent): Promise<IntentReceipt>;
	events(signal?: AbortSignal): AsyncIterable<ApplicationEventEnvelope>;
	close(): Promise<void>;
}

export interface ConnectedApplication {
	snapshot: ApplicationSnapshot;
	connection: ApplicationConnection;
}

class EventStream implements AsyncIterable<ApplicationEventEnvelope>, AsyncIterator<ApplicationEventEnvelope> {
	private closed = false;
	private readonly queued: ApplicationEventEnvelope[] = [];
	private readonly waiters: Array<(result: IteratorResult<ApplicationEventEnvelope>) => void> = [];

	[Symbol.asyncIterator](): AsyncIterator<ApplicationEventEnvelope> {
		return this;
	}

	next(): Promise<IteratorResult<ApplicationEventEnvelope>> {
		const event = this.queued.shift();
		if (event) return Promise.resolve({ done: false, value: event });
		if (this.closed) return Promise.resolve({ done: true, value: undefined });
		return new Promise((resolve) => this.waiters.push(resolve));
	}

	return(): Promise<IteratorResult<ApplicationEventEnvelope>> {
		this.finish();
		return Promise.resolve({ done: true, value: undefined });
	}

	push(event: ApplicationEventEnvelope): void {
		if (this.closed) return;
		const waiter = this.waiters.shift();
		if (waiter) {
			waiter({ done: false, value: event });
			return;
		}
		this.queued.push(event);
	}

	finish(): void {
		if (this.closed) return;
		this.closed = true;
		for (const waiter of this.waiters.splice(0)) {
			waiter({ done: true, value: undefined });
		}
	}
}

function toJsonValue(value: unknown): JsonValue {
	const encoded = JSON.stringify(value);
	if (encoded === undefined) return null;
	return JSON.parse(encoded) as JsonValue;
}

function applicationError(code: ApplicationError["code"], message: string, retryable = false): ApplicationError {
	return { code, message, retryable };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class AgentSessionApplication implements ApplicationConnection {
	private closed = false;
	private readonly completedIntents = new Map<string, Promise<IntentReceipt>>();
	private readonly eventStream = new EventStream();
	private mutationTail: Promise<void> = Promise.resolve();
	private revision = 0;
	private sequence = 0;
	private readonly session: ApplicationSession;
	private readonly unsubscribe: () => void;
	private readonly cwd: string;

	constructor(session: ApplicationSession, cwd: string) {
		this.session = session;
		this.cwd = cwd;
		this.unsubscribe = session.subscribe((event) => this.handleSessionEvent(event));
	}

	get snapshot(): ApplicationSnapshot {
		return this.createSnapshot();
	}

	execute(intent: ApplicationIntent): Promise<IntentReceipt> {
		const existing = this.completedIntents.get(intent.id);
		if (existing) return existing;
		if (intent.action.type === "operation.abort") {
			const execution = this.dispatchSafely(intent);
			this.completedIntents.set(intent.id, execution);
			return execution;
		}

		const execution = this.mutationTail.then(() => this.dispatchSafely(intent));
		this.mutationTail = execution.then(
			() => undefined,
			() => undefined,
		);
		this.completedIntents.set(intent.id, execution);
		return execution;
	}

	events(signal?: AbortSignal): AsyncIterable<ApplicationEventEnvelope> {
		if (signal) {
			if (signal.aborted) {
				this.eventStream.finish();
			} else {
				signal.addEventListener("abort", () => this.eventStream.finish(), { once: true });
			}
		}
		return this.eventStream;
	}

	private async dispatchSafely(intent: ApplicationIntent): Promise<IntentReceipt> {
		try {
			return await this.dispatch(intent);
		} catch (error) {
			return this.reject("internal", errorMessage(error));
		}
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		await this.session.abort();
		this.unsubscribe();
		await this.session.dispose();
		this.emit({ type: "application_closed" });
		this.eventStream.finish();
	}

	private createSnapshot(): ApplicationSnapshot {
		const model = this.session.model;
		return {
			sequence: this.sequence,
			revision: this.revision,
			project: { cwd: this.session.cwd ?? this.cwd, trusted: this.session.projectTrusted },
			session: {
				id: this.session.sessionId,
				file: this.session.sessionFile,
				name: this.session.sessionName,
			},
			status: this.closed
				? { type: "closed" }
				: this.session.isCompacting
					? { type: "compacting" }
					: this.session.isBashRunning
						? { type: "running_bash" }
						: this.session.isStreaming
							? { type: "running" }
							: { type: "idle" },
			model: model ? { provider: model.provider, id: model.id, name: model.name } : undefined,
			thinkingLevel: this.session.thinkingLevel,
			messages: this.session.messages.map(toJsonValue),
			queue: {
				steering: [...this.session.getSteeringMessages()],
				followUp: [...this.session.getFollowUpMessages()],
			},
			availableThinkingLevels: this.session.availableThinkingLevels
				? [...this.session.availableThinkingLevels]
				: undefined,
			models: this.session.models?.map(toJsonValue),
			stats: this.session.stats === undefined ? undefined : toJsonValue(this.session.stats),
			tree: this.session.tree === undefined ? undefined : toJsonValue(this.session.tree),
			diagnostics: this.session.diagnostics?.map(toJsonValue),
			settings: this.session.settings === undefined ? undefined : toJsonValue(this.session.settings),
			tools: this.session.tools?.map(toJsonValue),
			resources: this.session.resources === undefined ? undefined : toJsonValue(this.session.resources),
			commands: this.session.commands?.map(toJsonValue),
			interactions: this.session.interactions?.map(toJsonValue),
			extensionPresentation:
				this.session.extensionPresentation === undefined
					? undefined
					: toJsonValue(this.session.extensionPresentation),
			capabilities: [
				"prompt",
				"abort",
				"thinking",
				...(this.session.clearQueue ? (["queue"] as const) : []),
				...(this.session.runShell ? (["shell"] as const) : []),
				...(this.session.selectModel ? (["models"] as const) : []),
				...(this.session.newSession ? (["sessions"] as const) : []),
				...(this.session.navigateTree ? (["tree"] as const) : []),
				...(this.session.compact ? (["compaction"] as const) : []),
				...(this.session.exportSession ? (["export"] as const) : []),
				...(this.session.patchSettings ? (["settings"] as const) : []),
				...(this.session.reloadResources ? (["resources"] as const) : []),
				...(this.session.setActiveTools ? (["tools"] as const) : []),
				...(this.session.trustProject ? (["trust"] as const) : []),
				"commands",
				...(this.session.respondInteraction ? (["interactions"] as const) : []),
			],
		};
	}

	private async dispatch(intent: ApplicationIntent): Promise<IntentReceipt> {
		if (this.closed) {
			return this.reject("closed", "Application connection is closed");
		}
		if (intent.ifRevision !== undefined && intent.ifRevision !== this.revision) {
			return this.reject("stale_revision", "Application state changed before the intent was applied");
		}
		if (this.isBusy() && this.actionRequiresIdle(intent.action)) {
			return this.reject("busy", "Abort the active operation before changing the active session");
		}

		switch (intent.action.type) {
			case "prompt.submit":
				return this.submitPrompt(intent.id, intent.action);
			case "operation.abort":
				await this.session.abort();
				return { status: "accepted", revision: this.revision };
			case "thinking.set":
				this.session.setThinkingLevel(intent.action.level);
				this.revision++;
				this.emit({ type: "snapshot_replaced", snapshot: this.createSnapshot() }, intent.id);
				return { status: "accepted", revision: this.revision };
			case "queue.clear":
				if (!this.session.clearQueue) return this.unsupported(intent.action.type);
				return this.startOperation(intent.id, Promise.resolve(this.session.clearQueue()), true);
			case "queue.remove":
				if (!this.session.removeQueueItem) return this.unsupported(intent.action.type);
				return this.startOperation(
					intent.id,
					this.session.removeQueueItem(intent.action.queue, intent.action.index),
					true,
				);
			case "shell.run":
				if (!this.session.runShell) return this.unsupported(intent.action.type);
				return this.startOperation(
					intent.id,
					this.session.runShell(intent.action.command, intent.action.excludeFromContext),
					true,
				);
			case "model.select":
				if (!this.session.selectModel) return this.unsupported(intent.action.type);
				await this.session.selectModel(intent.action.provider, intent.action.modelId);
				return this.acceptSnapshot(intent.id);
			case "model.cycle":
				if (!this.session.cycleModel) return this.unsupported(intent.action.type);
				await this.session.cycleModel(intent.action.direction);
				return this.acceptSnapshot(intent.id);
			case "model.authenticate":
				if (!this.session.authenticateProvider) return this.unsupported(intent.action.type);
				return this.startOperation(
					intent.id,
					this.session.authenticateProvider(intent.action.provider, intent.action.method),
					true,
				);
			case "model.logout":
				if (!this.session.logoutProvider) return this.unsupported(intent.action.type);
				return this.startOperation(intent.id, this.session.logoutProvider(intent.action.provider), true);
			case "session.new":
				if (!this.session.newSession) return this.unsupported(intent.action.type);
				await this.session.newSession();
				return this.acceptSnapshot(intent.id);
			case "session.resume":
				if (!this.session.resumeSession) return this.unsupported(intent.action.type);
				await this.session.resumeSession(intent.action.sessionPath);
				return this.acceptSnapshot(intent.id);
			case "session.fork":
				if (!this.session.forkSession) return this.unsupported(intent.action.type);
				await this.session.forkSession(intent.action.entryId, intent.action.position);
				return this.acceptSnapshot(intent.id);
			case "session.import":
				if (!this.session.importSession) return this.unsupported(intent.action.type);
				await this.session.importSession(intent.action.path);
				return this.acceptSnapshot(intent.id);
			case "session.rename":
				if (!this.session.setSessionName) return this.unsupported(intent.action.type);
				this.session.setSessionName(intent.action.name);
				return this.acceptSnapshot(intent.id);
			case "session.compact":
				if (!this.session.compact) return this.unsupported(intent.action.type);
				return this.startOperation(intent.id, this.session.compact(intent.action.instructions), true);
			case "session.export":
				if (!this.session.exportSession) return this.unsupported(intent.action.type);
				return this.startOperation(
					intent.id,
					this.session.exportSession(intent.action.format, intent.action.destination),
				);
			case "session.clone":
				if (!this.session.cloneSession) return this.unsupported(intent.action.type);
				return this.startOperation(intent.id, this.session.cloneSession(), true);
			case "session.share":
				if (!this.session.shareSession) return this.unsupported(intent.action.type);
				return this.startOperation(intent.id, this.session.shareSession());
			case "session.copyLast":
				if (!this.session.copyLastMessage) return this.unsupported(intent.action.type);
				return this.startOperation(intent.id, Promise.resolve(this.session.copyLastMessage()));
			case "tree.navigate":
				if (!this.session.navigateTree) return this.unsupported(intent.action.type);
				return this.startOperation(
					intent.id,
					this.session.navigateTree(intent.action.entryId, intent.action.summarize, intent.action.instructions),
					true,
				);
			case "tree.label":
				if (!this.session.labelTree) return this.unsupported(intent.action.type);
				this.session.labelTree(intent.action.entryId, intent.action.label);
				return this.acceptSnapshot(intent.id);
			case "settings.patch":
				if (!this.session.patchSettings) return this.unsupported(intent.action.type);
				await this.session.patchSettings(intent.action.scope, intent.action.patch);
				return this.acceptSnapshot(intent.id);
			case "resources.reload":
				if (!this.session.reloadResources) return this.unsupported(intent.action.type);
				await this.session.reloadResources();
				return this.acceptSnapshot(intent.id);
			case "project.trust":
				if (!this.session.trustProject) return this.unsupported(intent.action.type);
				await this.session.trustProject(intent.action.trusted, intent.action.remember);
				return this.acceptSnapshot(intent.id);
			case "tools.setActive":
				if (!this.session.setActiveTools) return this.unsupported(intent.action.type);
				this.session.setActiveTools(intent.action.names);
				return this.acceptSnapshot(intent.id);
			case "catalog.query":
				if (!this.session.queryCatalog) return this.unsupported(intent.action.type);
				return this.startOperation(
					intent.id,
					this.session.queryCatalog(intent.action.catalog, intent.action.query),
				);
			case "command.execute":
				return this.executeCommand(intent.id, intent.action.line);
			case "interaction.respond":
				if (!this.session.respondInteraction) return this.unsupported(intent.action.type);
				this.session.respondInteraction(intent.action.interactionId, intent.action.response);
				return this.acceptSnapshot(intent.id);
		}
	}

	private executeCommand(intentId: string, line: string): Promise<IntentReceipt> | IntentReceipt {
		const [name = "", ...parts] = line.slice(1).trim().split(/\s+/);
		const argument = parts.join(" ");
		if (this.isBusy() && ["new", "compact", "import", "clone"].includes(name)) {
			return this.reject("busy", "Abort the active operation before changing the active session");
		}
		switch (name) {
			case "new":
				if (!this.session.newSession) return this.unsupported("command /new");
				return this.startOperation(intentId, this.session.newSession(), true);
			case "compact":
				if (!this.session.compact) return this.unsupported("command /compact");
				return this.startOperation(intentId, this.session.compact(argument || undefined), true);
			case "reload":
				if (!this.session.reloadResources) return this.unsupported("command /reload");
				return this.startOperation(intentId, this.session.reloadResources(), true);
			case "name":
				if (!argument) return this.reject("invalid_intent", "/name requires a session name");
				if (!this.session.setSessionName) return this.unsupported("command /name");
				this.session.setSessionName(argument);
				return this.startOperation(intentId, Promise.resolve({ name: argument }), true);
			case "export":
				if (!this.session.exportSession) return this.unsupported("command /export");
				return this.startOperation(
					intentId,
					this.session.exportSession(argument.endsWith(".jsonl") ? "jsonl" : "html", argument || undefined),
				);
			case "import":
				if (!argument) return this.reject("invalid_intent", "/import requires a JSONL path");
				if (!this.session.importSession) return this.unsupported("command /import");
				return this.startOperation(intentId, this.session.importSession(argument), true);
			case "clone":
				if (!this.session.cloneSession) return this.unsupported("command /clone");
				return this.startOperation(intentId, this.session.cloneSession(), true);
			case "share":
				if (!this.session.shareSession) return this.unsupported("command /share");
				return this.startOperation(intentId, this.session.shareSession());
			case "copy":
				if (!this.session.copyLastMessage) return this.unsupported("command /copy");
				return this.startOperation(intentId, Promise.resolve(this.session.copyLastMessage()));
			case "model": {
				if (!argument) return this.startOperation(intentId, Promise.resolve({ presentation: "model" }));
				if (!this.session.selectModel) return this.unsupported("command /model");
				const separator = argument.indexOf("/");
				if (separator <= 0) return this.reject("invalid_intent", "/model requires provider/model");
				return this.startOperation(
					intentId,
					this.session.selectModel(argument.slice(0, separator), argument.slice(separator + 1)),
					true,
				);
			}
			case "logout":
				if (!argument) return this.startOperation(intentId, Promise.resolve({ presentation: "model" }));
				if (!this.session.logoutProvider) return this.unsupported("command /logout");
				return this.startOperation(intentId, this.session.logoutProvider(argument), true);
			case "session":
				return this.startOperation(intentId, Promise.resolve({ presentation: "stats", stats: this.session.stats }));
			case "tree":
			case "resume":
			case "settings":
			case "tools":
			case "resources":
			case "stats":
			case "help":
			case "fork":
			case "scoped-models":
			case "login":
			case "trust":
			case "changelog":
			case "hotkeys":
			case "quit":
				return this.startOperation(intentId, Promise.resolve({ presentation: name }));
			default:
				return this.submitPrompt(intentId, { type: "prompt.submit", text: line, delivery: "now" });
		}
	}

	private isBusy(): boolean {
		return this.session.isStreaming || this.session.isBashRunning || this.session.isCompacting;
	}

	private actionRequiresIdle(action: ApplicationAction): boolean {
		return (
			action.type === "model.select" ||
			action.type === "model.cycle" ||
			action.type === "session.new" ||
			action.type === "session.resume" ||
			action.type === "session.fork" ||
			action.type === "session.import" ||
			action.type === "session.compact" ||
			action.type === "session.clone" ||
			action.type === "tree.navigate"
		);
	}

	private acceptSnapshot(intentId: string): IntentReceipt {
		this.revision++;
		this.emit({ type: "snapshot_replaced", snapshot: this.createSnapshot() }, intentId);
		return { status: "accepted", revision: this.revision };
	}

	private startOperation(intentId: string, operation: Promise<unknown>, replaceSnapshot = false): IntentReceipt {
		if (replaceSnapshot) {
			this.revision++;
			this.emit({ type: "snapshot_replaced", snapshot: this.createSnapshot() }, intentId);
		}
		void operation.then(
			(result) => {
				if (replaceSnapshot) {
					this.revision++;
					this.emit({ type: "snapshot_replaced", snapshot: this.createSnapshot() }, intentId);
				}
				this.emit({ type: "operation_completed", intentId, result: toJsonValue(result) }, intentId);
			},
			(error: unknown) => {
				this.emit(
					{
						type: "operation_failed",
						intentId,
						error: applicationError("internal", errorMessage(error)),
					},
					intentId,
				);
			},
		);
		return { status: "accepted", revision: this.revision };
	}

	private unsupported(action: string): IntentReceipt {
		return this.reject("unsupported", `Application action ${action} is not supported by this runtime`);
	}

	private async submitPrompt(
		intentId: string,
		action: Extract<ApplicationAction, { type: "prompt.submit" }>,
	): Promise<IntentReceipt> {
		const delivery = action.delivery;
		const streamingBehavior = delivery === "now" ? undefined : delivery;
		let accepted = false;
		let settlePreflight: (result: { accepted: true } | { accepted: false; error: unknown }) => void = () => {};
		const preflight = new Promise<{ accepted: true } | { accepted: false; error: unknown }>((resolve) => {
			settlePreflight = resolve;
		});

		const operation = this.session.prompt(action.text, {
			images: action.images,
			streamingBehavior,
			source: "rpc",
			preflightResult: (success) => {
				if (success) settlePreflight({ accepted: true });
			},
		});
		void operation.then(
			() => settlePreflight({ accepted: true }),
			(error: unknown) => {
				settlePreflight({ accepted: false, error });
				if (accepted) {
					this.emit(
						{
							type: "operation_failed",
							intentId,
							error: applicationError("internal", errorMessage(error)),
						},
						intentId,
					);
				}
			},
		);

		const result = await preflight;
		if (!result.accepted) {
			return this.reject("invalid_intent", errorMessage(result.error));
		}
		accepted = true;
		return { status: "accepted", revision: this.revision };
	}

	private reject(code: ApplicationError["code"], message: string): IntentReceipt {
		return {
			status: "rejected",
			error: applicationError(code, message),
			revision: this.revision,
		};
	}

	private handleSessionEvent(event: InternalApplicationSessionEvent): void {
		if (this.closed) return;
		this.revision++;
		if (event.type === "application_snapshot_invalidated") {
			this.emit({ type: "snapshot_replaced", snapshot: this.createSnapshot() });
			return;
		}
		this.emit({ type: "session_event", event: toJsonValue(event) });
	}

	private emit(event: ApplicationEvent, causedBy?: string): void {
		this.sequence++;
		const publishedEvent: ApplicationEvent =
			event.type === "snapshot_replaced"
				? {
						type: "snapshot_replaced",
						snapshot: { ...event.snapshot, sequence: this.sequence, revision: this.revision },
					}
				: event;
		this.eventStream.push({ sequence: this.sequence, revision: this.revision, causedBy, event: publishedEvent });
	}
}

export function connectExistingAgentSessionApplication(session: ApplicationSession, cwd: string): ConnectedApplication {
	const application = new AgentSessionApplication(session, cwd);
	return { snapshot: application.snapshot, connection: application };
}

export function submitPrompt(
	connection: ApplicationConnection,
	intentId: string,
	text: string,
	delivery: "now" | "steer" | "followUp" = "now",
): Promise<IntentReceipt> {
	return connection.execute({ id: intentId, action: { type: "prompt.submit", text, delivery } });
}
