#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateGeneratedModelData } from "./model-data.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
	validateGeneratedModelData(packageRoot);
	console.log("Generated model data is valid.");
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	console.error("\nModel data is missing or stale. Restore the versioned snapshot or run `npm run generate:models` intentionally to refresh it.");
	process.exitCode = 1;
}
