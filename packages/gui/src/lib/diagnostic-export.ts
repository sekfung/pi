import type { ApplicationSnapshot, JsonValue } from "@earendil-works/pi-protocol";

const SENSITIVE_KEY = /(?:token|secret|password|api.?key|credential|content|prompt|message|cwd|path|file)/i;

function redact(value: JsonValue, depth = 0): JsonValue {
	if (depth > 16) return "[depth limit]";
	if (Array.isArray(value)) return value.slice(0, 200).map((item) => redact(item, depth + 1));
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [
			key,
			SENSITIVE_KEY.test(key) ? "[redacted]" : redact(item, depth + 1),
		]),
	);
}

export function createPrivateDiagnosticExport(snapshot: ApplicationSnapshot): JsonValue {
	return redact({
		exportedAt: new Date().toISOString(),
		protocol: 1,
		status: snapshot.status,
		model: snapshot.model ? { provider: snapshot.model.provider, id: snapshot.model.id } : null,
		thinkingLevel: snapshot.thinkingLevel,
		capabilities: snapshot.capabilities,
		stats: snapshot.stats ?? null,
		diagnostics: snapshot.diagnostics ?? [],
		resources: snapshot.resources ?? null,
		extensionPresentation: snapshot.extensionPresentation ?? null,
	});
}
