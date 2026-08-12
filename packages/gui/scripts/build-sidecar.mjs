import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const manifestDirectory = resolve(import.meta.dirname, "..");
const rustVersion = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
const hostLine = rustVersion
	.split("\n")
	.find((line) => line.startsWith("host: "));
if (!hostLine) {
	throw new Error("Unable to determine the Rust host target");
}

const target = hostLine.slice("host: ".length).trim();
const extension = target.includes("windows") ? ".exe" : "";
const output = resolve(manifestDirectory, "src-tauri", "binaries", `pi-app-server-${target}${extension}`);
const codingAgentDirectory = resolve(manifestDirectory, "..", "coding-agent");
const codingAgentDist = resolve(codingAgentDirectory, "dist");
const entry = resolve(codingAgentDist, "app-server-entry.js");
const resources = resolve(manifestDirectory, "src-tauri", "resources");
mkdirSync(dirname(output), { recursive: true });
mkdirSync(resources, { recursive: true });
for (const name of ["export-html", "theme", "assets", "package.json", "photon_rs_bg.wasm"]) {
	rmSync(resolve(resources, name), { recursive: true, force: true });
}
cpSync(resolve(codingAgentDist, "core", "export-html"), resolve(resources, "export-html"), { recursive: true });
cpSync(resolve(codingAgentDist, "modes", "interactive", "theme"), resolve(resources, "theme"), { recursive: true });
cpSync(resolve(codingAgentDist, "modes", "interactive", "assets"), resolve(resources, "assets"), { recursive: true });
copyFileSync(resolve(codingAgentDirectory, "package.json"), resolve(resources, "package.json"));
copyFileSync(
	resolve(manifestDirectory, "..", "..", "node_modules", "@silvia-odwyer", "photon-node", "photon_rs_bg.wasm"),
	resolve(resources, "photon_rs_bg.wasm"),
);
execFileSync(
	"bun",
	[
		"build",
		"--no-compile-autoload-bunfig",
		entry,
		"--compile",
		"--outfile",
		output,
	],
	{ stdio: "inherit" },
);
