# TUI Guide

Status: Draft v1.0  
Last updated: 2026-02-20T00:00:00Z

## Purpose

Describe the canonical terminal-owned TUI flow backed by the Node supervisor and progress protocol v2.

## Entry points

- `bin/pairofcleats-tui.js` (wrapper)
- `tools/tui/install.js` (install/update flow)

## Runtime model

1. TUI starts and handshakes with supervisor.
2. Supervisor launches jobs and emits structured lifecycle/progress events.
3. TUI renders jobs, tasks, and logs deterministically.
4. Cancel/shutdown propagates to all child processes with bounded teardown.

## Protocol expectations

- Progress events must be `proto: "poc.progress@2"`.
- Line framing and size caps are enforced by shared progress stream decoder.
- Unexpected event shapes are treated as hard protocol errors.

## Failure behavior

- Missing/invalid TUI binary: fail fast with actionable message.
- Supervisor protocol violation: fail current session and emit diagnostic.
- Cancellation timeout: terminate remaining subprocess tree and close session.

## Observability

- Session correlation ID required for each run.
- Replayable event logs required for debugging and determinism checks.

## Related specs

- `docs/specs/tui-tool-contract.md`
- `docs/specs/node-supervisor-protocol.md`
- `docs/specs/progress-protocol-v2.md`
- `docs/specs/tui-installation.md`
