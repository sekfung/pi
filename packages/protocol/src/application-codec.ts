import { Check } from "typebox/value";
import {
	APPLICATION_PROTOCOL_VERSION,
	type ApplicationClientMessage,
	ApplicationClientMessageSchema,
	type ApplicationServerMessage,
	ApplicationServerMessageSchema,
} from "./application-schemas.ts";
import { decodeCbor, encodeCbor } from "./cbor/index.ts";
import { ProtocolValidationError } from "./codec.ts";
import {
	assertCompleteFrame,
	DEFAULT_MAX_FRAME_LENGTH,
	encodeFrame,
	FrameDecoder,
	type FrameDecoderOptions,
} from "./framing.ts";

function isApplicationProtocolValue(value: unknown, optionalProperty = false, ancestors = new Set<object>()): boolean {
	if (value === undefined) return optionalProperty;
	if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
		return true;
	}
	if (typeof value !== "object" || ancestors.has(value)) return false;
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			return value.every((item) => isApplicationProtocolValue(item, false, ancestors));
		}
		if (Object.getPrototypeOf(value) !== Object.prototype) return false;
		return Object.values(value).every((item) => isApplicationProtocolValue(item, true, ancestors));
	} finally {
		ancestors.delete(value);
	}
}

export function parseApplicationClientMessage(value: unknown): ApplicationClientMessage {
	if (!isApplicationProtocolValue(value) || !Check(ApplicationClientMessageSchema, value)) {
		throw new ProtocolValidationError("Invalid application client protocol message");
	}
	return value;
}

export function parseApplicationServerMessage(value: unknown): ApplicationServerMessage {
	if (!isApplicationProtocolValue(value) || !Check(ApplicationServerMessageSchema, value)) {
		throw new ProtocolValidationError("Invalid application server protocol message");
	}
	return value;
}

function boundedErrorMessage(error: unknown): string {
	if (!(error instanceof Error)) return "Unknown codec error";
	return error.message.length <= 500 ? error.message : `${error.message.slice(0, 497)}...`;
}

function encodeApplicationMessage<T>(
	value: T,
	parse: (candidate: unknown) => T,
	kind: string,
	options?: FrameDecoderOptions,
): Uint8Array {
	const validated = parse(value);
	try {
		const maxFrameLength = options?.maxFrameLength ?? DEFAULT_MAX_FRAME_LENGTH;
		const frame = encodeFrame(encodeCbor(validated, { maxByteLength: maxFrameLength }));
		assertCompleteFrame(frame, { maxFrameLength });
		return frame;
	} catch (error) {
		if (error instanceof ProtocolValidationError) throw error;
		throw new ProtocolValidationError(`Unable to encode ${kind} application message: ${boundedErrorMessage(error)}`);
	}
}

export function encodeApplicationClientMessage(
	message: ApplicationClientMessage,
	options?: FrameDecoderOptions,
): Uint8Array {
	return encodeApplicationMessage(message, parseApplicationClientMessage, "client", options);
}

export function encodeApplicationServerMessage(
	message: ApplicationServerMessage,
	options?: FrameDecoderOptions,
): Uint8Array {
	return encodeApplicationMessage(message, parseApplicationServerMessage, "server", options);
}

class ApplicationMessageDecoder<T> {
	private failed = false;
	private readonly frames: FrameDecoder;
	private readonly kind: string;
	private readonly maxFrameLength: number;
	private readonly parse: (candidate: unknown) => T;

	constructor(kind: string, parse: (candidate: unknown) => T, options?: FrameDecoderOptions) {
		this.frames = new FrameDecoder(options);
		this.kind = kind;
		this.maxFrameLength = options?.maxFrameLength ?? DEFAULT_MAX_FRAME_LENGTH;
		this.parse = parse;
	}

	push(chunk: Uint8Array): T[] {
		if (this.failed) throw new ProtocolValidationError(`${this.kind} application decoder has failed`);
		try {
			const messages: T[] = [];
			for (const frame of this.frames.push(chunk)) {
				messages.push(this.parse(decodeCbor(frame, { maxByteLength: this.maxFrameLength })));
			}
			return messages;
		} catch (error) {
			this.failed = true;
			if (error instanceof ProtocolValidationError) throw error;
			throw new ProtocolValidationError(`Invalid ${this.kind} application frame: ${boundedErrorMessage(error)}`);
		}
	}

	end(): void {
		if (this.failed) throw new ProtocolValidationError(`${this.kind} application decoder has failed`);
		try {
			this.frames.end();
		} catch (error) {
			this.failed = true;
			throw new ProtocolValidationError(`Invalid ${this.kind} application framing: ${boundedErrorMessage(error)}`);
		}
	}
}

export class ApplicationClientMessageDecoder {
	private readonly decoder: ApplicationMessageDecoder<ApplicationClientMessage>;

	constructor(options?: FrameDecoderOptions) {
		this.decoder = new ApplicationMessageDecoder("client", parseApplicationClientMessage, options);
	}

	push(chunk: Uint8Array): ApplicationClientMessage[] {
		return this.decoder.push(chunk);
	}

	end(): void {
		this.decoder.end();
	}
}

export class ApplicationServerMessageDecoder {
	private readonly decoder: ApplicationMessageDecoder<ApplicationServerMessage>;

	constructor(options?: FrameDecoderOptions) {
		this.decoder = new ApplicationMessageDecoder("server", parseApplicationServerMessage, options);
	}

	push(chunk: Uint8Array): ApplicationServerMessage[] {
		return this.decoder.push(chunk);
	}

	end(): void {
		this.decoder.end();
	}
}

export function isSupportedApplicationProtocolVersion(version: number): version is typeof APPLICATION_PROTOCOL_VERSION {
	return Number.isInteger(version) && version === APPLICATION_PROTOCOL_VERSION;
}
