# Pi Application Context

Pi runs coding-agent conversations for a project and preserves their history as sessions. The same application behavior can be presented through terminal and desktop interfaces.

## Projects and sessions

**Project**:
A directory in which Pi runs tools and resolves project-scoped settings, context, resources, and trust.
_Avoid_: Workspace, repository

**Session**:
A persisted conversation tree for one project, including messages, tool activity, branches, labels, and compaction records.
_Avoid_: Chat, conversation file, thread

**Active Session**:
The session currently attached to Pi's live agent state.
_Avoid_: Open chat, selected conversation

**Active Runtime**:
The single live execution context that owns the active session, loaded project resources, and running operations.
_Avoid_: Backend, worker, server

**Session Branch**:
One path through a session tree selected as the active history while other paths remain preserved.
_Avoid_: Fork, conversation copy

**Forked Session**:
A new session created from a point in an existing session's active branch.
_Avoid_: Session branch, clone

## Interaction

**Turn**:
One accepted user input and the resulting agent activity through completion, failure, or cancellation.
_Avoid_: Request, job

**Steering Message**:
Input queued for delivery during the current turn at the next supported steering point.
_Avoid_: Interrupt message

**Follow-up Message**:
Input queued to begin a later turn after the current turn finishes.
_Avoid_: Deferred prompt

**Host Interaction**:
A pending request for presentation-mediated user input, such as confirmation, selection, authentication, or text entry.
_Avoid_: Dialog, modal

## Application behavior

**Intent**:
A uniquely identified request to change application state or start an operation.
_Avoid_: Command, action, RPC request

**Snapshot**:
The authoritative presentation-neutral application state at a revision and event sequence.
_Avoid_: View model, store state

**Application Event**:
An ordered fact emitted after connection that describes progress or a change relative to a snapshot.
_Avoid_: UI event, callback

**Presentation Capability**:
A kind of interaction or content that a presentation can render or complete without losing its meaning.
_Avoid_: Feature flag, widget support

## Extensibility and trust

**Resource**:
A project, user, package, or explicit-path contribution loaded by Pi, including extensions, skills, prompts, themes, and context files.
_Avoid_: Plugin, asset

**Extension**:
Executable Pi customization that can contribute tools, commands, providers, event handlers, and optional presentation behavior.
_Avoid_: Resource, plugin

**Project Trust**:
A persisted decision that permits Pi to load and execute project-scoped configuration and resources for a project.
_Avoid_: Approval, permission
