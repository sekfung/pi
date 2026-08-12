import { describe, expect, test } from "vitest";
import { createPrivateDiagnosticExport } from "../src/lib/diagnostic-export.ts";

describe("createPrivateDiagnosticExport", () => {
	test("omits prompts, files, credentials, and full paths", () => {
		const result = createPrivateDiagnosticExport({
			sequence: 1,
			revision: 1,
			project: { cwd: "/secret/repo" },
			session: { id: "id", file: "/secret/session.jsonl" },
			status: { type: "idle" },
			thinkingLevel: "off",
			messages: [{ role: "user", content: "private prompt" }],
			queue: { steering: ["private queue"], followUp: [] },
			diagnostics: [{ path: "/secret/file", apiKey: "secret", error: "safe" }],
			capabilities: ["prompt"],
		});
		const encoded = JSON.stringify(result);
		expect(encoded).not.toContain("/secret");
		expect(encoded).not.toContain("private prompt");
		expect(encoded).not.toContain("private queue");
		expect(encoded).not.toContain('"secret"');
		expect(encoded).toContain("safe");
	});
});
