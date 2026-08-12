import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
	Activity,
	Command,
	Database,
	FolderOpen,
	GitBranch,
	LoaderCircle,
	Moon,
	Plus,
	Send,
	Settings,
	Square,
	Sun,
	Terminal,
	Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApplicationSnapshot, ImageContent, JsonValue } from "@earendil-works/pi-protocol";
import { Button } from "@/components/ui/button";
import { ExtensionPresentation, HostInteraction } from "@/components/host-interaction";
import { ShortcutSettings } from "@/components/shortcut-settings";
import { Textarea } from "@/components/ui/textarea";
import { VirtualTranscript } from "@/components/virtual-transcript";
import { WorkbenchPanel, type WorkbenchPanelName } from "@/components/workbench-panel";
import { DesktopApplicationClient } from "@/lib/application-client";
import { applySessionEvent, sessionEventNotice } from "@/lib/application-state";
import { DEFAULT_SHORTCUTS, matchesShortcut, shortcutConflicts, type ShortcutMap } from "@/lib/shortcuts";

const RECENT_PROJECTS_KEY = "pi.gui.recent-projects";
const SHORTCUTS_KEY = "pi.gui.shortcuts";
const APPEARANCE_KEY = "pi.gui.appearance";
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const FALLBACK_COMMANDS = ["settings", "model", "scoped-models", "export", "import", "share", "copy", "name", "session", "changelog", "hotkeys", "fork", "clone", "tree", "trust", "login", "logout", "new", "compact", "resume", "reload", "quit"] as const;

function loadRecentProjects(): string[] {
	try {
		const parsed = JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) ?? "[]") as unknown;
		return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
	} catch {
		return [];
	}
}

function loadShortcuts(): ShortcutMap {
	try {
		const parsed = JSON.parse(localStorage.getItem(SHORTCUTS_KEY) ?? "null") as Partial<ShortcutMap> | null;
		return parsed ? { ...DEFAULT_SHORTCUTS, ...parsed } : DEFAULT_SHORTCUTS;
	} catch {
		return DEFAULT_SHORTCUTS;
	}
}

async function readImage(file: File): Promise<ImageContent> {
	if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image`);
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unable to read image"));
		reader.onerror = () => reject(reader.error ?? new Error("Unable to read image"));
		reader.readAsDataURL(file);
	});
	const separator = dataUrl.indexOf(",");
	if (separator === -1) throw new Error("Invalid image data");
	return { type: "image", mimeType: file.type, data: dataUrl.slice(separator + 1) };
}

function interactionId(value: JsonValue | undefined): string | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.id === "string"
		? value.id
		: undefined;
}

function commandName(value: JsonValue): string | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.name === "string"
		? value.name
		: undefined;
}

export default function App() {
	const client = useMemo(() => new DesktopApplicationClient(), []);
	const [snapshot, setSnapshot] = useState<ApplicationSnapshot>();
	const snapshotRef = useRef<ApplicationSnapshot | undefined>(undefined);
	const [recentProjects, setRecentProjects] = useState(loadRecentProjects);
	const [draft, setDraft] = useState("");
	const [delivery, setDelivery] = useState<"steer" | "followUp">("followUp");
	const [attachments, setAttachments] = useState<Array<ImageContent & { name: string }>>([]);
	const [fileCompletions, setFileCompletions] = useState<string[]>([]);
	const [draftHistory, setDraftHistory] = useState<string[]>([]);
	const [historyIndex, setHistoryIndex] = useState(-1);
	const [error, setError] = useState<string>();
	const [notice, setNotice] = useState<string>();
	const [activityNotice, setActivityNotice] = useState<string>();
	const [opening, setOpening] = useState(false);
	const [panel, setPanel] = useState<WorkbenchPanelName>();
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [closeRequested, setCloseRequested] = useState(false);
	const [pendingProject, setPendingProject] = useState<string>();
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const [shortcuts, setShortcuts] = useState(loadShortcuts);
	const [allowClose, setAllowClose] = useState(false);
	const [appearance, setAppearance] = useState<"system" | "light" | "dark">(() => {
		const saved = localStorage.getItem(APPEARANCE_KEY);
		return saved === "light" || saved === "dark" ? saved : "system";
	});
	const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
	const dark = appearance === "dark" || (appearance === "system" && systemDark);
	const commands = useMemo(
		() => [...new Set([...(snapshot?.commands?.flatMap((value) => commandName(value) ?? []) ?? []), ...FALLBACK_COMMANDS])].map((name) => `/${name}`),
		[snapshot?.commands],
	);
	const contextUsage = useMemo(() => {
		const stats = snapshot?.stats;
		if (typeof stats !== "object" || stats === null || Array.isArray(stats)) return undefined;
		const value = stats.contextUsage;
		if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
		return {
			tokens: typeof value.tokens === "number" ? value.tokens : null,
			contextWindow: typeof value.contextWindow === "number" ? value.contextWindow : 0,
			percent: typeof value.percent === "number" ? value.percent : null,
		};
	}, [snapshot?.stats]);

	useEffect(() => {
		document.documentElement.classList.toggle("dark", dark);
	}, [dark]);

	useEffect(() => {
		const query = window.matchMedia("(prefers-color-scheme: dark)");
		const changed = () => setSystemDark(query.matches);
		query.addEventListener("change", changed);
		return () => query.removeEventListener("change", changed);
	}, []);

	const cycleAppearance = () => {
		const next = appearance === "system" ? "light" : appearance === "light" ? "dark" : "system";
		setAppearance(next);
		localStorage.setItem(APPEARANCE_KEY, next);
	};

	useEffect(() => {
		snapshotRef.current = snapshot;
	}, [snapshot]);

	useEffect(() => {
		const stopEvents = client.onEvent((envelope) => {
			const event = envelope.event;
			if (event.type === "snapshot_replaced") {
				setSnapshot({ ...event.snapshot, sequence: envelope.sequence, revision: envelope.revision });
			} else if (event.type === "session_event") {
				setActivityNotice(sessionEventNotice(event.event));
				setSnapshot((current) => {
					if (!current) return current;
					return {
						...applySessionEvent(current, event.event),
						sequence: envelope.sequence,
						revision: envelope.revision,
					};
				});
			} else if (event.type === "operation_failed") {
				setError(event.error.message);
			}
		});
		const stopErrors = client.onError(setError);
		return () => {
			stopEvents();
			stopErrors();
		};
	}, [client]);

	useEffect(() => () => void client.close(), [client]);

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		void getCurrentWindow().onCloseRequested((event) => {
			if (allowClose || !snapshot || snapshot.status.type === "idle" || snapshot.status.type === "closed") return;
			event.preventDefault();
			setCloseRequested(true);
		}).then((value) => {
			unlisten = value;
		});
		return () => unlisten?.();
	}, [allowClose, snapshot]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (Object.keys(shortcutConflicts(shortcuts)).length > 0) return;
			if (matchesShortcut(event, shortcuts.palette)) {
				event.preventDefault();
				setPaletteOpen((current) => !current);
			} else if (matchesShortcut(event, shortcuts.sessions)) {
				event.preventDefault();
				setPanel("sessions");
			} else if (matchesShortcut(event, shortcuts.tree)) {
				event.preventDefault();
				setPanel("tree");
			} else if (matchesShortcut(event, shortcuts.settings)) {
				event.preventDefault();
				setPanel("settings");
			} else if (event.key === "Escape") {
				setPaletteOpen(false);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [shortcuts]);

	const updateShortcuts = (value: ShortcutMap) => {
		setShortcuts(value);
		localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(value));
	};

	useEffect(() => {
		const match = /(?:^|\s)(@|\.\/)([^\s]*)$/.exec(draft);
		if (!snapshot || !match) {
			setFileCompletions([]);
			return;
		}
		let active = true;
		const timeout = window.setTimeout(() => {
			void client.executeAndWait({ type: "catalog.query", catalog: "files", query: match[2] }).then(
				(result) => {
					if (active) setFileCompletions(Array.isArray(result) ? result.filter((path): path is string => typeof path === "string").slice(0, 8) : []);
				},
				() => {
					if (active) setFileCompletions([]);
				},
			);
		}, 150);
		return () => {
			active = false;
			window.clearTimeout(timeout);
		};
	}, [client, draft, snapshot]);

	const connect = useCallback(async (path: string, force = false) => {
		const current = snapshotRef.current;
		if (!force && current && current.project.cwd !== path && current.status.type !== "idle" && current.status.type !== "closed") {
			setPendingProject(path);
			return;
		}
		setOpening(true);
		setError(undefined);
		setNotice(undefined);
		try {
			const initial = await client.openProject(path);
			setSnapshot(initial);
			void client.executeAndWait({ type: "catalog.query", catalog: "updates" }).then((updates) => {
				if (Array.isArray(updates) && updates.length > 0) {
					const release = updates[0];
					const version = typeof release === "object" && release !== null && !Array.isArray(release) && typeof release.version === "string" ? release.version : "new";
					setNotice(`Pi ${version} is available. Use Check for updates in the command palette.`);
				}
			}, () => {});
			setRecentProjects((current) => {
				const next = [path, ...current.filter((candidate) => candidate !== path)].slice(0, 12);
				localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
				return next;
			});
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setOpening(false);
		}
	}, [client]);

	useEffect(() => {
		void client.startupProject().then((configured) => {
			const target = configured ?? loadRecentProjects()[0];
			if (target) void connect(target);
		});
	}, [client, connect]);

	const chooseProject = async () => {
		const selected = await open({ directory: true, multiple: false, title: "Open Pi project" });
		if (selected) await connect(selected);
	};

	const submit = async () => {
		const text = draft.trim();
		if ((!text && attachments.length === 0) || !snapshot) return;
		if (text) setDraftHistory((current) => [text, ...current.filter((entry) => entry !== text)].slice(0, 100));
		setHistoryIndex(-1);
		setDraft("");
		setError(undefined);
		try {
			if (text.startsWith("!!") || (text.startsWith("!") && !text.startsWith("!="))) {
				await client.executeAndWait({
					type: "shell.run",
					command: text.startsWith("!!") ? text.slice(2).trim() : text.slice(1).trim(),
					excludeFromContext: text.startsWith("!!"),
				});
				return;
			}
			if (text.startsWith("/")) {
				const command = text.split(/\s+/, 1)[0];
				if (commands.includes(command)) {
					const result = await client.executeAndWait({ type: "command.execute", line: text });
					if (typeof result === "object" && result !== null && !Array.isArray(result)) {
						const presentation = result.presentation;
						if (presentation === "help" || presentation === "hotkeys") setPaletteOpen(true);
						else if (presentation === "stats") setPanel("diagnostics");
						else if (presentation === "resume") setPanel("sessions");
						else if (presentation === "model" || presentation === "login" || presentation === "scoped-models") setPanel("models");
						else if (presentation === "fork") setPanel("tree");
						else if (presentation === "trust") setPanel("resources");
						else if (presentation === "changelog") void client.openExternalUrl("https://pi.dev/changelog");
						else if (presentation === "quit") void getCurrentWindow().close();
						else if (presentation === "tree" || presentation === "settings" || presentation === "tools" || presentation === "resources") setPanel(presentation);
						else if (typeof result.text === "string") {
							await navigator.clipboard.writeText(result.text);
							setNotice("Copied the last assistant message");
						} else if (typeof result.url === "string") {
							await navigator.clipboard.writeText(result.url);
							setNotice(`Share URL copied: ${result.url}`);
						}
					} else if (typeof result === "string") {
						setNotice(result);
					}
					return;
				}
			}
			await client.execute({
				id: crypto.randomUUID(),
					action: {
					type: "prompt.submit",
					text,
						delivery: snapshot.status.type === "running" ? delivery : "now",
						images: attachments.map(({ name: _name, ...image }) => image),
					},
				});
			setAttachments([]);
		} catch (cause) {
			setDraft(text);
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const attachFiles = async (files: FileList | File[]) => {
		try {
			const images = await Promise.all(Array.from(files).map(async (file) => ({ ...(await readImage(file)), name: file.name })));
			setAttachments((current) => [...current, ...images]);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const applyFileCompletion = (path: string) => {
		setDraft((current) => current.replace(/(@|\.\/)([^\s]*)$/, (token) => `${token.startsWith("@") ? "@" : "./"}${path} `));
		setFileCompletions([]);
	};

	const cycleThinkingLevel = async () => {
		if (!snapshot) return;
		const currentIndex = THINKING_LEVELS.indexOf(snapshot.thinkingLevel);
		const level = THINKING_LEVELS[(currentIndex + 1) % THINKING_LEVELS.length];
		await client.execute({
			id: crypto.randomUUID(),
			ifRevision: snapshot.revision,
			action: { type: "thinking.set", level },
		});
	};

	const respondToInteraction = (id: string, response: JsonValue) => {
		void client.execute({
			id: crypto.randomUUID(),
			action: { type: "interaction.respond", interactionId: id, response },
		}).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
	};

	return (
		<div className="flex h-screen overflow-hidden bg-background text-foreground">
			<aside className="flex w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
				<div className="flex h-11 items-center gap-2 px-4 text-sm font-semibold">
					<div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">π</div>
					Pi
				</div>
				<div className="px-3 py-2">
					<Button className="w-full justify-start" variant="outline" size="sm" onClick={chooseProject}>
						<Plus className="size-4" /> Open project
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
					<p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Projects</p>
					{recentProjects.map((project) => (
						<button
							key={project}
							type="button"
							className="w-full truncate rounded-lg px-2 py-2 text-left text-sm hover:bg-sidebar-accent"
							onClick={() => connect(project)}
						>
							{project.split(/[\\/]/).at(-1) || project}
						</button>
					))}
				</div>
				<div className="flex items-center justify-between border-t p-2">
					<span className="px-2 text-xs text-muted-foreground">Experimental</span>
					<Button variant="ghost" size="icon" aria-label={`Appearance: ${appearance}`} title={`Appearance: ${appearance}`} onClick={cycleAppearance}>
						{dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
					</Button>
				</div>
			</aside>

			<main className="flex min-w-0 flex-1 flex-col">
				<header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b px-4">
					<div className="min-w-0 truncate text-sm">
						{snapshot ? snapshot.project.cwd : "Select a project"}
					</div>
					<div className="flex items-center gap-1">
						{snapshot && <>
							<Button variant="ghost" size="icon" aria-label="Sessions" onClick={() => setPanel("sessions")}><Database className="size-4" /></Button>
							<Button variant="ghost" size="icon" aria-label="Session tree" onClick={() => setPanel("tree")}><GitBranch className="size-4" /></Button>
							<Button variant="ghost" size="icon" aria-label="Shell" onClick={() => setPanel("shell")}><Terminal className="size-4" /></Button>
							<Button variant="ghost" size="icon" aria-label="Tools" onClick={() => setPanel("tools")}><Wrench className="size-4" /></Button>
							<Button variant="ghost" size="icon" aria-label="Settings" onClick={() => setPanel("settings")}><Settings className="size-4" /></Button>
							<Button variant="ghost" size="icon" aria-label="Diagnostics" onClick={() => setPanel("diagnostics")}><Activity className="size-4" /></Button>
							<Button variant="ghost" size="icon" aria-label="Command palette" onClick={() => setPaletteOpen(true)}><Command className="size-4" /></Button>
						</>}
						{snapshot?.model && <button type="button" className="ml-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setPanel("models")}>{snapshot.model.name}</button>}
						{contextUsage && <button type="button" className="ml-1 text-xs text-muted-foreground hover:text-foreground" title={`${contextUsage.tokens ?? "Unknown"} of ${contextUsage.contextWindow} context tokens`} onClick={() => setPanel("diagnostics")}>{contextUsage.percent === null ? "context ?" : `${Math.round(contextUsage.percent)}% context`}</button>}
					</div>
				</header>
				{snapshot?.project.trusted === false && (
					<div className="flex items-center justify-between gap-4 border-b bg-muted px-4 py-2 text-sm">
						<span>Project resources are disabled until this folder is trusted.</span>
						<div className="flex shrink-0 gap-2">
							<Button variant="outline" size="sm" onClick={() => void client.execute({ id: crypto.randomUUID(), action: { type: "project.trust", trusted: true, remember: false } })}>Trust once</Button>
							<Button size="sm" onClick={() => void client.execute({ id: crypto.randomUUID(), action: { type: "project.trust", trusted: true, remember: true } })}>Trust and remember</Button>
						</div>
					</div>
				)}
				<ExtensionPresentation value={snapshot?.extensionPresentation} onOpenUrl={(url) => void client.openExternalUrl(url).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))} />

				{snapshot ? (
					<>
						<VirtualTranscript messages={snapshot.messages} />
						<div className="shrink-0 border-t px-6 py-4">
							<div className="mx-auto max-w-3xl">
								{error && <div className="mb-2 flex items-center justify-between gap-3 text-sm text-destructive"><span>{error}</span>{/sidecar|disconnected|exited/i.test(error) && <Button size="sm" variant="outline" onClick={() => void connect(snapshot.project.cwd, true)}>Restart</Button>}</div>}
								{notice && <div className="mb-2 text-sm text-muted-foreground">{notice}</div>}
								{activityNotice && <div className="mb-2 text-xs text-muted-foreground">{activityNotice}</div>}
								{(snapshot.queue.steering.length > 0 || snapshot.queue.followUp.length > 0) && (
									<div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
										{snapshot.queue.steering.map((text, index) => <button key={`steering-${index}`} type="button" className="max-w-56 truncate rounded-full border px-3 py-1 hover:bg-muted" title="Remove and restore to editor" onClick={() => void client.executeAndWait({ type: "queue.remove", queue: "steering", index }).then(() => setDraft(text))}>Steering: {text}</button>)}
										{snapshot.queue.followUp.map((text, index) => <button key={`follow-up-${index}`} type="button" className="max-w-56 truncate rounded-full border px-3 py-1 hover:bg-muted" title="Remove and restore to editor" onClick={() => void client.executeAndWait({ type: "queue.remove", queue: "followUp", index }).then(() => setDraft(text))}>Follow-up: {text}</button>)}
										<Button variant="ghost" size="sm" onClick={() => void client.executeAndWait({ type: "queue.clear" }).then(() => setDraft([...snapshot.queue.steering, ...snapshot.queue.followUp].join("\n")))}>Return all</Button>
									</div>
								)}
								<div className="rounded-3xl border bg-card shadow-sm focus-within:ring-1 focus-within:ring-ring" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void attachFiles(event.dataTransfer.files); }}>
									{attachments.length > 0 && <div className="flex flex-wrap gap-2 px-3 pt-3">{attachments.map((attachment, index) => <button key={`${attachment.name}-${index}`} type="button" className="rounded-full border px-2 py-1 text-xs" title="Remove attachment" onClick={() => setAttachments((current) => current.filter((_, candidate) => candidate !== index))}>{attachment.name}</button>)}</div>}
					<Textarea
										value={draft}
										placeholder="Ask Pi to work on this project"
										onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
								event.preventDefault();
								const nextIndex = event.key === "ArrowUp" ? Math.min(historyIndex + 1, draftHistory.length - 1) : Math.max(historyIndex - 1, -1);
								setHistoryIndex(nextIndex);
								setDraft(nextIndex === -1 ? "" : draftHistory[nextIndex] ?? "");
								return;
							}
							if (event.key === "Enter" && !event.shiftKey) {
												event.preventDefault();
												void submit();
							}
						}}
						onPaste={(event) => {
							const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
							if (images.length > 0) {
								event.preventDefault();
								void attachFiles(images);
							}
						}}
					/>
					{draft.startsWith("/") && (
						<div className="border-t px-2 py-1">
							{commands.filter((command) => command.startsWith(draft.split(/\s+/, 1)[0])).slice(0, 8).map((command) => <button key={command} type="button" className="block w-full rounded-md px-2 py-1 text-left text-xs hover:bg-muted" onClick={() => setDraft(`${command} `)}>{command}</button>)}
						</div>
					)}
					{fileCompletions.length > 0 && (
						<div className="border-t px-2 py-1" aria-label="File completions">
							{fileCompletions.map((path) => <button key={path} type="button" className="block w-full truncate rounded-md px-2 py-1 text-left font-mono text-xs hover:bg-muted" onClick={() => applyFileCompletion(path)}>{path}</button>)}
						</div>
					)}
									<div className="flex items-center justify-between px-3 pb-3">
										<div className="flex items-center gap-1">
											<label className="cursor-pointer rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><input type="file" accept="image/*" multiple className="hidden" onChange={(event) => { if (event.target.files) void attachFiles(event.target.files); event.target.value = ""; }} />Attach</label>
											<Button variant="ghost" size="sm" onClick={() => void cycleThinkingLevel()}>{snapshot.thinkingLevel} thinking</Button>
											{snapshot.status.type === "running" && <Button variant="ghost" size="sm" onClick={() => setDelivery((current) => current === "steer" ? "followUp" : "steer")}>{delivery === "steer" ? "Steer current turn" : "Send as follow-up"}</Button>}
										</div>
										{snapshot.status.type === "running" ? (
											<Button size="icon" aria-label="Stop" onClick={() => client.execute({ id: crypto.randomUUID(), action: { type: "operation.abort" } })}>
												<Square className="size-3.5 fill-current" />
											</Button>
										) : (
										<Button size="icon" aria-label="Send" disabled={!draft.trim() && attachments.length === 0} onClick={submit}>
												<Send className="size-4" />
											</Button>
										)}
									</div>
								</div>
							</div>
						</div>
					</>
				) : (
					<div className="flex flex-1 items-center justify-center p-8">
						<div className="max-w-sm text-center">
							<div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl border bg-card">
								{opening ? <LoaderCircle className="size-5 animate-spin" /> : <FolderOpen className="size-5" />}
							</div>
							<h1 className="text-lg font-semibold">Open a project</h1>
							<p className="mt-2 text-sm text-muted-foreground">Pi uses this directory for tools, sessions, settings, and project resources.</p>
							<Button className="mt-5" onClick={chooseProject} disabled={opening}>
								<FolderOpen className="size-4" /> Choose folder
							</Button>
							{error && <p className="mt-3 text-sm text-destructive">{error}</p>}
						</div>
					</div>
				)}
			</main>
			{snapshot && panel && <WorkbenchPanel client={client} panel={panel} snapshot={snapshot} onClose={() => setPanel(undefined)} onError={setError} onRestoreDraft={setDraft} />}
			{paletteOpen && snapshot && (
				<div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh]" role="presentation" onMouseDown={() => setPaletteOpen(false)}>
					<div className="w-full max-w-lg overflow-hidden rounded-xl border bg-card shadow-2xl" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
						<div className="border-b px-4 py-3 text-sm text-muted-foreground">Commands</div>
						<div className="max-h-[60vh] overflow-y-auto p-2">
							{([
								["sessions", "Open sessions"],
								["models", "Select model"],
								["tree", "Navigate session tree"],
								["shell", "Run shell command"],
								["tools", "Configure tools"],
								["resources", "Inspect resources"],
								["settings", "Open settings"],
								["diagnostics", "Open diagnostics"],
							] as const).map(([name, label]) => <button key={name} type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setPanel(name); setPaletteOpen(false); }}>{label}</button>)}
							<div className="my-1 border-t" />
							{(snapshot.commands ?? []).slice(0, 100).map((value, index) => {
								if (typeof value !== "object" || value === null || Array.isArray(value) || typeof value.name !== "string") return null;
								return <button key={`${value.name}-${index}`} type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setDraft(`/${value.name} `); setPaletteOpen(false); }}><span>/{value.name}</span>{typeof value.description === "string" && <span className="ml-2 text-xs text-muted-foreground">{value.description}</span>}</button>;
							})}
							<button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { void client.execute({ id: crypto.randomUUID(), action: { type: "session.compact" } }); setPaletteOpen(false); }}>Compact context</button>
							<button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setShortcutsOpen(true); setPaletteOpen(false); }}>Customize keyboard shortcuts</button>
							<button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => {
								setPaletteOpen(false);
								void client.executeAndWait({ type: "catalog.query", catalog: "updates" }).then((updates) => {
									if (!Array.isArray(updates) || updates.length === 0) setNotice("Pi packages are up to date");
									else {
										setNotice(`${updates.length} update${updates.length === 1 ? "" : "s"} available`);
										void client.openExternalUrl("https://pi.dev/changelog");
									}
								}, (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
							}}>Check for updates</button>
						</div>
					</div>
				</div>
			)}
			{shortcutsOpen && <ShortcutSettings shortcuts={shortcuts} onChange={updateShortcuts} onClose={() => setShortcutsOpen(false)} />}
			{snapshot?.interactions?.[0] && interactionId(snapshot.interactions[0]) && (
				<HostInteraction interaction={snapshot.interactions[0]} respond={(response) => respondToInteraction(interactionId(snapshot.interactions?.[0]) ?? "", response)} />
			)}
			{closeRequested && (
				<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="presentation">
					<div className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="Active operation">
						<h2 className="font-semibold">Pi is still working</h2>
						<p className="mt-2 text-sm text-muted-foreground">Stay in the app, or abort the active operation and close the window.</p>
						<div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setCloseRequested(false)}>Stay</Button><Button variant="destructive" onClick={() => void client.execute({ id: crypto.randomUUID(), action: { type: "operation.abort" } }).then(async () => { setAllowClose(true); await getCurrentWindow().close(); }, (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))}>Abort and close</Button></div>
					</div>
				</div>
			)}
			{pendingProject && (
				<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="presentation">
					<div className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="Switch project">
						<h2 className="font-semibold">Pi is still working</h2>
						<p className="mt-2 text-sm text-muted-foreground">Switching projects replaces the Active Runtime. Abort the current operation first.</p>
						<div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setPendingProject(undefined)}>Stay</Button><Button variant="destructive" onClick={() => { const path = pendingProject; void client.execute({ id: crypto.randomUUID(), action: { type: "operation.abort" } }).then(() => { setPendingProject(undefined); return connect(path, true); }, (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))); }}>Abort and switch</Button></div>
					</div>
				</div>
			)}
		</div>
	);
}
