import type { ShortcutAction, ShortcutMap } from "@/lib/shortcuts";
import { shortcutConflicts } from "@/lib/shortcuts";
import { Button } from "@/components/ui/button";

const LABELS: Record<ShortcutAction, string> = {
	palette: "Command palette",
	sessions: "Sessions",
	tree: "Session tree",
	settings: "Settings",
};

export function ShortcutSettings({ shortcuts, onChange, onClose }: { shortcuts: ShortcutMap; onChange: (value: ShortcutMap) => void; onClose: () => void }) {
	const conflicts = shortcutConflicts(shortcuts);
	return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={onClose}>
		<div className="w-full max-w-md rounded-xl border bg-card p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onMouseDown={(event) => event.stopPropagation()}>
			<div className="flex items-center justify-between"><h2 className="font-semibold">Keyboard shortcuts</h2><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>
			<p className="mt-2 text-xs text-muted-foreground">Use Mod for Command on macOS and Ctrl elsewhere. Conflicting or invalid shortcuts are disabled.</p>
			<div className="mt-4 space-y-3">{(Object.keys(LABELS) as ShortcutAction[]).map((action) => <label key={action} className="block"><span className="mb-1 flex justify-between text-sm"><span>{LABELS[action]}</span>{conflicts[action] && <span className="text-destructive">{conflicts[action]}</span>}</span><input className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" value={shortcuts[action]} onChange={(event) => onChange({ ...shortcuts, [action]: event.target.value })} /></label>)}</div>
		</div>
	</div>;
}
