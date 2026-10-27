# LSP Operations

This document defines the operational surfaces for the LSP runtime, replay artifacts, and CI gates.

## Clangd compilation context

Clangd admits a compilation database as bounded, read-only data. Missing,
wrong-kind, unreadable, malformed, over-budget, empty, partially valid and usable
inputs have separate diagnostics. An invalid selected database blocks native
dispatch; it cannot silently select another ambient database. Explicit
`compileCommandsDir` and command-line database flags must agree. Custom launch
arguments retain the admitted database selection.

Admission reads at most 8 MiB and 16,384 command entries. Direct response-file
dependencies are contained and bounded to 64 files, 1 MiB per file and 4 MiB in
total. Nested/opaque response expansion stays unknown. No recorded command,
compiler or build is executed by admission. Source/directory checks admit at
most 2,048 physical paths; a reached bound is diagnostic and cannot promote
remaining documents to exact context.

Each requested document records exact, ambiguous, fallback or unknown command
coverage. Identical entries deduplicate; different variants remain ambiguous.
Embedded documents cannot acquire exact context from their container's command.
`requireCompilationDatabase` requires one or more exact selected documents,
rather than a filesystem entry named `compile_commands.json`. Doctor distinguishes
database command entries from the selected-document coverage checked at launch.

The existing weak-context document cap applies only to weak documents; exact
documents remain eligible before the ordinary runtime/path budgets. Hover is
enabled for exact context and disabled for weak context unless the existing
`disableHoverWithoutCompileCommands=false` override allows it. The weak per-file
hover cap remains eight unless explicitly configured, with the runtime budget
still taking precedence. Include-root inference remains explicitly inferred.

Preflight captures the database/response hashes, physical source identities,
document map and launch/configuration binding. Run revalidates those bytes and
identities before planning and dispatch; changes require a new plan. Exact
commands use admitted physical source URIs with LSP text overlays, without
rewriting source files; weak/embedded documents retain their VFS route. Request
cache identity includes admitted context, and unknown/ambiguous context receives
an invocation-specific identity. The LSP semantic producer version changes with
this meaning.

`clangd_compilation_context` reports database and per-document source coverage;
`clangd_compile_context_request_plan` reports actual provider selection and hover
policy. Neither is a server timeout or proof that a file has no symbols. Native
toolchain/SDK/variant closure and real timeout-storm qualification remain separate
from this application planner. This implementation's authored regression and
fixture-server checks await execution in the current development wave.

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

The configured `tooling.logDir/tooling.log` now retains timestamped `[tooling-diagnostic]` JSON records with concrete check messages, provider contract versions, preflight/fidelity summaries, and live request counters when available. Records identify live or cached evidence and declare truncation. Cached runtime counters are omitted, and cached check messages are retained without creating fresh request warnings. Operator output shows up to eight live warning/error checks per provider; a diagnostic-file write failure is reported once while valid provider output remains usable. These are bounded diagnostic excerpts, not complete stderr or per-chunk source dumps.

Language benchmarks select a per-checkout `tooling-logs` directory beside the prerequisite receipt by default, so diagnostic files survive cleanup of the isolated index cache. Results record the selected directory and whether it came from the benchmark default, configuration, or `PAIROFCLEATS_TOOLING_LOG_DIR`; explicit selections take precedence. Ordinary indexing keeps its existing empty log-directory default.

When an LSP regression appears:

1. Inspect the doctor gate payload and confirm whether the provider failure is availability, handshake, workspace, or bootstrap related.
2. Inspect the replay-gate JSON and trace artifact to determine whether the problem is protocol-level, request-lifecycle-related, or enrichment-merge-related.
3. Compare current SLO and guardrail payloads to the most recent accepted baseline.
4. If the provider is quarantined, inspect the runtime health counters and quarantine level before retrying.
5. Only re-enable a default-enabled provider after the doctor, replay, and SLO gates all return healthy results for that provider class.

## Failure Classes

SourceKit uses its existing 3.5-second hover/signature-help default when those settings are absent, null, or blank; inlay hints inherit the hover deadline. Explicit positive overrides still apply, subject to the shared client's one-second minimum. The provider logs the resolved request budgets so a timeout can be compared with the deadline actually selected. Package resolution and initialization readiness are separate from request success; a healthy preflight does not establish that every Swift semantic request will complete. Provider version 2.1.1 invalidates results cached under the earlier absent-value policy.

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
