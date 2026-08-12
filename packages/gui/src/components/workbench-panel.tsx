import type { ApplicationSnapshot, JsonValue } from "@earendil-works/pi-protocol";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DesktopApplicationClient } from "@/lib/application-client";
import { createPrivateDiagnosticExport } from "@/lib/diagnostic-export";

export type WorkbenchPanelName = "sessions" | "models" | "tree" | "shell" | "settings" | "resources" | "tools" | "diagnostics";

interface WorkbenchPanelProps {
	client: DesktopApplicationClient;
	onClose: () => void;
	onError: (message: string | undefined) => void;
	onRestoreDraft: (text: string) => void;
	panel: WorkbenchPanelName;
	snapshot: ApplicationSnapshot;
}

type JsonRecord = { [key: string]: JsonValue };

interface SettingDefinition {
	key: string;
	label: string;
	type: "boolean" | "number" | "select";
	options?: readonly string[];
	terminalOnly?: boolean;
}

const SETTINGS: readonly SettingDefinition[] = [
	{ key: "autoCompact", label: "Auto-compact", type: "boolean" },
	{ key: "steeringMode", label: "Steering mode", type: "select", options: ["one-at-a-time", "all"] },
	{ key: "followUpMode", label: "Follow-up mode", type: "select", options: ["one-at-a-time", "all"] },
	{ key: "transport", label: "Transport", type: "select", options: ["auto", "sse", "websocket", "websocket-cached"] },
	{ key: "httpIdleTimeoutMs", label: "HTTP idle timeout (ms)", type: "number" },
	{ key: "thinkingLevel", label: "Thinking level", type: "select", options: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
	{ key: "showImages", label: "Show images", type: "boolean" },
	{ key: "imageWidthCells", label: "Image width", type: "number", terminalOnly: true },
	{ key: "imageAutoResize", label: "Auto-resize images", type: "boolean" },
	{ key: "blockImages", label: "Block images", type: "boolean" },
	{ key: "enableSkillCommands", label: "Enable skill commands", type: "boolean" },
	{ key: "hideThinkingBlock", label: "Hide thinking", type: "boolean" },
	{ key: "mermaidRenderingMode", label: "Mermaid rendering", type: "select", options: ["off", "final", "streaming"] },
	{ key: "showCacheMissNotices", label: "Cache miss notices", type: "boolean" },
	{ key: "collapseChangelog", label: "Collapse changelog", type: "boolean" },
	{ key: "enableInstallTelemetry", label: "Install telemetry", type: "boolean" },
	{ key: "quietStartup", label: "Quiet startup", type: "boolean" },
	{ key: "defaultProjectTrust", label: "Default project trust", type: "select", options: ["ask", "always", "never"] },
	{ key: "doubleEscapeAction", label: "Double Escape", type: "select", options: ["fork", "tree", "none"] },
	{ key: "treeFilterMode", label: "Tree filter", type: "select", options: ["default", "no-tools", "user-only", "labeled-only", "all"] },
	{ key: "showHardwareCursor", label: "Hardware cursor", type: "boolean", terminalOnly: true },
	{ key: "editorPaddingX", label: "Editor padding", type: "number", terminalOnly: true },
	{ key: "outputPad", label: "Output padding", type: "select", options: ["0", "1"], terminalOnly: true },
	{ key: "autocompleteMaxVisible", label: "Autocomplete rows", type: "number" },
	{ key: "clearOnShrink", label: "Clear on shrink", type: "boolean", terminalOnly: true },
	{ key: "showTerminalProgress", label: "Terminal progress", type: "boolean", terminalOnly: true },
	{ key: "tuiMode", label: "TUI mode", type: "select", options: ["regular", "fullscreen"], terminalOnly: true },
	{ key: "fullscreenExitOutput", label: "Fullscreen exit output", type: "select", options: ["transcript", "resume-hint"], terminalOnly: true },
	{ key: "fullscreenScrollbar", label: "Fullscreen scrollbar", type: "select", options: ["hidden", "auto", "always"], terminalOnly: true },
];

function isRecord(value: JsonValue | undefined): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textField(value: JsonValue | undefined, key: string): string | undefined {
	return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

interface FlatTreeNode {
	entryId: string;
	label: string;
	depth: number;
	type: string;
	role?: string;
	hasChildren: boolean;
	copyText: string;
}

function flattenTree(value: JsonValue | undefined, folded: ReadonlySet<string>, depth = 0): FlatTreeNode[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((candidate) => {
		if (!isRecord(candidate) || !isRecord(candidate.entry)) return [];
		const entryId = textField(candidate.entry, "id");
		if (!entryId) return [];
		const type = textField(candidate.entry, "type") ?? "entry";
		const role = isRecord(candidate.entry.message) ? textField(candidate.entry.message, "role") : undefined;
		const label = textField(candidate, "label") ?? type;
		const hasChildren = Array.isArray(candidate.children) && candidate.children.length > 0;
		const copyText = isRecord(candidate.entry.message)
			? (textField(candidate.entry.message, "content") ?? JSON.stringify(candidate.entry.message, null, 2))
			: JSON.stringify(candidate.entry, null, 2);
		return [
			{ entryId, label, depth, type, role, hasChildren, copyText },
			...(folded.has(entryId) ? [] : flattenTree(candidate.children, folded, depth + 1)),
		];
	});
}

export function WorkbenchPanel({ client, onClose, onError, onRestoreDraft, panel, snapshot }: WorkbenchPanelProps) {
	const [catalog, setCatalog] = useState<JsonValue>();
	const [loading, setLoading] = useState(false);
	const [shellCommand, setShellCommand] = useState("");
	const [shellOutput, setShellOutput] = useState<JsonValue>();
	const [treeQuery, setTreeQuery] = useState("");
	const [modelQuery, setModelQuery] = useState("");
	const [treeFilter, setTreeFilter] = useState<"all" | "user" | "labeled">("all");
	const [foldedTreeEntries, setFoldedTreeEntries] = useState<Set<string>>(() => new Set());

	useEffect(() => {
		if (panel !== "sessions") return;
		setLoading(true);
		void client
			.executeAndWait({ type: "catalog.query", catalog: "sessions" })
			.then(setCatalog, (cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause)))
			.finally(() => setLoading(false));
	}, [client, onError, panel]);

	useEffect(() => {
		if (panel !== "shell") return;
		return client.onEvent((envelope) => {
			const event = envelope.event;
			if (event.type !== "session_event" || !isRecord(event.event)) return;
			if (event.event.type !== "bash_execution_update" || typeof event.event.delta !== "string") return;
			const delta = event.event.delta;
			setShellOutput((current) => `${typeof current === "string" ? current : ""}${delta}`);
		});
	}, [client, panel]);

	const tree = useMemo(() => flattenTree(snapshot.tree, foldedTreeEntries), [snapshot.tree, foldedTreeEntries]);
	const filteredTree = tree.filter((node) =>
		node.label.toLowerCase().includes(treeQuery.toLowerCase()) &&
		(treeFilter === "all" || (treeFilter === "user" ? node.role === "user" : node.label !== node.type)),
	);
	const models = snapshot.models ?? [];
	const tools = snapshot.tools ?? [];
	const settingsRoot = isRecord(snapshot.settings) ? snapshot.settings : undefined;
	const effectiveSettings = settingsRoot && isRecord(settingsRoot.effective) ? settingsRoot.effective : undefined;
	const settingsPaths = settingsRoot && isRecord(settingsRoot.paths) ? settingsRoot.paths : undefined;
	const enabledModels = Array.isArray(effectiveSettings?.enabledModels)
		? effectiveSettings.enabledModels.filter((value): value is string => typeof value === "string")
		: undefined;

	const execute = async (action: Parameters<DesktopApplicationClient["execute"]>[0]["action"]) => {
		onError(undefined);
		try {
			let ifRevision: number | undefined = snapshot.revision;
			if (
				snapshot.status.type !== "idle" &&
				(action.type === "session.new" || action.type === "session.resume" || action.type === "session.fork" || action.type === "session.import" || action.type === "tree.navigate")
			) {
				if (!window.confirm("Pi is still working. Abort the active operation and change session?")) return;
				await client.execute({ id: crypto.randomUUID(), action: { type: "operation.abort" } });
				ifRevision = undefined;
			}
			await client.execute({ id: crypto.randomUUID(), ifRevision, action });
		} catch (cause) {
			onError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	return (
		<aside className="flex w-96 shrink-0 flex-col border-l bg-card">
			<div className="flex h-11 items-center justify-between border-b px-4">
				<h2 className="text-sm font-semibold capitalize">{panel}</h2>
				<Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
				{panel === "sessions" && (
					<div className="space-y-2">
						<div className="flex gap-2">
							<Button className="flex-1" onClick={() => void execute({ type: "session.new" })}>New session</Button>
							<Button variant="outline" onClick={() => void client.executeAndWait({ type: "session.clone" }).catch((cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause)))}>Clone</Button>
							<Button variant="outline" onClick={() => {
								void open({ multiple: false, filters: [{ name: "Pi sessions", extensions: ["jsonl"] }] }).then((path) => path ? execute({ type: "session.import", path }) : undefined);
							}}>Import</Button>
							<Button variant="outline" onClick={() => {
								const name = window.prompt("Session name", snapshot.session.name ?? "");
								if (name?.trim()) void execute({ type: "session.rename", name: name.trim() });
							}}>Rename</Button>
						</div>
						{loading && <p className="text-muted-foreground">Loading sessions…</p>}
						{Array.isArray(catalog) && catalog.map((session) => {
							const path = textField(session, "path");
							if (!path) return null;
							return (
								<button key={path} type="button" className="w-full rounded-lg border p-3 text-left hover:bg-muted" onClick={() => void execute({ type: "session.resume", sessionPath: path })}>
									<div className="truncate font-medium">{textField(session, "name") ?? textField(session, "firstMessage") ?? "Untitled session"}</div>
									<div className="mt-1 truncate text-xs text-muted-foreground">{path}</div>
								</button>
							);
						})}
					</div>
				)}

				{panel === "models" && <div className="space-y-2"><input className="w-full rounded-md border bg-background px-3 py-2" value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="Search models" />{models.filter((model) => JSON.stringify(model).toLowerCase().includes(modelQuery.toLowerCase())).map((model) => {
					const provider = textField(model, "provider");
					const id = textField(model, "id");
					if (!provider || !id) return null;
					const selected = snapshot.model?.provider === provider && snapshot.model.id === id;
					const available = isRecord(model) && model.available === true;
					const authMethods = isRecord(model) && Array.isArray(model.authMethods) ? model.authMethods.filter((method): method is "api_key" | "oauth" => method === "api_key" || method === "oauth") : [];
					const modelReference = `${provider}/${id}`;
					const inCycleScope = enabledModels === undefined || enabledModels.includes(modelReference);
					return <div key={`${provider}/${id}`} className="rounded-lg border p-3">
						<button type="button" className="w-full text-left disabled:opacity-50" disabled={selected || !available} onClick={() => void execute({ type: "model.select", provider, modelId: id })}>
							<div className="font-medium">{textField(model, "name") ?? id}</div>
							<div className="text-xs text-muted-foreground">{provider}/{id}{selected ? " · selected" : available ? "" : " · authentication required"}</div>
						</button>
						<div className="mt-2 flex flex-wrap items-center gap-2"><label className="flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" checked={inCycleScope} onChange={() => {
							const allReferences = models.flatMap((candidate) => {
								const candidateProvider = textField(candidate, "provider");
								const candidateId = textField(candidate, "id");
								return candidateProvider && candidateId ? [`${candidateProvider}/${candidateId}`] : [];
							});
							const current = enabledModels ?? allReferences;
							const next = inCycleScope ? current.filter((reference) => reference !== modelReference) : [...current, modelReference];
							void execute({ type: "settings.patch", scope: "global", patch: { enabledModels: next.length === allReferences.length ? null : next } });
						}} />cycle scope</label>{available ? <Button size="sm" variant="ghost" onClick={() => void client.executeAndWait({ type: "model.logout", provider }).catch((cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause)))}>Log out</Button> : authMethods.map((method) => <Button key={method} size="sm" variant="outline" onClick={() => void client.executeAndWait({ type: "model.authenticate", provider, method }).catch((cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause)))}>{method === "oauth" ? "Sign in" : "Add API key"}</Button>)}</div>
					</div>;
				})}</div>}

				{panel === "tree" && <div className="space-y-2">
					<div className="flex gap-2"><input className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2" value={treeQuery} onChange={(event) => setTreeQuery(event.target.value)} placeholder="Filter tree" /><select className="rounded-md border bg-background px-2" value={treeFilter} onChange={(event) => setTreeFilter(event.target.value as "all" | "user" | "labeled")}><option value="all">All</option><option value="user">User</option><option value="labeled">Labeled</option></select></div>
					{filteredTree.map((node) => <div key={node.entryId} className="flex items-center gap-1" style={{ paddingLeft: `${node.depth * 12}px` }}>
						<button type="button" aria-label={foldedTreeEntries.has(node.entryId) ? "Expand branch" : "Fold branch"} disabled={!node.hasChildren} className="w-5 text-muted-foreground disabled:opacity-20" onClick={() => setFoldedTreeEntries((current) => { const next = new Set(current); if (next.has(node.entryId)) next.delete(node.entryId); else next.add(node.entryId); return next; })}>{node.hasChildren ? foldedTreeEntries.has(node.entryId) ? "+" : "−" : "·"}</button>
						<button type="button" className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => void execute({ type: "tree.navigate", entryId: node.entryId, summarize: false })}>{node.label}</button>
						<Button variant="ghost" size="sm" onClick={() => void execute({ type: "session.fork", entryId: node.entryId, position: node.type === "message" && node.role === "user" ? "before" : "at" })}>Fork</Button>
						<Button variant="ghost" size="sm" onClick={() => {
							const label = window.prompt("Branch label", node.label === node.type ? "" : node.label);
							if (label !== null) void execute({ type: "tree.label", entryId: node.entryId, label: label || undefined });
						}}>Label</Button>
						<Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(node.copyText)}>Copy</Button>
					</div>)}
				</div>}

				{panel === "shell" && <div className="space-y-3">
					<textarea className="min-h-28 w-full resize-y rounded-lg border bg-background p-3 font-mono text-sm outline-none" value={shellCommand} onChange={(event) => setShellCommand(event.target.value)} placeholder="Shell command" />
					<div className="flex gap-2">
						<Button disabled={!shellCommand.trim()} onClick={() => {
							setLoading(true);
							void client.executeAndWait({ type: "shell.run", command: shellCommand, excludeFromContext: false }).then(setShellOutput, (cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause))).finally(() => setLoading(false));
						}}>Run</Button>
						<Button variant="outline" disabled={!shellCommand.trim()} onClick={() => void client.executeAndWait({ type: "shell.run", command: shellCommand, excludeFromContext: true }).then(setShellOutput)}>Run without context</Button>
					</div>
					{loading && <p className="text-muted-foreground">Running…</p>}
					{shellOutput !== undefined && <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{JSON.stringify(shellOutput, null, 2)}</pre>}
				</div>}

				{panel === "settings" && <div className="space-y-2">{SETTINGS.map((setting) => {
					const current = effectiveSettings?.[setting.key];
					const update = (value: JsonValue) => void execute({ type: "settings.patch", scope: "global", patch: { [setting.key]: value } });
					return <label key={setting.key} className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2">
						<span><span className="block">{setting.label}</span>{setting.terminalOnly && <span className="text-[11px] text-muted-foreground">Terminal presentation only</span>}</span>
						{setting.type === "boolean" ? <input type="checkbox" checked={current === true} onChange={(event) => update(event.target.checked)} /> : setting.type === "select" ? <select className="max-w-44 rounded-md border bg-background px-2 py-1" value={String(current ?? "")} onChange={(event) => update(setting.key === "outputPad" ? Number(event.target.value) : event.target.value)}>{setting.options?.map((option) => <option key={option}>{option}</option>)}</select> : <input className="w-32 rounded-md border bg-background px-2 py-1" type="number" value={typeof current === "number" ? current : ""} onChange={(event) => update(Number(event.target.value))} />}
					</label>;
				})}
					<label className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2"><span>Anthropic extra usage warning</span><input type="checkbox" checked={isRecord(effectiveSettings?.warnings) ? effectiveSettings.warnings.anthropicExtraUsage !== false : true} onChange={(event) => void execute({ type: "settings.patch", scope: "global", patch: { warnings: { anthropicExtraUsage: event.target.checked } } })} /></label>
					<div className="flex gap-2">{typeof settingsPaths?.global === "string" && <Button variant="outline" onClick={() => void client.openSettingsFile(settingsPaths.global as string)}>Open global config</Button>}{typeof settingsPaths?.project === "string" && <Button variant="outline" onClick={() => void client.openSettingsFile(settingsPaths.project as string)}>Open project config</Button>}</div>
					<details><summary className="cursor-pointer text-xs text-muted-foreground">Raw configuration</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{JSON.stringify(snapshot.settings, null, 2)}</pre></details>
				</div>}

				{panel === "resources" && <div className="space-y-3">
					<Button onClick={() => void execute({ type: "resources.reload" })}>Reload resources</Button>
					<pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{JSON.stringify(snapshot.resources, null, 2)}</pre>
				</div>}

				{panel === "tools" && <div className="space-y-2">{tools.map((tool) => {
					const name = textField(tool, "name");
					if (!name) return null;
					const active = isRecord(tool) && tool.active === true;
					return <label key={name} className="flex items-start gap-3 rounded-lg border p-3">
						<input type="checkbox" checked={active} onChange={() => {
							const activeNames = tools.flatMap((candidate) => {
								const candidateName = textField(candidate, "name");
								const candidateActive = isRecord(candidate) && candidate.active === true;
								return candidateName && (candidateName === name ? !candidateActive : candidateActive) ? [candidateName] : [];
							});
							void execute({ type: "tools.setActive", names: activeNames });
						}} />
						<span><span className="block font-medium">{name}</span><span className="text-xs text-muted-foreground">{textField(tool, "description")}</span></span>
					</label>;
				})}</div>}

				{panel === "diagnostics" && <div className="space-y-3">
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={() => void client.executeAndWait({ type: "session.export", format: "html" })}>Export HTML</Button>
						<Button variant="outline" onClick={() => void client.executeAndWait({ type: "session.export", format: "jsonl" })}>Export JSONL</Button>
						<Button variant="outline" onClick={() => void client.executeAndWait({ type: "session.copyLast" }).then((result) => {
							if (isRecord(result) && typeof result.text === "string") return navigator.clipboard.writeText(result.text);
						}, (cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause)))}>Copy last reply</Button>
						<Button variant="outline" onClick={() => void client.executeAndWait({ type: "session.share" }).then((result) => {
							if (isRecord(result) && typeof result.url === "string") return navigator.clipboard.writeText(result.url);
						}, (cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause)))}>Share secret gist</Button>
						<Button variant="outline" onClick={() => void execute({ type: "queue.clear" }).then(() => onRestoreDraft([...snapshot.queue.steering, ...snapshot.queue.followUp].join("\n")))}>Clear queue</Button>
						<Button variant="outline" onClick={() => void save({ title: "Export Pi diagnostics", defaultPath: "pi-diagnostics.json", filters: [{ name: "JSON", extensions: ["json"] }] }).then((path) => path ? client.writeDiagnosticExport(path, `${JSON.stringify(createPrivateDiagnosticExport(snapshot), null, 2)}\n`) : undefined).catch((cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause)))}>Export private diagnostics</Button>
					</div>
					<pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{JSON.stringify({ stats: snapshot.stats, diagnostics: snapshot.diagnostics }, null, 2)}</pre>
				</div>}
			</div>
		</aside>
	);
}
