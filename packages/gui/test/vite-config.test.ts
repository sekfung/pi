import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config.ts";

describe("Vite configuration", () => {
	it("does not watch Cargo build output", () => {
		expect(viteConfig.server?.watch?.ignored).toContain("**/src-tauri/target/**");
	});
});
