import Type, { type Static } from "typebox";
import { ImageContentSchema, JsonValueSchema, ThinkingLevelSchema } from "./schemas.ts";

export const APPLICATION_PROTOCOL_VERSION = 1 as const;

const IdSchema = Type.String({ minLength: 1 });
const StrictObject = <const T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });

export const ApplicationCapabilitySchema = Type.Union([
	Type.Literal("prompt"),
	Type.Literal("abort"),
	Type.Literal("thinking"),
	Type.Literal("queue"),
	Type.Literal("shell"),
	Type.Literal("models"),
	Type.Literal("sessions"),
	Type.Literal("tree"),
	Type.Literal("compaction"),
	Type.Literal("export"),
	Type.Literal("settings"),
	Type.Literal("resources"),
	Type.Literal("tools"),
	Type.Literal("trust"),
	Type.Literal("commands"),
	Type.Literal("interactions"),
]);
export type ApplicationCapability = Static<typeof ApplicationCapabilitySchema>;

export const ApplicationStatusSchema = Type.Union([
	StrictObject({ type: Type.Literal("idle") }),
	StrictObject({ type: Type.Literal("running") }),
	StrictObject({ type: Type.Literal("compacting") }),
	StrictObject({ type: Type.Literal("running_bash") }),
	StrictObject({ type: Type.Literal("closed") }),
]);
export type ApplicationStatus = Static<typeof ApplicationStatusSchema>;

export const ApplicationSnapshotSchema = StrictObject({
	sequence: Type.Integer({ minimum: 0 }),
	revision: Type.Integer({ minimum: 0 }),
	project: StrictObject({ cwd: Type.String({ minLength: 1 }), trusted: Type.Optional(Type.Boolean()) }),
	session: StrictObject({
		id: IdSchema,
		file: Type.Optional(Type.String({ minLength: 1 })),
		name: Type.Optional(Type.String()),
	}),
	status: ApplicationStatusSchema,
	model: Type.Optional(
		StrictObject({
			provider: IdSchema,
			id: IdSchema,
			name: Type.String({ minLength: 1 }),
		}),
	),
	thinkingLevel: ThinkingLevelSchema,
	messages: Type.Array(JsonValueSchema),
	queue: StrictObject({
		steering: Type.Array(Type.String()),
		followUp: Type.Array(Type.String()),
	}),
	availableThinkingLevels: Type.Optional(Type.Array(ThinkingLevelSchema)),
	models: Type.Optional(Type.Array(JsonValueSchema)),
	stats: Type.Optional(JsonValueSchema),
	tree: Type.Optional(JsonValueSchema),
	diagnostics: Type.Optional(Type.Array(JsonValueSchema)),
	settings: Type.Optional(JsonValueSchema),
	tools: Type.Optional(Type.Array(JsonValueSchema)),
	resources: Type.Optional(JsonValueSchema),
	commands: Type.Optional(Type.Array(JsonValueSchema)),
	interactions: Type.Optional(Type.Array(JsonValueSchema)),
	extensionPresentation: Type.Optional(JsonValueSchema),
	capabilities: Type.Array(ApplicationCapabilitySchema),
});
export type ApplicationSnapshot = Static<typeof ApplicationSnapshotSchema>;

export const PromptSubmitActionSchema = StrictObject({
	type: Type.Literal("prompt.submit"),
	text: Type.String(),
	delivery: Type.Union([Type.Literal("now"), Type.Literal("steer"), Type.Literal("followUp")]),
	images: Type.Optional(Type.Array(ImageContentSchema)),
});
export const OperationAbortActionSchema = StrictObject({ type: Type.Literal("operation.abort") });
export const ThinkingSetActionSchema = StrictObject({
	type: Type.Literal("thinking.set"),
	level: ThinkingLevelSchema,
});
export const QueueClearActionSchema = StrictObject({ type: Type.Literal("queue.clear") });
export const QueueRemoveActionSchema = StrictObject({
	type: Type.Literal("queue.remove"),
	queue: Type.Union([Type.Literal("steering"), Type.Literal("followUp")]),
	index: Type.Integer({ minimum: 0 }),
});
export const ShellRunActionSchema = StrictObject({
	type: Type.Literal("shell.run"),
	command: Type.String({ minLength: 1 }),
	excludeFromContext: Type.Boolean(),
});
export const ModelSelectActionSchema = StrictObject({
	type: Type.Literal("model.select"),
	provider: IdSchema,
	modelId: IdSchema,
});
export const ModelCycleActionSchema = StrictObject({
	type: Type.Literal("model.cycle"),
	direction: Type.Union([Type.Literal("forward"), Type.Literal("backward")]),
});
export const ModelAuthenticateActionSchema = StrictObject({
	type: Type.Literal("model.authenticate"),
	provider: IdSchema,
	method: Type.Union([Type.Literal("api_key"), Type.Literal("oauth")]),
});
export const ModelLogoutActionSchema = StrictObject({ type: Type.Literal("model.logout"), provider: IdSchema });
export const SessionNewActionSchema = StrictObject({ type: Type.Literal("session.new") });
export const SessionResumeActionSchema = StrictObject({
	type: Type.Literal("session.resume"),
	sessionPath: Type.String({ minLength: 1 }),
});
export const SessionForkActionSchema = StrictObject({
	type: Type.Literal("session.fork"),
	entryId: IdSchema,
	position: Type.Union([Type.Literal("before"), Type.Literal("at")]),
});
export const SessionImportActionSchema = StrictObject({
	type: Type.Literal("session.import"),
	path: Type.String({ minLength: 1 }),
});
export const SessionRenameActionSchema = StrictObject({
	type: Type.Literal("session.rename"),
	name: Type.String({ minLength: 1 }),
});
export const SessionCompactActionSchema = StrictObject({
	type: Type.Literal("session.compact"),
	instructions: Type.Optional(Type.String()),
});
export const SessionExportActionSchema = StrictObject({
	type: Type.Literal("session.export"),
	format: Type.Union([Type.Literal("html"), Type.Literal("jsonl")]),
	destination: Type.Optional(Type.String({ minLength: 1 })),
});
export const SessionCloneActionSchema = StrictObject({ type: Type.Literal("session.clone") });
export const SessionShareActionSchema = StrictObject({ type: Type.Literal("session.share") });
export const SessionCopyLastActionSchema = StrictObject({ type: Type.Literal("session.copyLast") });
export const TreeNavigateActionSchema = StrictObject({
	type: Type.Literal("tree.navigate"),
	entryId: IdSchema,
	summarize: Type.Boolean(),
	instructions: Type.Optional(Type.String()),
});
export const TreeLabelActionSchema = StrictObject({
	type: Type.Literal("tree.label"),
	entryId: IdSchema,
	label: Type.Optional(Type.String()),
});
export const SettingsPatchActionSchema = StrictObject({
	type: Type.Literal("settings.patch"),
	scope: Type.Union([Type.Literal("global"), Type.Literal("project")]),
	patch: JsonValueSchema,
});
export const ResourcesReloadActionSchema = StrictObject({ type: Type.Literal("resources.reload") });
export const ProjectTrustActionSchema = StrictObject({
	type: Type.Literal("project.trust"),
	trusted: Type.Boolean(),
	remember: Type.Boolean(),
});
export const ToolsSetActiveActionSchema = StrictObject({
	type: Type.Literal("tools.setActive"),
	names: Type.Array(IdSchema),
});
export const CatalogQueryActionSchema = StrictObject({
	type: Type.Literal("catalog.query"),
	catalog: Type.Union([
		Type.Literal("models"),
		Type.Literal("sessions"),
		Type.Literal("tree"),
		Type.Literal("tools"),
		Type.Literal("resources"),
		Type.Literal("files"),
		Type.Literal("updates"),
	]),
	query: Type.Optional(Type.String()),
});
export const CommandExecuteActionSchema = StrictObject({
	type: Type.Literal("command.execute"),
	line: Type.String({ minLength: 1 }),
});
export const InteractionRespondActionSchema = StrictObject({
	type: Type.Literal("interaction.respond"),
	interactionId: IdSchema,
	response: JsonValueSchema,
});
export const ApplicationActionSchema = Type.Union([
	PromptSubmitActionSchema,
	OperationAbortActionSchema,
	ThinkingSetActionSchema,
	QueueClearActionSchema,
	QueueRemoveActionSchema,
	ShellRunActionSchema,
	ModelSelectActionSchema,
	ModelCycleActionSchema,
	ModelAuthenticateActionSchema,
	ModelLogoutActionSchema,
	SessionNewActionSchema,
	SessionResumeActionSchema,
	SessionForkActionSchema,
	SessionImportActionSchema,
	SessionRenameActionSchema,
	SessionCompactActionSchema,
	SessionExportActionSchema,
	SessionCloneActionSchema,
	SessionShareActionSchema,
	SessionCopyLastActionSchema,
	TreeNavigateActionSchema,
	TreeLabelActionSchema,
	SettingsPatchActionSchema,
	ResourcesReloadActionSchema,
	ProjectTrustActionSchema,
	ToolsSetActiveActionSchema,
	CatalogQueryActionSchema,
	CommandExecuteActionSchema,
	InteractionRespondActionSchema,
]);
export type ApplicationAction = Static<typeof ApplicationActionSchema>;

export const ApplicationIntentSchema = StrictObject({
	id: IdSchema,
	ifRevision: Type.Optional(Type.Integer({ minimum: 0 })),
	action: ApplicationActionSchema,
});
export type ApplicationIntent = Static<typeof ApplicationIntentSchema>;

export const ApplicationErrorCodeSchema = Type.Union([
	Type.Literal("invalid_intent"),
	Type.Literal("stale_revision"),
	Type.Literal("busy"),
	Type.Literal("not_found"),
	Type.Literal("unsupported"),
	Type.Literal("closed"),
	Type.Literal("internal"),
]);
export const ApplicationErrorSchema = StrictObject({
	code: ApplicationErrorCodeSchema,
	message: Type.String(),
	retryable: Type.Boolean(),
});
export type ApplicationError = Static<typeof ApplicationErrorSchema>;

export const IntentReceiptSchema = Type.Union([
	StrictObject({
		status: Type.Literal("accepted"),
		revision: Type.Integer({ minimum: 0 }),
	}),
	StrictObject({
		status: Type.Literal("rejected"),
		error: ApplicationErrorSchema,
		revision: Type.Integer({ minimum: 0 }),
	}),
]);
export type IntentReceipt = Static<typeof IntentReceiptSchema>;

export const ApplicationEventSchema = Type.Union([
	StrictObject({ type: Type.Literal("session_event"), event: JsonValueSchema }),
	StrictObject({ type: Type.Literal("snapshot_replaced"), snapshot: ApplicationSnapshotSchema }),
	StrictObject({
		type: Type.Literal("operation_failed"),
		intentId: IdSchema,
		error: ApplicationErrorSchema,
	}),
	StrictObject({
		type: Type.Literal("operation_completed"),
		intentId: IdSchema,
		result: Type.Optional(JsonValueSchema),
	}),
	StrictObject({ type: Type.Literal("application_closed") }),
]);
export type ApplicationEvent = Static<typeof ApplicationEventSchema>;

export const ApplicationEventEnvelopeSchema = StrictObject({
	sequence: Type.Integer({ minimum: 1 }),
	revision: Type.Integer({ minimum: 0 }),
	causedBy: Type.Optional(IdSchema),
	event: ApplicationEventSchema,
});
export type ApplicationEventEnvelope = Static<typeof ApplicationEventEnvelopeSchema>;

export const ApplicationClientHelloSchema = StrictObject({
	type: Type.Literal("hello"),
	version: Type.Integer({ minimum: 0 }),
});
export const ApplicationExecuteSchema = StrictObject({
	type: Type.Literal("execute"),
	requestId: IdSchema,
	intent: ApplicationIntentSchema,
});
export const ApplicationCloseSchema = StrictObject({
	type: Type.Literal("close"),
	requestId: IdSchema,
});
export const ApplicationClientMessageSchema = Type.Union([
	ApplicationClientHelloSchema,
	ApplicationExecuteSchema,
	ApplicationCloseSchema,
]);
export type ApplicationClientMessage = Static<typeof ApplicationClientMessageSchema>;

export const ApplicationServerHelloSchema = StrictObject({
	type: Type.Literal("hello"),
	version: Type.Literal(APPLICATION_PROTOCOL_VERSION),
	connectionId: IdSchema,
	snapshot: ApplicationSnapshotSchema,
});
export const ApplicationServerHelloErrorSchema = StrictObject({
	type: Type.Literal("hello_error"),
	error: ApplicationErrorSchema,
});
export const ApplicationReceiptSchema = StrictObject({
	type: Type.Literal("receipt"),
	requestId: IdSchema,
	receipt: IntentReceiptSchema,
});
export const ApplicationEventMessageSchema = StrictObject({
	type: Type.Literal("event"),
	envelope: ApplicationEventEnvelopeSchema,
});
export const ApplicationClosedSchema = StrictObject({
	type: Type.Literal("closed"),
	requestId: IdSchema,
});
export const ApplicationFatalSchema = StrictObject({
	type: Type.Literal("fatal"),
	error: ApplicationErrorSchema,
});
export const ApplicationServerMessageSchema = Type.Union([
	ApplicationServerHelloSchema,
	ApplicationServerHelloErrorSchema,
	ApplicationReceiptSchema,
	ApplicationEventMessageSchema,
	ApplicationClosedSchema,
	ApplicationFatalSchema,
]);
export type ApplicationServerMessage = Static<typeof ApplicationServerMessageSchema>;
