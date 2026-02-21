# TUI Performance and Backpressure Spec

Status: active  
Last updated: 2026-02-21T00:00:00Z

## Scope

Define deterministic throughput and latency controls for the Node supervisor + Rust TUI runtime.

## Supervisor flow control

- Credit-based stream control via `{"proto":"poc.tui@1","op":"flow:credit","credits":N}`.
- Bounded queue for non-critical events.
- Deterministic overload policy:
  - coalesce same `task:progress` key first
  - drop oldest queued `log` entries next
  - preserve critical lifecycle events
- Emit `runtime:metrics` periodically with queue/credit/drop counters.

## Oversized payload handling

- When a protocol event exceeds supervisor size threshold, emit chunk envelopes:
  - `event: "event:chunk"`
  - `chunkId`, `chunkEvent`, `chunkIndex`, `chunkCount`, `chunk`
- TUI must deterministically reassemble chunk streams by `chunkId` and index order.
- On chunk-memory overflow, TUI must clear pending assemblies and emit diagnostic telemetry.

## TUI virtualization and scheduling

- Jobs/tasks/logs panes use deterministic viewport windows over ring buffers/maps.
- Render loop uses fixed cadence and frame budget warning threshold.
- Dirty-signature diff prevents unnecessary redraws when model-visible state is unchanged.

## Input control

- Input events are queued with stable sequence numbers.
- Debounce repeated key inputs within a fixed window.
- Dispatch is throttled to stable ordering under key-repeat bursts.

## Session resilience

- Persist `last-state.json` snapshot (`selected_job`, pane scroll offsets).
- Restore snapshot on startup when available.

## Capability negotiation

Read deterministic toggles from env:

- `PAIROFCLEATS_TUI_ALT_SCREEN`
- `PAIROFCLEATS_TUI_MOUSE`
- `PAIROFCLEATS_TUI_UNICODE`
- `NO_COLOR`

## Runtime telemetry

- Emit structured runtime metrics as JSONL:
  - event-lag EWMA
  - render-time EWMA
  - queue-depth EWMA
  - processed event count
  - chunk reassembly/drop counters
- Default sink: `<eventLogDir>/<runId>.runtime.jsonl`

## Related specs

- `docs/specs/node-supervisor-protocol.md`
- `docs/specs/progress-protocol-v2.md`
- `docs/specs/tui-installation.md`
