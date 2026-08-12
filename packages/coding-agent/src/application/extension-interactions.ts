import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { JsonValue } from "@earendil-works/pi-protocol";
import type { ExtensionUIContext, ExtensionUIDialogOptions } from "../core/extensions/types.ts";
import { type Theme, theme } from "../modes/interactive/theme/theme.ts";

interface PendingInteraction {
	id: string;
	kind: "select" | "confirm" | "input" | "editor";
	title: string;
	message?: string;
	placeholder?: string;
	prefill?: string;
	options?: string[];
	optionLabels?: Record<string, string>;
	secret?: boolean;
	timeout?: number;
}

interface PendingResolver {
	interaction: PendingInteraction;
	resolve: (response: JsonValue) => void;
	cancel: () => void;
}

export class ExtensionInteractionHost {
	private readonly changed: () => void;
	private readonly pending = new Map<string, PendingResolver>();
	private readonly statuses = new Map<string, string>();
	private readonly widgets = new Map<string, { lines: string[]; placement: "aboveEditor" | "belowEditor" }>();
	private readonly notifications: Array<{ id: string; message: string; type: "info" | "warning" | "error" }> = [];
	private readonly authEvents: JsonValue[] = [];
	private editorText = "";
	private title: string | undefined;
	private workingMessage: string | undefined;
	private hiddenThinkingLabel: string | undefined;

	constructor(changed: () => void) {
		this.changed = changed;
	}

	get interactions(): readonly unknown[] {
		return [...this.pending.values()].map(({ interaction }) => interaction);
	}

	get presentation(): unknown {
		return {
			statuses: Object.fromEntries(this.statuses),
			widgets: Object.fromEntries(this.widgets),
			notifications: this.notifications,
			authEvents: this.authEvents,
			title: this.title,
			workingMessage: this.workingMessage,
			hiddenThinkingLabel: this.hiddenThinkingLabel,
		};
	}

	respond(interactionId: string, response: JsonValue): void {
		const pending = this.pending.get(interactionId);
		if (!pending) throw new Error(`Interaction ${interactionId} not found`);
		pending.resolve(response);
	}

	createAuthInteraction(): AuthInteraction {
		return {
			prompt: async (prompt) => {
				const selected = await this.request(
					prompt.type === "select"
						? {
								kind: "select",
								title: "Authentication",
								message: prompt.message,
								options: prompt.options.map((option) => option.id),
								optionLabels: Object.fromEntries(
									prompt.options.map((option) => [
										option.id,
										option.description ? `${option.label} — ${option.description}` : option.label,
									]),
								),
							}
						: {
								kind: "input",
								title: "Authentication",
								message: prompt.message,
								placeholder: prompt.placeholder,
								secret: prompt.type === "secret",
							},
					{ signal: prompt.signal },
					(response) => (typeof response === "string" ? response : undefined),
				);
				if (selected === undefined) throw new Error("Login cancelled");
				return selected;
			},
			notify: (event) => {
				this.authEvents.push(JSON.parse(JSON.stringify(event)) as JsonValue);
				if (this.authEvents.length > 20) this.authEvents.shift();
				this.changed();
			},
		};
	}

	cancelAll(): void {
		for (const pending of [...this.pending.values()]) pending.cancel();
	}

	createUIContext(): ExtensionUIContext {
		return {
			select: (title, options, opts) =>
				this.request({ kind: "select", title, options, timeout: opts?.timeout }, opts, (response) =>
					typeof response === "string" && options.includes(response) ? response : undefined,
				),
			confirm: (title, message, opts) =>
				this.request(
					{ kind: "confirm", title, message, timeout: opts?.timeout },
					opts,
					(response) => response === true,
				),
			input: (title, placeholder, opts) =>
				this.request({ kind: "input", title, placeholder, timeout: opts?.timeout }, opts, (response) =>
					typeof response === "string" ? response : undefined,
				),
			notify: (message, type = "info") => {
				this.notifications.push({ id: crypto.randomUUID(), message, type });
				if (this.notifications.length > 50) this.notifications.shift();
				this.changed();
			},
			onTerminalInput: () => () => {},
			setStatus: (key, text) => {
				if (text === undefined) this.statuses.delete(key);
				else this.statuses.set(key, text);
				this.changed();
			},
			setWorkingMessage: (message) => {
				this.workingMessage = message;
				this.changed();
			},
			setWorkingVisible: () => {},
			setWorkingIndicator: () => {},
			setHiddenThinkingLabel: (label) => {
				this.hiddenThinkingLabel = label;
				this.changed();
			},
			setWidget: (key, content, options) => {
				if (content === undefined) this.widgets.delete(key);
				else if (Array.isArray(content)) {
					this.widgets.set(key, { lines: content, placement: options?.placement ?? "aboveEditor" });
				} else {
					this.widgets.set(key, {
						lines: ["Terminal-only custom widget"],
						placement: options?.placement ?? "aboveEditor",
					});
				}
				this.changed();
			},
			setFooter: (factory) => this.setTerminalFallback("footer", factory !== undefined),
			setHeader: (factory) => this.setTerminalFallback("header", factory !== undefined),
			setTitle: (title) => {
				this.title = title;
				this.changed();
			},
			custom: async () => {
				this.setTerminalFallback("custom component", true);
				return undefined as never;
			},
			pasteToEditor: (text) => {
				this.editorText += text;
				this.changed();
			},
			setEditorText: (text) => {
				this.editorText = text;
				this.changed();
			},
			getEditorText: () => this.editorText,
			editor: (title, prefill) =>
				this.request({ kind: "editor", title, prefill }, undefined, (response) =>
					typeof response === "string" ? response : undefined,
				),
			addAutocompleteProvider: () => this.setTerminalFallback("autocomplete", true),
			setEditorComponent: (factory) => this.setTerminalFallback("editor", factory !== undefined),
			getEditorComponent: () => undefined,
			get theme() {
				return theme;
			},
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: (_theme: string | Theme) => ({
				success: false,
				error: "GUI appearance is managed by the desktop host",
			}),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		};
	}

	private setTerminalFallback(kind: string, enabled: boolean): void {
		const key = `terminal-only:${kind}`;
		if (enabled) this.statuses.set(key, `Extension ${kind} is terminal-only; standard GUI fallback is active`);
		else this.statuses.delete(key);
		this.changed();
	}

	private request<T>(
		input: Omit<PendingInteraction, "id">,
		opts: ExtensionUIDialogOptions | undefined,
		parse: (response: JsonValue) => T,
	): Promise<T> {
		const id = crypto.randomUUID();
		return new Promise<T>((resolve) => {
			let timeout: ReturnType<typeof setTimeout> | undefined;
			const cleanup = () => {
				if (timeout) clearTimeout(timeout);
				opts?.signal?.removeEventListener("abort", cancel);
				this.pending.delete(id);
				this.changed();
			};
			const settle = (response: JsonValue) => {
				cleanup();
				resolve(parse(response));
			};
			const cancel = () => settle(null);
			this.pending.set(id, { interaction: { id, ...input }, resolve: settle, cancel });
			if (opts?.signal?.aborted) cancel();
			else opts?.signal?.addEventListener("abort", cancel, { once: true });
			if (opts?.timeout !== undefined) timeout = setTimeout(cancel, opts.timeout);
			this.changed();
		});
	}
}
