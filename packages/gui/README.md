# Pi desktop GUI

Experimental native desktop presentation for Pi. It uses Tauri 2, React, Tailwind CSS, and shadcn-style components. Coding-agent behavior runs in a bundled local sidecar; the webview only receives the typed application protocol.

The application opens local projects and shares Pi sessions, settings, credentials, trust records, resources, tools, extensions, models, and application behavior with the terminal presentation. It includes transcript streaming, structured tool/thinking content, safe Markdown and Mermaid rendering, prompt queues, shell execution, model authentication, session and tree management, settings, diagnostics, command completion, and extension Host Interactions. See [`../../docs/gui-design.md`](../../docs/gui-design.md) for the accepted design and parity matrix.

## Development

Install repository dependencies with `npm install --ignore-scripts`, hydrate model data with `npm run hydrate:model-data`, then run:

```sh
npm --prefix packages/gui run tauri -- dev
```

The Tauri hook builds the required workspace packages and the target-specific Bun sidecar before starting Vite. A working Bun executable, Rust toolchain, and platform Tauri prerequisites are required.

Run focused checks with:

```sh
npm --prefix packages/gui run typecheck
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/application-state.test.ts
npm --prefix packages/gui run sidecar
cd packages/gui/src-tauri && cargo check
```

`pi gui` launches the installed desktop application for the current directory. Use `pi gui --project <path>` to select another project, or `PI_GUI_EXECUTABLE` for a development build.
