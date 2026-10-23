# Architecture rule admission and outcomes

Architecture rule input version 1 has a canonical schema and normalizer in
`src/contracts/architecture-rules.js`. Both file parsing and direct report
building admit the same rule variants before compilation/cache lookup:
`forbiddenImport`, `forbiddenCall`, and nonempty `layering`. IDs normalize by
trimming; duplicate normalized IDs retain `ERR_ARCHITECTURE_DUPLICATE_RULE_ID`.
Other invalid input uses `ERR_ARCHITECTURE_RULE_INPUT` with rule ID/index and
the exact property path. Unknown types, missing fields, malformed selectors,
unknown properties and invalid/duplicate layers cannot be silently skipped.

Selectors are objects with optional `anyOf` and `noneOf` arrays of nonempty glob
strings. Omitted selectors, `{}`, and explicitly empty arrays retain intentional
match-all behavior; malformed values cannot coerce into that behavior. Layer
names are unique after trimming. Admitted rules are immutable snapshots, so the
existing compilation cache keys normalized policy content. Glob compilation
errors retain the responsible rule/selector path and original cause.

Compilation now produces one compiled rule per admitted input. The removed
skip/warn branches were private to that compiler and all callers now pass this
admission boundary; unsupported work throws before reaching them. Input validity
does not qualify graph coverage. Existing upstream unknown-coverage warnings,
edge-work bounds, detected/retained violation counts and zero-detail behavior
remain independent. Empty policies remain permitted.

JSON input rejection emits a versioned diagnostic on stdout:
`{ "version": "1.0.0", "error": { "code", "message", "ruleId", "ruleIndex", "propertyPath" } }`.
It has no analyzed evaluation summary and exits 1. Human entrypoints retain one
actionable stderr message. JSON/JSONC/YAML loading errors remain ordinary errors,
with no fabricated analyzed report.

Analyzed success and policy failures share `report-outcome.js`: validate the
attached report, write any explicitly requested artifact through its existing
atomic writer, and emit the requested report once. Policy failures then retain
their original exception/exit status. Architecture violations exit 2;
incomplete evaluations retain exit 1. Stdout stays parseable JSON for JSON
requests; the concise failure summary remains on stderr. Load/schema/internal
or artifact-write failures cannot masquerade as completed policy findings.
Successful report format/version and public options remain unchanged.

Authored, unrun checks cover schema/parser/direct-builder rejection, mixed
supported/unsupported rules, YAML and JSON CLI diagnostics, explicit empty/no-match
controls, known forbidden edges, cache mutation and existing zero-detail/work
bounds. The old positive completion fixture now explicitly owns its small closed
graph topology; its original missing-upstream-receipt input remains a negative.
No production upstream coverage owner or completion criterion was relaxed.
