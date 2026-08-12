# Share application behavior across presentations

Pi will place session, command, model, settings, resource, and operation orchestration behind one presentation-neutral application interface. The TUI will call it in process and the desktop GUI will call it through a sidecar adapter; this avoids maintaining a second interpretation of workflows currently embedded in interactive mode, while keeping terminal and React rendering separate.

## Considered options

- Reuse the existing experimental remote-session protocol unchanged: rejected because it does not cover settings, authentication, resources, extensions, session trees, compaction, shell execution, or several other interactive workflows.
- Drive the TUI through its widgets or RPC mode: rejected because terminal presentation concepts and incomplete extension UI bridging would become the desktop contract.
- Use a shared typed intent/event interface: accepted because it gives both presentations one ordering model, one error model, and one behavioral test surface.

## Consequences

Interactive mode must gradually relinquish workflow ownership to the shared application module. The interface uses authoritative snapshots plus ordered events, and transport adapters must pass the same contract tests.
