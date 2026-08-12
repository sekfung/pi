import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MarkdownContent, TranscriptMessage } from "../src/components/transcript-message.tsx";

describe("TranscriptMessage", () => {
	test("escapes model HTML and only links explicit HTTP URLs", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent text={'<script>alert("x")</script> [safe](https://example.com) [bad](javascript:alert(1))'} />,
		);
		expect(html).toContain("&lt;script&gt;");
		expect(html).toContain("safe</button>");
		expect(html).not.toContain('href="javascript:');
	});

	test("renders thinking and tool data as collapsed inspectable content", () => {
		const html = renderToStaticMarkup(
			<TranscriptMessage
				index={0}
				message={{
					role: "assistant",
					timestamp: 1,
					content: [
						{ type: "thinking", thinking: "checking" },
						{ type: "toolCall", id: "1", name: "read", arguments: { path: "README.md" } },
					],
				}}
			/>,
		);
		expect(html).toContain("<details");
		expect(html).toContain("Thinking");
		expect(html).toContain("README.md");
	});

	test("renders Mermaid as safe Unicode art", () => {
		const html = renderToStaticMarkup(<MarkdownContent text={'```mermaid\ngraph TD\n  A --> B\n```'} />);
		expect(html).toContain('aria-label="Mermaid diagram"');
		expect(html).toContain("Diagram source");
	});

	test("falls back to source for oversized Mermaid input", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent text={`\`\`\`mermaid\n${"A".repeat(100_001)}\n\`\`\``} />,
		);
		expect(html).not.toContain('aria-label="Mermaid diagram"');
		expect(html).toContain("mermaid");
	});
});
