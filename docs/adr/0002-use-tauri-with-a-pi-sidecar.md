# Use Tauri with a Pi sidecar

The Pi desktop application will use Tauri 2 with a React webview and a bundled Pi sidecar. Rust owns desktop lifecycle, permissions, and an opaque IPC relay; the sidecar owns coding-agent behavior and credentials. This follows the chosen lightweight desktop architecture without rewriting the TypeScript agent runtime in Rust or exposing Node capabilities to the webview.

## Considered options

- Electron: rejected because direct Node integration does not outweigh its larger runtime and divergence from the reference desktop architecture.
- Reimplement coding-agent behavior in Rust: rejected because it would create two product implementations.
- Tauri with a sidecar: accepted because the existing Bun release path can produce native executables while the webview remains isolated.

## Consequences

The renderer communicates through Tauri IPC, Rust relays framed CBOR over sidecar stdio, and the protocol must define disconnect, ordering, backpressure, and restart behavior. A crashed sidecar is reopened from persisted state; unconfirmed intents are never replayed automatically.
