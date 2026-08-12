import { describe, expect, test, vi } from "vitest";
import { ExtensionInteractionHost } from "../../src/application/extension-interactions.ts";

describe("ExtensionInteractionHost", () => {
	test("publishes and resolves presentation-neutral extension dialogs", async () => {
		const changed = vi.fn();
		const host = new ExtensionInteractionHost(changed);
		const selection = host.createUIContext().select("Choose", ["one", "two"]);
		const interaction = host.interactions[0] as { id: string; kind: string; options: string[] };
		expect(interaction).toMatchObject({ kind: "select", options: ["one", "two"] });
		host.respond(interaction.id, "two");
		await expect(selection).resolves.toBe("two");
		expect(host.interactions).toEqual([]);
		expect(changed).toHaveBeenCalledTimes(2);
	});

	test("exposes standard widget fallback and terminal-only status", () => {
		const host = new ExtensionInteractionHost(() => {});
		const ui = host.createUIContext();
		ui.setWidget("build", ["Running checks"], { placement: "aboveEditor" });
		ui.setHeader(() => {
			throw new Error("terminal factory must not execute in the GUI host");
		});
		expect(host.presentation).toMatchObject({
			statuses: { "terminal-only:header": expect.stringContaining("terminal-only") },
			widgets: { build: { lines: ["Running checks"], placement: "aboveEditor" } },
		});
	});
});
