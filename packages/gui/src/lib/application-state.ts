import type { ApplicationSnapshot, JsonValue } from "@earendil-works/pi-protocol";

type JsonRecord = { [key: string]: JsonValue };

function isRecord(value: JsonValue): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageIdentity(value: JsonValue): string | undefined {
	if (!isRecord(value)) return undefined;
	const role = typeof value.role === "string" ? value.role : undefined;
	const timestamp = typeof value.timestamp === "number" ? value.timestamp : undefined;
	return role && timestamp !== undefined ? `${role}:${timestamp}` : undefined;
}

export function applySessionEvent(snapshot: ApplicationSnapshot, event: JsonValue): ApplicationSnapshot {
	if (!isRecord(event) || typeof event.type !== "string") return snapshot;
	if (event.type === "agent_start") return { ...snapshot, status: { type: "running" } };
	if (event.type === "queue_update") {
		const steering = Array.isArray(event.steering)
			? event.steering.filter((value): value is string => typeof value === "string")
			: snapshot.queue.steering;
		const followUp = Array.isArray(event.followUp)
			? event.followUp.filter((value): value is string => typeof value === "string")
			: snapshot.queue.followUp;
		return { ...snapshot, queue: { steering, followUp } };
	}
	if (event.type === "thinking_level_changed" && typeof event.level === "string") {
		return { ...snapshot, thinkingLevel: event.level as ApplicationSnapshot["thinkingLevel"] };
	}
	if (
		(event.type === "message_start" || event.type === "message_update" || event.type === "message_end") &&
		event.message
	) {
		const message = event.message;
		const identity = messageIdentity(message);
		const index = identity ? snapshot.messages.findIndex((candidate) => messageIdentity(candidate) === identity) : -1;
		const messages = [...snapshot.messages];
		if (index === -1) messages.push(message);
		else messages[index] = message;
		return {
			...snapshot,
			status: event.type === "message_end" ? snapshot.status : { type: "running" },
			messages,
		};
	}
	if (event.type === "agent_settled") return { ...snapshot, status: { type: "idle" } };
	if (event.type === "compaction_start") return { ...snapshot, status: { type: "compacting" } };
	return snapshot;
}

export function messageText(message: JsonValue): string {
	if (!isRecord(message)) return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((part) => {
			if (!isRecord(part)) return [];
			if (part.type === "text" && typeof part.text === "string") return [part.text];
			if (part.type === "thinking" && typeof part.thinking === "string") return [part.thinking];
			return [];
		})
		.join("\n");
}

export function messageRole(message: JsonValue): string {
	return isRecord(message) && typeof message.role === "string" ? message.role : "custom";
}

export function sessionEventNotice(event: JsonValue): string | undefined {
	if (!isRecord(event) || typeof event.type !== "string") return undefined;
	switch (event.type) {
		case "auto_retry_start":
			return `Retrying ${typeof event.attempt === "number" ? `(${event.attempt}/${String(event.maxAttempts ?? "?")})` : ""}: ${typeof event.errorMessage === "string" ? event.errorMessage : "request failed"}`;
		case "auto_retry_end":
			return event.success === true
				? "Retry succeeded"
				: `Retry failed${typeof event.finalError === "string" ? `: ${event.finalError}` : ""}`;
		case "compaction_start":
			return `Compacting context (${typeof event.reason === "string" ? event.reason : "manual"})`;
		case "compaction_end":
			return event.aborted === true
				? "Compaction aborted"
				: typeof event.errorMessage === "string"
					? `Compaction failed: ${event.errorMessage}`
					: "Context compacted";
		case "summarization_retry_scheduled":
			return `Summary retry scheduled: ${typeof event.errorMessage === "string" ? event.errorMessage : "summary failed"}`;
		default:
			return undefined;
	}
}
