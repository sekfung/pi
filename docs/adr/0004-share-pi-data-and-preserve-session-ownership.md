# Share Pi data and preserve session ownership

The TUI and desktop GUI will use the same Pi settings, credentials, trust decisions, resources, and session files. They may run different sessions concurrently, but existing session ownership locks remain authoritative and neither presentation may forcibly take a session from the other. The desktop application has one Active Runtime and must stop its current operation before switching projects or sessions.

## Consequences

No import or synchronization layer is needed between presentations. Desktop-only preferences such as window state, recent projects, and light or dark appearance live in platform application data and do not change terminal behavior.
