# Separate extension behavior from terminal presentation

The desktop GUI will preserve extension tools, commands, providers, lifecycle events, and standard host interactions, but it will not translate arbitrary terminal renderers, headers, footers, widgets, themes, or editors into React. Unsupported presentation contributions receive a standard text or structured-data fallback and an explicit terminal-only diagnostic, because automatic visual translation would be incomplete and unsafe to treat as parity.

## Consequences

The application contract negotiates presentation capabilities. Extension code stays in the sidecar, and only sanitized presentation-neutral data crosses into the webview. A future portable extension presentation interface can be added independently.
