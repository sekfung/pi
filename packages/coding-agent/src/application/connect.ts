import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent, JsonValue } from "@earendil-works/pi-protocol";
import spawn from "cross-spawn";
import { globIterate } from "glob";
import { getAgentDir, getShareViewerUrl, VERSION } from "../config.ts";
import type { AgentSession } from "../core/agent-session.ts";
import {
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../core/agent-session-runtime.ts";
import { resolveModelScopeFromModels } from "../core/model-resolver.ts";
import { resolveProjectTrusted } from "../core/project-trust.ts";
import { SessionManager } from "../core/session-manager.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { BUILTIN_SLASH_COMMANDS } from "../core/slash-commands.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../core/trust-manager.ts";
import { checkForNewPiVersion } from "../utils/version-check.ts";
import { ExtensionInteractionHost } from "./extension-interactions.ts";
import {
	AgentSessionApplication,
	type ApplicationSession,
	type ConnectedApplication,
	type InternalApplicationSessionEvent,
} from "./pi-application.ts";

type CatalogName = "models" | "sessions" | "tree" | "tools" | "resources" | "files" | "updates";

function runProcess(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (data: Buffer) => {
			stdout += data.toString();
		});
		child.stderr?.on("data", (data: Buffer) => {
			stderr += data.toString();
		});
		child.once("error", reject);
		child.once("close", (code) => resolve({ stdout, stderr, code }));
	});
}

function modelSummary(session: AgentSession): unknown[] {
	return session.modelRuntime.getModels().map((model) => ({
		provider: model.provider,
		id: model.id,
		name: model.name,
		reasoning: model.reasoning,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		available: session.modelRuntime.getProviderAuthStatus(model.provider).configured,
		authMethods: session.modelRuntime.getProviderAuthMethods(model.provider),
	}));
}

function resourceSummary(session: AgentSession): unknown {
	const loader = session.resourceLoader;
	const extensions = loader.getExtensions();
	const skills = loader.getSkills();
	const prompts = loader.getPrompts();
	const themes = loader.getThemes();
	return {
		extensions: extensions.extensions.map((extension) => ({ path: extension.path })),
		extensionErrors: extensions.errors,
		skills: skills.skills.map((skill) => ({
			name: skill.name,
			description: skill.description,
			filePath: skill.filePath,
		})),
		skillDiagnostics: skills.diagnostics,
		prompts: prompts.prompts.map((prompt) => ({ name: prompt.name, description: prompt.description })),
		promptDiagnostics: prompts.diagnostics,
		themes: themes.themes.map((theme) => ({ name: theme.name })),
		themeDiagnostics: themes.diagnostics,
		agentsFiles: loader.getAgentsFiles().agentsFiles.map((file) => ({ path: file.path })),
	};
}

class RuntimeApplicationSession implements ApplicationSession {
	private readonly runtime: AgentSessionRuntime;
	private readonly interactionHost: ExtensionInteractionHost;
	private readonly extensionErrors: unknown[] = [];
	private listener: ((event: InternalApplicationSessionEvent) => void) | undefined;
	private unsubscribe: (() => void) | undefined;

	constructor(runtime: AgentSessionRuntime) {
		this.runtime = runtime;
		this.interactionHost = new ExtensionInteractionHost(() =>
			this.listener?.({ type: "application_snapshot_invalidated" }),
		);
		this.runtime.setRebindSession(async () => {
			await this.bindExtensions();
			this.bindListener();
		});
	}

	async initialize(): Promise<void> {
		await this.bindExtensions();
	}

	get current(): AgentSession {
		return this.runtime.session;
	}

	get cwd(): string {
		return this.runtime.cwd;
	}

	get isBashRunning(): boolean {
		return this.current.isBashRunning;
	}

	get isCompacting(): boolean {
		return this.current.isCompacting;
	}

	get isStreaming(): boolean {
		return this.current.isStreaming;
	}

	get messages(): readonly unknown[] {
		return this.current.messages;
	}

	get model(): { readonly provider: string; readonly id: string; readonly name: string } | undefined {
		const model = this.current.model;
		return model ? { provider: model.provider, id: model.id, name: model.name } : undefined;
	}

	get sessionFile(): string | undefined {
		return this.current.sessionFile;
	}

	get sessionId(): string {
		return this.current.sessionId;
	}

	get sessionName(): string | undefined {
		return this.current.sessionName;
	}

	get thinkingLevel(): ThinkingLevel {
		return this.current.thinkingLevel;
	}

	get availableThinkingLevels(): readonly ThinkingLevel[] {
		return this.current.getAvailableThinkingLevels();
	}

	get diagnostics(): readonly unknown[] {
		return [...this.runtime.diagnostics, ...this.extensionErrors];
	}

	get interactions(): readonly unknown[] {
		return this.interactionHost.interactions;
	}

	get extensionPresentation(): unknown {
		return this.interactionHost.presentation;
	}

	get models(): readonly unknown[] {
		return modelSummary(this.current);
	}

	get resources(): unknown {
		return resourceSummary(this.current);
	}

	get commands(): readonly unknown[] {
		const builtins = BUILTIN_SLASH_COMMANDS.map((command) => ({ ...command, source: "builtin" }));
		const extensions = this.current.extensionRunner.getRegisteredCommands().map((command) => ({
			name: command.invocationName,
			description: command.description,
			source: "extension",
		}));
		const prompts = this.current.promptTemplates.map((prompt) => ({
			name: prompt.name,
			description: prompt.description,
			source: "prompt",
		}));
		const skills = this.runtime.services.settingsManager.getEnableSkillCommands()
			? this.current.resourceLoader.getSkills().skills.map((skill) => ({
					name: `skill:${skill.name}`,
					description: skill.description,
					source: "skill",
				}))
			: [];
		return [...builtins, ...extensions, ...prompts, ...skills];
	}

	get projectTrusted(): boolean {
		return this.runtime.services.settingsManager.isProjectTrusted();
	}

	get settings(): unknown {
		const settings = this.runtime.services.settingsManager;
		return {
			paths: {
				global: join(this.runtime.services.agentDir, "settings.json"),
				project: join(this.cwd, ".pi", "settings.json"),
			},
			effective: {
				autoCompact: this.current.autoCompactionEnabled,
				showImages: settings.getShowImages(),
				imageWidthCells: settings.getImageWidthCells(),
				imageAutoResize: settings.getImageAutoResize(),
				blockImages: settings.getBlockImages(),
				enableSkillCommands: settings.getEnableSkillCommands(),
				steeringMode: this.current.steeringMode,
				followUpMode: this.current.followUpMode,
				transport: settings.getTransport(),
				httpIdleTimeoutMs: settings.getHttpIdleTimeoutMs(),
				thinkingLevel: this.current.thinkingLevel,
				theme: settings.getThemeSetting() ?? "dark",
				hideThinkingBlock: settings.getHideThinkingBlock(),
				mermaidRenderingMode: settings.getMermaidRenderingMode(),
				showCacheMissNotices: settings.getShowCacheMissNotices(),
				collapseChangelog: settings.getCollapseChangelog(),
				enableInstallTelemetry: settings.getEnableInstallTelemetry(),
				quietStartup: settings.getQuietStartup(),
				defaultProjectTrust: settings.getDefaultProjectTrust(),
				doubleEscapeAction: settings.getDoubleEscapeAction(),
				treeFilterMode: settings.getTreeFilterMode(),
				showHardwareCursor: settings.getShowHardwareCursor(),
				editorPaddingX: settings.getEditorPaddingX(),
				outputPad: settings.getOutputPad(),
				autocompleteMaxVisible: settings.getAutocompleteMaxVisible(),
				clearOnShrink: settings.getClearOnShrink(),
				showTerminalProgress: settings.getShowTerminalProgress(),
				tuiMode: settings.getTuiMode(),
				fullscreenExitOutput: settings.getFullscreenExitOutput(),
				fullscreenScrollbar: settings.getFullscreenScrollbar(),
				warnings: settings.getWarnings(),
				enabledModels: settings.getEnabledModels(),
			},
			global: settings.getGlobalSettings(),
			project: settings.getProjectSettings(),
			projectTrusted: settings.isProjectTrusted(),
		};
	}

	get stats(): unknown {
		return this.current.getSessionStats();
	}

	get tools(): readonly unknown[] {
		const active = new Set(this.current.getActiveToolNames());
		return this.current.getAllTools().map((tool) => ({
			name: tool.name,
			description: tool.description,
			active: active.has(tool.name),
		}));
	}

	get tree(): unknown {
		return this.current.sessionManager.getTree();
	}

	abort(): Promise<void> {
		this.current.abortBash();
		this.current.abortCompaction();
		this.current.abortBranchSummary();
		return this.current.abort();
	}

	clearQueue(): unknown {
		return this.current.clearQueue();
	}

	async removeQueueItem(queue: "steering" | "followUp", index: number): Promise<unknown> {
		const cleared = this.current.clearQueue();
		const selected = cleared[queue][index];
		if (selected === undefined) throw new Error(`Queue item ${queue}[${index}] not found`);
		for (const [itemIndex, text] of cleared.steering.entries()) {
			if (queue !== "steering" || itemIndex !== index) await this.current.steer(text);
		}
		for (const [itemIndex, text] of cleared.followUp.entries()) {
			if (queue !== "followUp" || itemIndex !== index) await this.current.followUp(text);
		}
		return { text: selected };
	}

	compact(instructions?: string): Promise<unknown> {
		return this.current.compact(instructions);
	}

	cycleModel(direction: "forward" | "backward"): Promise<unknown> {
		return this.current.cycleModel(direction);
	}

	authenticateProvider(provider: string, method: "api_key" | "oauth"): Promise<void> {
		return this.current.modelRuntime
			.login(provider, method, this.interactionHost.createAuthInteraction())
			.then(() => {});
	}

	logoutProvider(provider: string): Promise<void> {
		return this.current.modelRuntime.logout(provider);
	}

	dispose(): Promise<void> {
		this.interactionHost.cancelAll();
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		return this.runtime.dispose();
	}

	async exportSession(format: "html" | "jsonl", destination?: string): Promise<string> {
		return format === "html" ? this.current.exportToHtml(destination) : this.current.exportToJsonl(destination);
	}

	getFollowUpMessages(): readonly string[] {
		return this.current.getFollowUpMessages();
	}

	getSteeringMessages(): readonly string[] {
		return this.current.getSteeringMessages();
	}

	prompt(
		text: string,
		options: {
			images?: ImageContent[];
			streamingBehavior?: "steer" | "followUp";
			source: "rpc";
			preflightResult: (success: boolean) => void;
		},
	): Promise<void> {
		return this.current.prompt(text, options);
	}

	async queryCatalog(catalog: CatalogName, query?: string): Promise<unknown> {
		const normalizedQuery = query?.toLowerCase();
		if (catalog === "updates") {
			const release = await checkForNewPiVersion(VERSION);
			return release ? [release] : [];
		}
		if (catalog === "files") {
			const files: string[] = [];
			for await (const path of globIterate("**/*", {
				cwd: this.cwd,
				dot: true,
				nodir: true,
				ignore: [".git/**", "node_modules/**", ".pi/sessions/**"],
				maxDepth: 16,
			})) {
				if (!normalizedQuery || path.toLowerCase().includes(normalizedQuery)) files.push(path);
				if (files.length >= 100) break;
			}
			return files;
		}
		if (catalog === "models") {
			return modelSummary(this.current).filter(
				(model) => !normalizedQuery || JSON.stringify(model).toLowerCase().includes(normalizedQuery),
			);
		}
		if (catalog === "sessions") {
			const sessions = await SessionManager.list(this.cwd, this.runtime.services.settingsManager.getSessionDir());
			return sessions
				.filter((session) => !normalizedQuery || session.allMessagesText.toLowerCase().includes(normalizedQuery))
				.map((session) => ({
					...session,
					created: session.created.toISOString(),
					modified: session.modified.toISOString(),
				}));
		}
		if (catalog === "tree") return this.tree;
		if (catalog === "tools") return this.tools;
		return this.resources;
	}

	async reloadResources(): Promise<void> {
		await this.current.reload();
	}

	async trustProject(trusted: boolean, remember: boolean): Promise<void> {
		if (remember) new ProjectTrustStore(this.runtime.services.agentDir).set(this.cwd, trusted);
		this.runtime.services.settingsManager.setProjectTrusted(trusted);
		await this.current.reload();
	}

	runShell(command: string, excludeFromContext: boolean): Promise<unknown> {
		return this.current.executeBash(command, undefined, { excludeFromContext });
	}

	async selectModel(provider: string, modelId: string): Promise<void> {
		const model = this.current.modelRuntime.getModel(provider, modelId);
		if (!model) throw new Error(`Model ${provider}/${modelId} not found`);
		await this.current.setModel(model);
	}

	setActiveTools(names: string[]): void {
		this.current.setActiveToolsByName(names);
	}

	setSessionName(name: string): void {
		this.current.setSessionName(name);
	}

	async patchSettings(scope: "global" | "project", patch: JsonValue): Promise<void> {
		if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
			throw new Error("Settings patch must be an object");
		}
		const settings = this.runtime.services.settingsManager;
		for (const [key, value] of Object.entries(patch)) {
			if (scope === "project") {
				if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
					throw new Error(`Project setting ${key} must be a string array`);
				}
				switch (key) {
					case "extensions":
						settings.setProjectExtensionPaths(value);
						continue;
					case "skills":
						settings.setProjectSkillPaths(value);
						continue;
					case "prompts":
						settings.setProjectPromptTemplatePaths(value);
						continue;
					case "themes":
						settings.setProjectThemePaths(value);
						continue;
					default:
						throw new Error(`Unsupported project settings field ${key}`);
				}
			}
			switch (key) {
				case "defaultThinkingLevel":
				case "thinkingLevel":
					if (!this.current.getAvailableThinkingLevels().some((level) => level === value)) {
						throw new Error(`${key} is not supported by the current model`);
					}
					this.current.setThinkingLevel(value as ThinkingLevel);
					break;
				case "steeringMode":
					if (value !== "all" && value !== "one-at-a-time") throw new Error("Invalid steeringMode");
					this.current.setSteeringMode(value);
					break;
				case "followUpMode":
					if (value !== "all" && value !== "one-at-a-time") throw new Error("Invalid followUpMode");
					this.current.setFollowUpMode(value);
					break;
				case "compactionEnabled":
				case "autoCompact":
					if (typeof value !== "boolean") throw new Error("compactionEnabled must be boolean");
					this.current.setAutoCompactionEnabled(value);
					break;
				case "retryEnabled":
					if (typeof value !== "boolean") throw new Error("retryEnabled must be boolean");
					this.current.setAutoRetryEnabled(value);
					break;
				case "showImages":
				case "imageAutoResize":
				case "blockImages":
				case "enableSkillCommands":
				case "hideThinkingBlock":
				case "showCacheMissNotices":
				case "collapseChangelog":
				case "enableInstallTelemetry":
				case "quietStartup":
				case "showHardwareCursor":
				case "clearOnShrink":
				case "showTerminalProgress":
					if (typeof value !== "boolean") throw new Error(`${key} must be boolean`);
					if (key === "showImages") settings.setShowImages(value);
					else if (key === "imageAutoResize") settings.setImageAutoResize(value);
					else if (key === "blockImages") settings.setBlockImages(value);
					else if (key === "enableSkillCommands") settings.setEnableSkillCommands(value);
					else if (key === "hideThinkingBlock") settings.setHideThinkingBlock(value);
					else if (key === "showCacheMissNotices") settings.setShowCacheMissNotices(value);
					else if (key === "collapseChangelog") settings.setCollapseChangelog(value);
					else if (key === "enableInstallTelemetry") settings.setEnableInstallTelemetry(value);
					else if (key === "quietStartup") settings.setQuietStartup(value);
					else if (key === "showHardwareCursor") settings.setShowHardwareCursor(value);
					else if (key === "clearOnShrink") settings.setClearOnShrink(value);
					else settings.setShowTerminalProgress(value);
					break;
				case "imageWidthCells":
				case "httpIdleTimeoutMs":
				case "editorPaddingX":
				case "outputPad":
				case "autocompleteMaxVisible":
					if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
						throw new Error(`${key} must be a non-negative integer`);
					}
					if (key === "imageWidthCells") settings.setImageWidthCells(value);
					else if (key === "httpIdleTimeoutMs") settings.setHttpIdleTimeoutMs(value);
					else if (key === "editorPaddingX") settings.setEditorPaddingX(value);
					else if (key === "outputPad") {
						if (value !== 0 && value !== 1) throw new Error("outputPad must be 0 or 1");
						settings.setOutputPad(value);
					} else settings.setAutocompleteMaxVisible(value);
					break;
				case "transport":
					if (value !== "sse" && value !== "websocket" && value !== "websocket-cached" && value !== "auto") {
						throw new Error("Invalid transport");
					}
					settings.setTransport(value);
					this.current.agent.transport = value;
					break;
				case "theme":
					if (typeof value !== "string" || value.length === 0) throw new Error("theme must be a string");
					settings.setTheme(value);
					break;
				case "mermaidRenderingMode":
					if (value !== "off" && value !== "final" && value !== "streaming")
						throw new Error("Invalid mermaidRenderingMode");
					settings.setMermaidRenderingMode(value);
					break;
				case "defaultProjectTrust":
					if (value !== "ask" && value !== "always" && value !== "never")
						throw new Error("Invalid defaultProjectTrust");
					settings.setDefaultProjectTrust(value);
					break;
				case "doubleEscapeAction":
					if (value !== "fork" && value !== "tree" && value !== "none")
						throw new Error("Invalid doubleEscapeAction");
					settings.setDoubleEscapeAction(value);
					break;
				case "treeFilterMode":
					if (
						value !== "default" &&
						value !== "no-tools" &&
						value !== "user-only" &&
						value !== "labeled-only" &&
						value !== "all"
					)
						throw new Error("Invalid treeFilterMode");
					settings.setTreeFilterMode(value);
					break;
				case "tuiMode":
					if (value !== "regular" && value !== "fullscreen") throw new Error("Invalid tuiMode");
					settings.setTuiMode(value);
					break;
				case "fullscreenExitOutput":
					if (value !== "transcript" && value !== "resume-hint") throw new Error("Invalid fullscreenExitOutput");
					settings.setFullscreenExitOutput(value);
					break;
				case "fullscreenScrollbar":
					if (value !== "hidden" && value !== "auto" && value !== "always")
						throw new Error("Invalid fullscreenScrollbar");
					settings.setFullscreenScrollbar(value);
					break;
				case "warnings": {
					if (typeof value !== "object" || value === null || Array.isArray(value))
						throw new Error("warnings must be an object");
					const anthropicExtraUsage = value.anthropicExtraUsage;
					if (anthropicExtraUsage !== undefined && typeof anthropicExtraUsage !== "boolean") {
						throw new Error("warnings.anthropicExtraUsage must be boolean");
					}
					settings.setWarnings({ anthropicExtraUsage });
					break;
				}
				case "enabledModels":
					if (value !== null && (!Array.isArray(value) || !value.every((item) => typeof item === "string"))) {
						throw new Error("enabledModels must be a string array or null");
					}
					settings.setEnabledModels(value === null ? undefined : value);
					if (value === null || value.length === 0) {
						this.current.setScopedModels([]);
					} else {
						const scoped = resolveModelScopeFromModels(
							value,
							this.current.modelRuntime.getAvailableSnapshot(),
						).scopedModels;
						this.current.setScopedModels(scoped.map(({ model, thinkingLevel }) => ({ model, thinkingLevel })));
					}
					break;
				case "shellPath":
				case "shellCommandPrefix":
					if (value !== null && typeof value !== "string") throw new Error(`${key} must be a string or null`);
					if (key === "shellPath") settings.setShellPath(value ?? undefined);
					else settings.setShellCommandPrefix(value ?? undefined);
					break;
				default:
					throw new Error(`Unsupported settings field ${key}`);
			}
		}
		await settings.flush();
	}

	newSession(): Promise<unknown> {
		return this.runtime.newSession();
	}

	resumeSession(sessionPath: string): Promise<unknown> {
		return this.runtime.switchSession(sessionPath);
	}

	forkSession(entryId: string, position: "before" | "at"): Promise<unknown> {
		return this.runtime.fork(entryId, { position });
	}

	importSession(path: string): Promise<unknown> {
		return this.runtime.importFromJsonl(path);
	}

	cloneSession(): Promise<unknown> {
		const leafId = this.current.sessionManager.getLeafId();
		if (!leafId) throw new Error("Nothing to clone yet");
		return this.runtime.fork(leafId, { position: "at" });
	}

	async shareSession(): Promise<unknown> {
		const auth = await runProcess("gh", ["auth", "status"]);
		if (auth.code !== 0) throw new Error("GitHub CLI is not logged in. Run 'gh auth login' first.");
		const directory = await mkdtemp(join(tmpdir(), "pi-share-"));
		const file = join(directory, "session.html");
		try {
			await this.current.exportToHtml(file);
			const result = await runProcess("gh", ["gist", "create", "--public=false", file]);
			if (result.code !== 0) throw new Error(result.stderr.trim() || "Failed to create secret gist");
			const gistUrl = result.stdout.trim();
			const gistId = gistUrl.split("/").at(-1);
			if (!gistId) throw new Error("GitHub CLI returned an invalid gist URL");
			return { url: getShareViewerUrl(gistId), gistUrl };
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}

	copyLastMessage(): unknown {
		const text = this.current.getLastAssistantText();
		if (!text) throw new Error("No agent messages to copy yet");
		return { text };
	}

	navigateTree(entryId: string, summarize: boolean, instructions?: string): Promise<unknown> {
		return this.current.navigateTree(entryId, { summarize, customInstructions: instructions });
	}

	labelTree(entryId: string, label?: string): void {
		if (!this.current.sessionManager.getEntry(entryId)) throw new Error(`Entry ${entryId} not found`);
		this.current.sessionManager.appendLabelChange(entryId, label);
	}

	respondInteraction(interactionId: string, response: JsonValue): void {
		this.interactionHost.respond(interactionId, response);
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.current.setThinkingLevel(level);
	}

	subscribe(listener: (event: InternalApplicationSessionEvent) => void): () => void {
		this.listener = listener;
		this.bindListener();
		return () => {
			this.unsubscribe?.();
			this.unsubscribe = undefined;
			this.listener = undefined;
		};
	}

	private bindListener(): void {
		this.unsubscribe?.();
		this.unsubscribe = this.listener ? this.current.subscribe(this.listener) : undefined;
	}

	private async bindExtensions(): Promise<void> {
		await this.current.bindExtensions({
			uiContext: this.interactionHost.createUIContext(),
			mode: "rpc",
			abortHandler: () => {
				this.current.clearQueue();
			},
			commandContextActions: {
				waitForIdle: () => this.current.waitForIdle(),
				newSession: (options) => this.runtime.newSession(options),
				fork: async (entryId, options) => {
					const result = await this.runtime.fork(entryId, options);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (entryId, options) => {
					const result = await this.current.navigateTree(entryId, options);
					return { cancelled: result.cancelled };
				},
				switchSession: (sessionPath, options) => this.runtime.switchSession(sessionPath, options),
				reload: async () => {
					await this.current.reload();
				},
			},
			onError: (error) => {
				this.extensionErrors.push(error);
				this.listener?.({ type: "application_snapshot_invalidated" });
			},
		});
	}
}

export async function connectAgentSessionApplication(cwd: string): Promise<ConnectedApplication> {
	const agentDir = getAgentDir();
	const trustStore = new ProjectTrustStore(agentDir);
	const createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
		const bootstrapSettings = SettingsManager.create(options.cwd, options.agentDir, { projectTrusted: false });
		const requiresTrust = hasTrustRequiringProjectResources(options.cwd);
		const savedTrust = trustStore.get(options.cwd);
		const projectTrusted = !requiresTrust || savedTrust === true;
		const settingsManager = SettingsManager.create(options.cwd, options.agentDir, { projectTrusted });
		const projectTrustDiagnostics: Array<{ type: "warning"; message: string }> = [];
		const services = await createAgentSessionServices({
			cwd: options.cwd,
			agentDir: options.agentDir,
			settingsManager,
			modelRuntimeSignal: AbortSignal.timeout(15_000),
			resourceLoaderReloadOptions:
				requiresTrust && savedTrust === null
					? {
							resolveProjectTrust: async ({ extensionsResult }) =>
								resolveProjectTrusted({
									cwd: options.cwd,
									trustStore,
									defaultProjectTrust: bootstrapSettings.getDefaultProjectTrust(),
									extensionsResult,
									projectTrustContext: {
										cwd: options.cwd,
										mode: "rpc",
										hasUI: false,
										ui: {
											select: async () => undefined,
											confirm: async () => false,
											input: async () => undefined,
											notify: () => {},
										},
									},
									onExtensionError: (message) => projectTrustDiagnostics.push({ type: "warning", message }),
								}),
						}
					: undefined,
		});
		const created = await createAgentSessionFromServices({
			services,
			sessionManager: options.sessionManager,
			sessionStartEvent: options.sessionStartEvent,
		});
		return { ...created, services, diagnostics: [...projectTrustDiagnostics, ...services.diagnostics] };
	};
	const sessionManager = SessionManager.create(cwd);
	const runtime = await createAgentSessionRuntime(createRuntime, { cwd, agentDir, sessionManager });
	const applicationSession = new RuntimeApplicationSession(runtime);
	await applicationSession.initialize();
	const application = new AgentSessionApplication(applicationSession, cwd);
	return { snapshot: application.snapshot, connection: application };
}
