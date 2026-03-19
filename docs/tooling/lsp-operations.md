# LSP Operations

This document defines the operational surfaces for the LSP runtime, replay artifacts, and CI gates.

## CI Gates

- `tools/ci/tooling-lsp-slo-gate.js`
  - Probes enabled providers and emits latency, timeout, fatal-failure, and enrichment-coverage metrics.
  - Accepts `--baseline` to emit a structured `regressionDiff`.
- `tools/ci/tooling-lsp-replay-gate.js`
  - Captures a real JSON-RPC trace from the stub server, replays it deterministically, and fails on unmatched responses, pending requests, or protocol errors.
  - Writes a durable trace artifact next to the JSON payload when `--json` is provided.
- `tools/ci/tooling-lsp-default-enable-gate.js`
  - Verifies that default-enabled providers remain present, enabled, and available in the doctor report.
- `tools/bench/language/tooling-lsp-guardrail.js`
  - Converts either benchmark reports or LSP SLO metrics into a bench-facing guardrail payload.
  - Accepts `--baseline` to emit a structured `regressionDiff`.

## Replay Artifacts

- JSON-RPC traces are emitted as JSONL with schema versioning and explicit event direction.
- The replay summary is expected to remain deterministic for:
  - outbound request and notification counts
  - inbound response and notification counts
  - method counts
  - pending request count
  - unmatched response count
  - protocol error presence
- A healthy replay gate result has:
  - `pendingRequestCount = 0`
  - `unmatchedResponses = 0`
  - `hasProtocolErrors = false`
  - observed `initialize`, `textDocument/didOpen`, `textDocument/documentSymbol`, and `textDocument/hover`

## Provider Delta Contract

Provider-specific runtime policy lives in `src/index/tooling/lsp-provider-deltas.js`.

Each provider entry must encode:
- request-budget weight
- confidence bias
- adaptive doc-scope policy, when applicable
- workspace checks
- bootstrap checks
- fallback-reason hints

The default-enable policy and provider delta manifest are expected to stay aligned.

## Operator Triage

When an LSP regression appears:

1. Inspect the doctor gate payload and confirm whether the provider failure is availability, handshake, workspace, or bootstrap related.
2. Inspect the replay-gate JSON and trace artifact to determine whether the problem is protocol-level, request-lifecycle-related, or enrichment-merge-related.
3. Compare current SLO and guardrail payloads to the most recent accepted baseline.
4. If the provider is quarantined, inspect the runtime health counters and quarantine level before retrying.
5. Only re-enable a default-enabled provider after the doctor, replay, and SLO gates all return healthy results for that provider class.

## Failure Classes

- Capability drift:
  - provider advertises support and later rejects or omits the method
- Delayed partial response:
  - progress notifications appear before the final result and the runtime must remain stable
- Inconsistent metadata:
  - malformed or type-inconsistent symbol payloads must fail open without poisoning the session
- Method-specific disconnect:
  - a provider disconnect during `documentSymbol` or `hover` must degrade that request without corrupting the pool
- Quarantine transition:
  - repeated timeouts, malformed protocol payloads, or startup failures must surface in lifecycle health and move the provider into the appropriate recovery state
