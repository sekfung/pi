import { afterEach, describe, expect, test } from "vitest";
import { normalizeGuiArgs, resolveGuiCommand } from "../src/gui-launcher.ts";

const originalExecutable = process.env.PI_GUI_EXECUTABLE;

afterEach(() => {
	if (originalExecutable === undefined) delete process.env.PI_GUI_EXECUTABLE;
	else process.env.PI_GUI_EXECUTABLE = originalExecutable;
});

describe("GUI launcher", () => {
	test("resolves platform desktop commands", () => {
		delete process.env.PI_GUI_EXECUTABLE;
		expect(resolveGuiCommand(["--project", "/workspace"], "linux")).toEqual({
			command: "pi-gui",
			args: ["--project", "/workspace"],
		});
		expect(resolveGuiCommand([], "darwin")).toEqual({ command: "open", args: ["-a", "Pi", "--args"] });
		expect(resolveGuiCommand([], "win32")).toEqual({ command: "pi-gui.exe", args: [] });
	});

	test("honors an explicit executable", () => {
		process.env.PI_GUI_EXECUTABLE = "/opt/pi/Pi";
		expect(resolveGuiCommand([], "linux")).toEqual({ command: "/opt/pi/Pi", args: [] });
	});

	test("defaults to the current project and rejects unsupported flags", () => {
		expect(normalizeGuiArgs([], "/workspace")).toEqual(["--project", "/workspace"]);
		expect(() => normalizeGuiArgs(["--unknown"])).toThrow("Usage: pi gui");
	});
});
