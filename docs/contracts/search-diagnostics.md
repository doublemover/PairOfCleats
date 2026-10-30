# Recorded search diagnostics

The retrieval output owner publishes `retrieval.diagnostics` in ordinary and
compact JSON. `schemaVersion: 1` projects the existing backend-selection,
fidelity, empty-result explanation and per-mode generation metadata. The strict
shape is `src/contracts/schemas/search-diagnostics.js`; the TUI operator validates
its projection before returning it as `searchDiagnostics`.

`backend.selected` records the actual backend. `backend.requested` records the
request, and `backend.fidelity` describes retrieval fallback, not completeness of
semantic analysis. Reasons come from the existing empty-result explanation owner.
The projection does not diagnose staleness from empty results. Per-mode generation
keys, build IDs and signatures are recorded provenance; they do not verify the
current worktree. Active build-root paths and unrelated payload fields are omitted.
Missing older metadata/history is `unknown`, never an invented healthy state.

The projection admits at most eight reasons, four mode identities, two trusted
action IDs and 24 detail lines. Reason codes are limited to 64 characters,
messages/next steps to 512, backend labels to 128, identity/reason fields to 256,
and summary/detail lines to 768. Control and bidirectional override characters
are removed from display values. The `truncated` flag records admission loss.
These are retained presentation bounds, not a process memory or latency claim.

VS Code stores this bounded projection with each result set for CLI and API
searches, including explicit reruns. Reopen preserves the stored result identity
and facts without dispatching a query; rerun creates fresh evidence. Output shows
the recorded facts, empty-result notifications carry the producer reason, and
nonempty fallback results are visibly labelled. Suggested actions resolve only
to the locally registered read-only Index Health and Tooling Doctor commands and
require the user's deliberate selection. Response-provided command strings are
never executed.

The native TUI shows the actual-backend summary and empty-result reason. `d` opens
the diagnostic details; Up/Down and Page keys scroll, Left/Right pan, Home resets
and Esc returns to the same selected result. Viewing or navigating those details
does not run a command. Index Health and Tooling Doctor remain deliberate catalog
workflows under the supervisor's normal authority. Replacing the query/scope
clears its old result facts, and continuation retains the existing result identity
and stale-response fencing. Query data remains outside saved layout snapshots.

This source contract and its regression controls are unqualified until the
deferred Windows editor/supervisor/native checks run. No new public configuration
option, automatic rebuild, provider installation or filter relaxation is added.
