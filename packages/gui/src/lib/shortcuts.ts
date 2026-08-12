export type ShortcutAction = "palette" | "sessions" | "tree" | "settings";
export type ShortcutMap = Record<ShortcutAction, string>;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
	palette: "Mod+K",
	sessions: "Mod+Shift+O",
	tree: "Mod+Shift+T",
	settings: "Mod+,",
};

export function normalizeShortcut(value: string): string | undefined {
	const parts = value
		.split("+")
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length < 2) return undefined;
	const key = parts.at(-1);
	if (!key || key.length !== 1) return undefined;
	const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
	if (![...modifiers].every((part) => part === "mod" || part === "shift" || part === "alt")) return undefined;
	return [
		modifiers.has("mod") ? "Mod" : undefined,
		modifiers.has("shift") ? "Shift" : undefined,
		modifiers.has("alt") ? "Alt" : undefined,
		key.toUpperCase(),
	]
		.filter(Boolean)
		.join("+");
}

export function shortcutConflicts(shortcuts: ShortcutMap): Partial<Record<ShortcutAction, string>> {
	const conflicts: Partial<Record<ShortcutAction, string>> = {};
	const owners = new Map<string, ShortcutAction>();
	for (const [action, shortcut] of Object.entries(shortcuts) as Array<[ShortcutAction, string]>) {
		const normalized = normalizeShortcut(shortcut);
		if (!normalized) {
			conflicts[action] = "Use Mod/Shift/Alt plus one key";
			continue;
		}
		const owner = owners.get(normalized);
		if (owner) {
			conflicts[action] = `Conflicts with ${owner}`;
			conflicts[owner] = `Conflicts with ${action}`;
		} else owners.set(normalized, action);
	}
	return conflicts;
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
	const normalized = normalizeShortcut(shortcut);
	if (!normalized) return false;
	const parts = new Set(normalized.split("+"));
	return (
		(event.metaKey || event.ctrlKey) === parts.has("Mod") &&
		event.shiftKey === parts.has("Shift") &&
		event.altKey === parts.has("Alt") &&
		event.key.toUpperCase() === normalized.split("+").at(-1)
	);
}
