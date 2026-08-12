import type { JsonValue } from "@earendil-works/pi-protocol";
import { invoke } from "@tauri-apps/api/core";
import { render as renderMermaid } from "grok-mermaid";
import { Bot, ChevronRight, CircleAlert, GitBranch, Terminal, Wrench } from "lucide-react";
import type { ReactNode } from "react";

type JsonRecord = { [key: string]: JsonValue };

function isRecord(value: JsonValue | undefined): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: JsonValue | undefined): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function inlineMarkdown(text: string): ReactNode[] {
	const nodes: ReactNode[] = [];
	const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
	let offset = 0;
	for (const match of text.matchAll(pattern)) {
		const index = match.index;
		if (index > offset) nodes.push(text.slice(offset, index));
		const token = match[0];
		if (token.startsWith("`")) {
			nodes.push(<code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{token.slice(1, -1)}</code>);
		} else if (token.startsWith("**")) {
			nodes.push(<strong key={index}>{token.slice(2, -2)}</strong>);
		} else {
			const separator = token.indexOf("](");
			const label = token.slice(1, separator);
			const href = token.slice(separator + 2, -1);
			nodes.push(<button key={index} type="button" title={href} className="underline underline-offset-2" onClick={() => {
				if (window.confirm(`Open this external link?\n\n${href}`)) void invoke("open_external_url", { url: href });
			}}>{label}</button>);
		}
		offset = index + token.length;
	}
	if (offset < text.length) nodes.push(text.slice(offset));
	return nodes;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
	const diff = language === "diff";
	const highlightedLine = (line: string): ReactNode => {
		if (diff) return line;
		const tokens = line.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\/.*|#.*|\b(?:const|let|var|function|class|interface|type|import|export|from|return|if|else|for|while|async|await|true|false|null|undefined)\b)/g);
		return tokens.map((token, index) => {
			if (/^(?:"|')/.test(token)) return <span key={index} className="text-amber-200">{token}</span>;
			if (/^(?:\/\/|#)/.test(token)) return <span key={index} className="text-white/45">{token}</span>;
			if (/^(?:const|let|var|function|class|interface|type|import|export|from|return|if|else|for|while|async|await|true|false|null|undefined)$/.test(token)) return <span key={index} className="text-violet-300">{token}</span>;
			return token;
		});
	};
	return (
		<div className="my-3 overflow-hidden rounded-lg border bg-[oklch(0.16_0_0)] text-[oklch(0.93_0_0)]">
			<div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-[11px] text-white/55">
				<span>{language || "text"}</span>
				<button type="button" className="hover:text-white" onClick={() => void navigator.clipboard.writeText(code)}>Copy</button>
			</div>
			<pre className="overflow-x-auto p-3 font-mono text-xs leading-5">{code.split("\n").map((line, index) => (
				<span key={`${index}-${line}`} className={`block min-w-max ${diff && line.startsWith("+") ? "bg-emerald-500/15 text-emerald-200" : diff && line.startsWith("-") ? "bg-red-500/15 text-red-200" : ""}`}>{line ? highlightedLine(line) : " "}</span>
			))}</pre>
		</div>
	);
}

function MermaidDiagram({ source }: { source: string }) {
	let art: ReturnType<typeof renderMermaid>;
	try {
		art = source.length <= 100_000 ? renderMermaid(source) : null;
	} catch {
		art = null;
	}
	if (!art) return <CodeBlock code={source} language="mermaid" />;
	return <figure className="my-3 overflow-x-auto rounded-lg border bg-muted/30 p-3" aria-label="Mermaid diagram">
		<pre className="min-w-max font-mono text-xs leading-5">{art.styled.map((line, index) => <div key={index}>{line.map((span, spanIndex) => <span key={spanIndex} className={span.cls === "edge" ? "text-primary" : span.cls === "edgeLabel" ? "text-muted-foreground" : span.cls === "title" ? "font-semibold" : ""}>{span.text}</span>)}</div>)}</pre>
		{art.warnings.length > 0 && <figcaption className="mt-2 text-xs text-destructive">Partial diagram: {art.warnings[0]}</figcaption>}
	</figure>;
}

export function MarkdownContent({ text }: { text: string }) {
	const blocks = text.split(/(```[^\n]*\n[\s\S]*?```)/g);
	return <div className="space-y-2">{blocks.map((block, index) => {
		if (block.startsWith("```")) {
			const firstBreak = block.indexOf("\n");
			const language = block.slice(3, firstBreak).trim().toLowerCase();
			const code = block.slice(firstBreak + 1, -3).replace(/\n$/, "");
			if (language === "mermaid") {
				return <div key={index}><MermaidDiagram source={code} /><details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Diagram source</summary><CodeBlock code={code} language="mermaid" /></details></div>;
			}
			return <CodeBlock key={index} code={code} language={language} />;
		}
		return block.split("\n").map((line, lineIndex) => {
			if (!line) return <div key={`${index}-${lineIndex}`} className="h-2" />;
			const heading = /^(#{1,4})\s+(.*)$/.exec(line);
			if (heading) return <div key={`${index}-${lineIndex}`} className="mt-4 font-semibold">{inlineMarkdown(heading[2])}</div>;
			const list = /^\s*[-*]\s+(.*)$/.exec(line);
			if (list) return <div key={`${index}-${lineIndex}`} className="flex gap-2"><span aria-hidden>•</span><span>{inlineMarkdown(list[1])}</span></div>;
			return <div key={`${index}-${lineIndex}`}>{inlineMarkdown(line)}</div>;
		});
	})}</div>;
}

function ContentParts({ content }: { content: JsonValue | undefined }) {
	if (typeof content === "string") return <MarkdownContent text={content} />;
	if (!Array.isArray(content)) return null;
	return content.map((part, index) => {
		if (!isRecord(part)) return null;
		if (part.type === "text" && typeof part.text === "string") return <MarkdownContent key={index} text={part.text} />;
		if (part.type === "thinking" && typeof part.thinking === "string") {
			return <details key={index} className="my-2 rounded-lg border bg-muted/30 px-3 py-2 text-muted-foreground"><summary className="cursor-pointer text-xs font-medium">Thinking</summary><div className="mt-2"><MarkdownContent text={part.thinking} /></div></details>;
		}
		if (part.type === "toolCall") {
			return <details key={index} className="my-2 rounded-lg border px-3 py-2"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium"><ChevronRight className="size-3" /><Wrench className="size-3" />{asText(part.name) ?? "Tool call"}</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{JSON.stringify(part.arguments, null, 2)}</pre></details>;
		}
		if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string" && /^image\/(png|jpeg|gif|webp)$/.test(part.mimeType)) {
			return <img key={index} className="my-2 max-h-96 max-w-full rounded-lg border object-contain" src={`data:${part.mimeType};base64,${part.data}`} alt="Message attachment" />;
		}
		return <details key={index} className="my-2 text-xs text-muted-foreground"><summary>Unsupported content</summary><pre className="mt-1 overflow-x-auto">{JSON.stringify(part, null, 2)}</pre></details>;
	});
}

export function TranscriptMessage({ message, index }: { message: JsonValue; index: number }) {
	if (!isRecord(message)) return null;
	const role = asText(message.role) ?? "custom";
	if (role === "user") {
		return <div className="flex justify-end"><div className="max-w-[80%] rounded-2xl bg-muted px-4 py-3 text-sm"><ContentParts content={message.content} /></div></div>;
	}
	if (role === "assistant") {
		return <div className="flex gap-3"><div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg border bg-card"><Bot className="size-4" /></div><div className="min-w-0 flex-1 text-sm leading-7"><ContentParts content={message.content} />{typeof message.errorMessage === "string" && <div className="mt-2 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" />{message.errorMessage}</div>}</div></div>;
	}
	if (role === "toolResult") {
		return <details className="ml-10 rounded-lg border bg-card px-3 py-2"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium"><ChevronRight className="size-3" /><Wrench className="size-3" />{asText(message.toolName) ?? "Tool result"}{message.isError === true && <span className="text-destructive">failed</span>}</summary><div className="mt-2 text-sm"><ContentParts content={message.content} /></div></details>;
	}
	if (role === "bashExecution") {
		return <details className="rounded-lg border bg-card px-3 py-2"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium"><Terminal className="size-3" />{asText(message.command) ?? "Shell"}</summary><CodeBlock code={asText(message.output) ?? ""} language="console" /></details>;
	}
	if (role === "branchSummary" || role === "compactionSummary") {
		return <details className="rounded-lg border bg-muted/30 px-3 py-2"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium"><GitBranch className="size-3" />{role === "branchSummary" ? "Branch summary" : "Compaction summary"}</summary><div className="mt-2 text-sm"><MarkdownContent text={asText(message.summary) ?? ""} /></div></details>;
	}
	if (role === "custom" && message.display === false) return null;
	return <details className="rounded-lg border px-3 py-2"><summary className="cursor-pointer text-xs font-medium">{asText(message.customType) ?? `Message ${index + 1}`}</summary><div className="mt-2 text-sm"><ContentParts content={message.content} /></div></details>;
}
