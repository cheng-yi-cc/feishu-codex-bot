# Feishu Codex Workspace Design

## Overview

This project should evolve from a simple "Feishu message relay to `codex exec`" into a single-user Feishu workspace for daily development on a Windows machine. The target experience is a hybrid interaction model:

- natural-language chat remains the default entry point
- explicit commands remain available for control, recovery, and precise developer actions
- the bot behaves more like a persistent Codex workspace than a one-shot chatbot

The intended operator is a single private user running the bot on their own Windows development machine with automatic startup on boot.

## Goals

- Make Feishu feel like a smooth daily entry point for chatting with Codex and driving local development
- Preserve the ease of natural-language requests such as bug fixing, code explanation, refactoring, and test execution
- Add enough explicit control surface to make execution stable, inspectable, and recoverable
- Keep the architecture optimized for a single private operator instead of a shared multi-user bot
- Make startup and long-running behavior reliable enough for "boot and use" operation on Windows

## Non-Goals

- Building a fully general remote shell inside Feishu
- Supporting many concurrent users with isolated workspaces
- Replacing the local Codex CLI; this system should wrap and orchestrate it
- Providing unrestricted arbitrary host administration outside configured workspace boundaries

## Product Direction

### Interaction Model

The product should use a hybrid model.

Default behavior:

- the user speaks naturally in Feishu
- the bot infers whether the message is normal chat, a development request, or a control request
- the bot returns progress updates during execution instead of only a final answer

Control behavior:

- the user can issue clear commands for status, mode switches, execution control, and recovery
- commands are intentionally limited to high-value operations
- Feishu remains a workspace-oriented control surface, not a raw terminal transcript

### Core User Experience Principles

- Natural language is for goals
- Explicit commands are for control
- Status responses are for observability
- Attachments and artifacts are for heavy output
- Recovery after restart is a first-class workflow

## Current State Summary

The current repository already provides:

- Feishu WebSocket intake
- message parsing and trigger rules
- SQLite-backed conversation memory
- local attachment download
- a single serial execution queue
- local `codex exec` invocation
- reply chunking
- health endpoint
- a Windows starter script and a PM2 config

The biggest current limitation is that each request is modeled as a one-shot message-to-exec-to-reply cycle. That is not enough to feel like Codex CLI. The missing layer is task orchestration and workspace state management.

## Target Architecture

The new architecture should keep the existing stable Feishu and Codex integration points, while adding a proper orchestration layer between them.

### High-Level Layers

1. Feishu ingress
2. Message parser
3. Intent router
4. Conversation orchestrator
5. Task runtime and progress reporter
6. Codex adapter and local tool execution layer
7. Workspace/session/task state store
8. Feishu response renderer

### Keep

These parts should remain and be reused:

- Feishu WebSocket connection and event monitoring
- current client/auth setup
- SQLite persistence foundation
- attachment download pipeline
- Codex process invocation
- health server

### Refactor

The current monolithic message handler should be decomposed into focused units:

- parser: classify messages, commands, and attachments
- router: choose chat, development, control, or recovery path
- orchestrator: manage active mode, task lifecycle, and resume logic
- renderer: turn progress and results into Feishu-friendly replies

### Add

New subsystems should be introduced:

- task model and task lifecycle tracking
- resumable execution context
- workspace state management
- progress event model
- artifact index
- startup supervisor and recovery metadata

## Single-User Optimization

The design should intentionally optimize for a private single-user environment.

Implications:

- one primary local development workspace is enough
- only one foreground write task should run at a time
- read-heavy inspection actions can be allowed as lightweight side actions if they do not conflict
- access control can remain very strict and simple
- the UI and command model can assume one operator and one mental model

This keeps the product much simpler and more reliable than a multi-user shared-bot design.

## Workspace Model

The bot should behave like a persistent workspace attached to the local development machine.

### Workspace State

At minimum, persistent workspace state should include:

- current interaction mode
- current working directory
- most recent branch reference
- last active task id
- recent task list
- recent touched files
- recent command summary
- recent artifacts
- last error summary

### Working Directory Behavior

The system should support:

- a default root workspace from configuration
- explicit working directory inspection via command
- explicit working directory changes via command
- task execution against the current workspace context

The system should not silently drift into arbitrary directories. The active directory should always be visible via status output.

## Task Runtime Design

This is the most important functional change.

### Task Lifecycle

Every meaningful development request should become a tracked task with a lifecycle such as:

- queued
- running
- waiting_for_input
- interrupted
- failed
- completed
- resumable

### Runtime Responsibilities

The task runtime should:

- create a task record before starting work
- emit progress events during execution
- persist meaningful checkpoints
- summarize results when complete
- mark interrupted work clearly on restart
- expose the latest task for `/status` and `/resume`

### Progress Updates

Instead of only returning the final answer, the runtime should surface structured intermediate updates such as:

- reading files
- analyzing code paths
- editing files
- running tests
- retrying after a failure
- waiting on an explicit user choice

These should be rendered into concise Feishu progress messages rather than raw line-by-line terminal spam.

## Feishu Capability Surface

The capability surface should be split into natural-language behavior and a small explicit command surface.

### Natural-Language Development

The user should be able to say things like:

- fix this bug
- inspect this stack trace
- refactor this component
- run tests and fix failures
- explain this part of the codebase

The bot should infer a development task and enter the runtime flow without requiring command syntax.

### Core Control Commands

These commands should remain prominent:

- `/mode`
- `/new`
- `/resume`
- `/status`
- `/cwd`
- `/model`
- `/think`

These commands exist to control state, not to replace natural language.

### Developer Control Commands

These commands should provide precise operational control:

- `/run <command>`
- `/test [target]`
- `/diff`
- `/files`
- `/logs`
- `/branch`
- `/apply`
- `/abort`

### Output Model

The reply model should be:

- short human-readable summary in the main message
- structured status snippets for progress
- attachments for larger artifacts such as screenshots, patch files, logs, and generated outputs

The system should avoid flooding Feishu with noisy raw terminal output.

## Modes

The design should support explicit modes while still remaining useful without constant mode switching.

### Recommended Modes

- `chat`: normal assistant interaction, code understanding, planning, and low-friction help
- `dev`: workspace-oriented development mode where the bot assumes code and command execution are allowed

Mode is mostly about default behavior and response shaping, not hard capability walls. The current mode should be visible in `/status`.

## Recovery and Resume

Restart recovery is a core requirement because the bot will run on a Windows machine that auto-starts on boot.

### Persisted Resume Context

The system should store enough information to recover context after restart:

- last mode
- last working directory
- most recent running task
- interruption reason
- recent summary of progress
- recent artifacts

### Restart Behavior

If the bot stops during a running task:

- that task should be marked `interrupted`
- `/status` should show the interruption
- `/resume` should rebuild the latest useful context and allow the user to continue cleanly

The system should not blindly continue arbitrary side-effecting operations without user intent. It should recover context first, then continue on command or via a clear natural-language prompt.

## Stability and Startup

The deployment target is the current Windows development machine. The recommended design is a two-layer startup model.

### Outer Layer: Windows Task Scheduler

Task Scheduler should be responsible for:

- boot-time startup
- retry on login or network readiness events if needed
- relaunch after abnormal process termination
- stable invocation of a single known startup script

### Inner Layer: Application Supervisor

The application itself should include a light supervisor responsibility that can:

- validate environment prerequisites before starting the main bot loop
- verify `node`, `codex`, configuration, workspace, and database availability
- start the main runtime
- monitor health
- restart or fail clearly on unrecoverable errors
- write startup and restart reasons to persistent logs

### Why This Combination

Task Scheduler gives the machine-level startup guarantee. The internal supervisor gives application-level self-healing and observability. Using both is more reliable than depending on either one alone.

## Observability

The system should be easy to diagnose from both the machine and Feishu.

### Machine-Side Observability

Persistent logs should include:

- startup attempts
- configuration validation failures
- task start/finish/failure
- supervisor restarts
- Codex execution errors
- health check failures

### Feishu-Side Observability

`/status` should return a concise operational snapshot including:

- current mode
- active workspace
- queue/task state
- latest task outcome
- last error timestamp or summary
- model and thinking settings

`/logs` should provide a recent failure summary or a log attachment, not an unbounded stream.

## Security Boundaries

The user selected a private single-user and full-automation model, but guardrails still matter.

The design should enforce:

- strict `open_id` allow-listing
- a configured workspace root and path validation
- attachment download and upload restricted to allowed workspace paths
- high-risk actions exposed through explicit control surfaces
- stable startup paths and fixed runtime directories

The design assumes powerful local execution is acceptable because the operator is the machine owner. The goal is not to remove capability; it is to keep that capability understandable and bounded.

## Data Model Changes

The current SQLite store is conversation-centric. It should expand to support operational state.

New or expanded entities should include:

- tasks
- task_events
- workspace_state
- artifacts
- runtime_snapshots

Conversation history should remain, but task and workspace data should become first-class.

## Rendering Strategy

Feishu is not a terminal, so rendering strategy matters.

The bot should use:

- concise progress checkpoints
- compact summaries
- chunked text when needed
- file/image attachments for rich outputs

It should avoid:

- raw JSON event dumps
- full terminal transcripts
- long noisy logs pasted into the main chat stream

## Migration Strategy

The safest path is incremental evolution instead of a rewrite.

Recommended order:

1. Introduce new persistence for tasks and workspace state
2. Split the current handler into parser, router, orchestrator, and renderer
3. Add tracked task lifecycle and progress updates
4. Add command surface for workspace control and resume
5. Introduce supervisor/startup hardening
6. Polish status/log/diff/artifact responses

This allows the current bot to keep functioning while the workspace behavior grows around it.

## Testing Strategy

Testing should cover both existing and new behavior.

### Automated Tests

- command parsing
- intent routing
- task state transitions
- restart recovery logic
- workspace path validation
- response rendering
- supervisor health and restart logic where practical

### Functional Validation

- DM natural-language development request
- explicit `/run`, `/test`, `/status`, `/resume`
- interrupted task after forced process stop
- restart and recovery visibility
- boot-time startup on Windows

## Success Criteria

The design is successful when:

- the user can treat Feishu as a practical daily front-end for local Codex-assisted development
- natural-language requests trigger useful development behavior without command friction
- status, recovery, and precise control are available when needed
- the bot survives normal machine restarts and can restore recent context
- the system feels closer to a persistent Codex workspace than a simple chat relay

## Recommended Implementation Direction

Build the product as a "Feishu Codex Workspace" rather than a "Feishu terminal bot."

That means:

- keep the UI chat-native
- make the runtime task-native
- make the workspace persistent
- make startup and recovery boringly reliable

This direction best matches the requested hybrid interaction style, the single-user private usage model, and the Windows auto-start deployment target.
