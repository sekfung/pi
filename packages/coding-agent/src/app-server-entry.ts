#!/usr/bin/env node

import { Writable } from "node:stream";
import { connectAgentSessionApplication } from "./application/connect.ts";
import { serveApplicationSidecar } from "./application/sidecar.ts";
import { APP_NAME } from "./config.ts";
import { configureHttpDispatcher } from "./core/http-dispatcher.ts";
import { takeOverStdout } from "./core/output-guard.ts";

process.title = `${APP_NAME}-app-server`;
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "pi";
process.emitWarning = (() => {}) as typeof process.emitWarning;

configureHttpDispatcher();

const rawStdoutWrite = process.stdout.write.bind(process.stdout);
const protocolOutput = new Writable({
	write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
		rawStdoutWrite(chunk, callback);
	},
});
takeOverStdout();

const cwd = process.argv[2] ?? process.cwd();
const application = await connectAgentSessionApplication(cwd);
await serveApplicationSidecar({ application, input: process.stdin, output: protocolOutput });
