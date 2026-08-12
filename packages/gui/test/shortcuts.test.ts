import { describe, expect, test } from "vitest";
import { DEFAULT_SHORTCUTS, normalizeShortcut, shortcutConflicts } from "../src/lib/shortcuts.ts";

describe("desktop shortcuts", () => {
	test("normalizes supported chords", () => {
		expect(normalizeShortcut("shift + mod + k")).toBe("Mod+Shift+K");
		expect(normalizeShortcut("K")).toBeUndefined();
	});

	test("rejects conflicts before shortcuts are applied", () => {
		expect(shortcutConflicts({ ...DEFAULT_SHORTCUTS, tree: DEFAULT_SHORTCUTS.sessions })).toMatchObject({
			sessions: expect.stringContaining("tree"),
			tree: expect.stringContaining("sessions"),
		});
	});
});
