import crossSpawn from "cross-spawn";

interface GuiCommand {
	command: string;
	args: string[];
}

export function resolveGuiCommand(args: string[], platform = process.platform): GuiCommand {
	const configuredExecutable = process.env.PI_GUI_EXECUTABLE;
	if (configuredExecutable) return { command: configuredExecutable, args };
	if (platform === "darwin") return { command: "open", args: ["-a", "Pi", "--args", ...args] };
	if (platform === "win32") return { command: "pi-gui.exe", args };
	return { command: "pi-gui", args };
}

export function normalizeGuiArgs(args: string[], cwd = process.cwd()): string[] {
	if (args.length === 0) return ["--project", cwd];
	if (args[0] === "--project" && args.length === 2 && args[1].trim()) return args;
	if (args.length === 1 && args[0].startsWith("--project=") && args[0].slice("--project=".length).trim()) return args;
	throw new Error("Usage: pi gui [--project <path>]");
}

export async function launchGui(args: string[]): Promise<void> {
	const resolved = resolveGuiCommand(normalizeGuiArgs(args));
	const child = crossSpawn(resolved.command, resolved.args, {
		detached: true,
		stdio: "ignore",
	});
	await new Promise<void>((resolve, reject) => {
		child.once("spawn", resolve);
		child.once("error", reject);
	}).catch((error: unknown) => {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Unable to launch Pi desktop (${detail}). Install the Pi desktop application or set PI_GUI_EXECUTABLE.`,
		);
	});
	child.unref();
}
