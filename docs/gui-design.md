# Pi desktop GUI design

## Status

Accepted design. Implementation is incremental and remains experimental until the parity matrix has no unfinished user workflow.

## Problem

Pi's reusable agent behavior is primarily implemented by `AgentSession`, `AgentSessionRuntime`, `SessionManager`, settings and resource loaders. However, interactive workflow orchestration is also embedded in the terminal-specific `InteractiveMode`. The experimental remote-session protocol covers prompting and a small set of session mutations but not the complete interactive product.

For example, presenting `/tree` in a desktop application requires more than rendering a selector: session navigation, branch switching, filtering, labels, fork behavior, locking, and errors must have the same meaning in both presentations. Reimplementing that orchestration in React would cause the TUI and GUI to diverge.

The solution is a deep application module with a small typed interface. It owns application behavior once; the TUI and GUI adapt input and output to their respective presentation systems.

## Scope

The desktop application:

- manages local Pi projects and sessions for one user;
- uses one Active Runtime and one Active Session at a time;
- shares existing Pi sessions, settings, credentials, trust records, and resources;
- provides user-workflow parity with interactive TUI mode;
- uses native GUI interactions rather than reproducing terminal mechanics;
- does not add a general file browser, code editor, or integrated terminal;
- supports Linux, macOS, and Windows, with Linux validated first;
- ships as `@earendil-works/pi-gui` from `packages/gui` and can also be launched through `pi gui`.

The first releases are experimental. Implementation may land in vertical slices, but a release must not claim parity until every non-excluded matrix row is complete and tested.

## Architecture

```text
TUI input/rendering ── in-process adapter ─┐
                                          ├── PiApplication
React/shadcn ─ Tauri IPC ─ Rust relay ─ sidecar adapter
                                          │
                  AgentSessionRuntime, AgentSession, settings,
                  sessions, resources, extensions, models, tools
```

`PiApplication` exposes a connection with three operations:

```ts
interface ApplicationConnection {
	execute(intent: ApplicationIntent): Promise<IntentReceipt>;
	events(signal?: AbortSignal): AsyncIterable<ApplicationEventEnvelope>;
	close(): Promise<void>;
}
```

Connecting returns an authoritative `Snapshot` and begins buffering later `Application Event` values before returning. Intent IDs are idempotent for one connection. State mutations are serialized. Long-running intents resolve when accepted and report progress or failure through correlated events. Selection-dependent mutations can require an expected revision and reject stale input.

Typed helper functions such as `submitPrompt()` and `setModel()` may make common calls concise, but they only construct intents and do not form a second behavior interface.

### State and ordering

- Event sequence numbers increase without gaps per connection.
- State revisions increase for authoritative state changes; streaming chunks may share a revision.
- Reconnect creates a fresh snapshot and does not replay events from a previous connection.
- Snapshot state includes the active project and session, transcript, queues, operations, model and thinking state, settings, capabilities, pending Host Interactions, and diagnostics.
- Large catalogs and histories may be paged through correlated query results rather than retained in every snapshot.
- Adapter or listener failures cannot mutate authoritative state.

### Process model

The desktop build bundles a Bun-compiled sidecar for each target. React sends and receives application protocol messages through Tauri IPC. Rust supervises the child process and relays framed CBOR over stdio without interpreting application semantics.

If the sidecar exits, the GUI shows a disconnected state and offers an explicit restart. Restarting reopens persisted session state; it does not replay an unconfirmed prompt, shell command, tool operation, or Host Interaction response.

## Desktop information architecture

The visual language follows the compact Codex-style shell established by the local Loopback reference without copying its brand or product modules:

- Geist typography, neutral OKLCH semantic tokens, subtle separators, compact ghost controls, and a pill composer;
- a fixed project and session sidebar;
- a compact header for project/session identity and contextual actions;
- a centered transcript with a persistent composer;
- light, dark, and system appearance modes;
- a command palette, session tree panel, settings surface, and diagnostics surface.

Projects are added through a native directory picker and retained as recent projects. Existing session directories can seed the recent list. Startup restores the last project and session without starting an agent turn. Missing directories return to project selection.

While an operation is running, switching project or session requires the user to remain or abort and switch. Closing the window follows the same rule; the first release has no tray process.

### Conversation

- User messages use restrained right-aligned bubbles; assistant messages remain on the content surface.
- Thinking and completed tool calls are collapsed by default and remain expandable.
- Markdown, highlighted code, diffs, Mermaid, images, extension messages, errors, retry, compaction, and branch summaries render inline.
- Raw tool and fallback data remain inspectable without dominating the default view.
- Large transcripts, tool results, session lists, and trees are virtualized; stream updates do not rebuild the complete transcript.

### Composer

The composer supports multiline editing, history, undo, pasted or selected images, drag and drop, path and `@file` completion, slash command completion, and the `!`/`!!` shell forms. During a turn it exposes steering and follow-up delivery explicitly. Queued messages can be inspected, removed, and returned to the editor.

`Cmd/Ctrl+K` opens a command palette containing built-in commands, extension commands, and currently available operations. Slash commands remain valid in the composer. GUI shortcuts map to shared action identifiers but use platform-appropriate defaults and reject conflicting custom bindings.

### Session tree

The session tree is a toggleable side panel with branch visualization, search and filters, folding, labels, copy, navigation, and fork operations. `/tree` opens the same panel. Navigating a branch and creating a Forked Session remain distinct operations.

## Extensions and presentation capabilities

Extension tools, commands, providers, flags, lifecycle events, standard messages, and Host Interactions execute in the sidecar. Secrets and executable extension code never enter the webview.

The GUI declares supported Presentation Capabilities. Terminal-specific custom renderers, headers, footers, widgets, autocomplete implementations, themes, and editors receive a sanitized Markdown, text, or structured-data fallback with a visible terminal-only indication. Unsupported behavior never disappears silently and never blocks otherwise compatible extension behavior.

## Security and privacy

- Project Trust is evaluated in the sidecar before loading project configuration or executable resources.
- File dialogs, directory dialogs, clipboard, external editor, and external link operations use explicit Tauri capabilities; sidecar behavior validates every supplied path again.
- Provider credentials and OAuth tokens remain in the sidecar. React receives authentication status and Host Interactions, not secrets.
- OAuth uses the system browser.
- The webview has a strict content security policy.
- Repository content, model output, Markdown, Mermaid, tool results, and extension fallback content are untrusted and sanitized before rendering.
- External links use an allowlist and confirmation flow.
- Diagnostic exports omit prompts, file contents, credentials, and full paths by default. Users may explicitly add more detail.

## Settings and desktop preferences

The GUI exposes every setting currently available through `/settings`. Advanced JSON-only settings are shown through diagnostics with an option to open the configuration file rather than duplicating every field as a form.

Desktop-only state includes recent projects, last selection, window geometry, appearance, and GUI shortcuts. It lives in platform application data. TUI ANSI themes remain terminal-only; GUI appearance does not mutate the terminal theme setting.

## Accessibility

Every workflow is keyboard reachable. Dialogs trap and restore focus correctly, icon-only controls have accessible names, state is not communicated by color alone, system scaling works, and reduced-motion preferences disable nonessential animation.

## Packaging and release

GUI packages follow Pi lockstep versioning. CI builds platform installers and matching sidecar binaries. Linux is the first required smoke-test platform; macOS and Windows artifacts follow the same architecture. The first release shows update availability and a download link but does not enable Tauri's signed updater.

## Testing

- Application interface contract tests run against in-memory, in-process, and sidecar adapters.
- Coding-agent behavior tests use the faux provider for prompts, tools, queues, abort, retry, compaction, session changes, authentication interactions, and extension behavior.
- React tests verify state projection, interaction, focus, sanitization, virtualization, and disabled-operation explanations.
- Tauri smoke tests verify startup, sidecar supervision, capabilities, project selection, and guarded shutdown.
- Existing TUI regressions remain required throughout migration.
- Large deterministic fixtures protect transcript, tool-output, session-list, and tree performance without specifying hardware-dependent wall-clock thresholds.

## Parity matrix

Each row must be classified as native GUI, fallback, terminal-only, or unfinished. Removing the experimental label requires no unfinished rows and automated coverage for every supported row.

| Area | Required GUI behavior | Initial status |
| --- | --- | --- |
| Streaming | Assistant text, thinking, tool calls/results, errors and cancellation | Native GUI |
| Composer | Multiline, history, undo, paste, image, path and command completion | Native GUI |
| Queue | Steering, follow-up, inspection, removal and retrieval | Native GUI |
| Shell | `!` contextual and `!!` non-contextual execution, streaming and abort | Native GUI |
| Models | Search, select, cycle, scoped models, thinking and authentication | Native GUI |
| Sessions | New, resume, rename, stats, clone, fork, import, export and share | Native GUI |
| Tree | Navigate, filter, fold, label, copy and fork | Native GUI |
| Context | Manual and automatic compaction, retry and context usage | Native GUI |
| Settings | Every `/settings` field and advanced-config access | Native GUI; terminal-only settings are labeled |
| Resources | Trust, reload, diagnostics, skills, prompts and extensions | Native GUI |
| Extensions | Tools, commands, providers, events and Host Interactions | Native GUI |
| Extension presentation | Sanitized standard fallback for terminal renderers | Fallback |
| Rich content | Markdown, code, diff, Mermaid and images | Native GUI |
| Commands | Slash completion and command palette | Native GUI |
| Shortcuts | Platform defaults, customization and conflict detection | Native GUI |
| Diagnostics | Status view and privacy-preserving export | Native GUI |
| Terminal rendering | ANSI, raw keys, alternate screen, terminal image protocols | Terminal-only |
| TUI customization | Custom terminal header/footer/widget/editor and ANSI themes | Terminal-only |
| Hidden commands | Debug and easter-egg dispatch paths | Terminal-only |
