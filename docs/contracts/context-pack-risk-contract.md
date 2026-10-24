# Context-Pack Risk Contract

The `risk` section inside `CompositeContextPack` is a public machine-facing contract.

Risk summaries retain local analysis admission/completion, effective caps and
summary reduction counts as `inputCoverage`. Interprocedural stats aggregate this
evidence independently of execution success. A completed traversal with zero flows
can still have partial or unknown upstream coverage. Strict packs reject those
claims, including summary row drops and legacy inputs without coverage evidence.
Coverage is scoped to all admitted input chunks; completeness for a narrower
requested slice remains unknown unless separately established. Piece assembly
retains input evidence and cannot turn independent partial analyses into a
complete cross-piece result.

## Current contract

- `risk.version`: `1`
- `risk.contractVersion`: `1.0.0`
- Accepted `risk.provenance.artifactSurfaceVersion`: `0.0.2`

## Compatibility rules

- Readers and validators must fail closed when `risk.contractVersion` is missing or does not exactly equal `1.0.0`.
- Readers and validators must fail closed when `risk.version !== 1`.
- Readers and validators must fail closed when `risk.provenance.artifactSurfaceVersion` is present and outside the accepted set.
- There is no dual-read or compatibility shim path for incompatible risk payloads.

## Hard cutover

- Any incompatible change to the public `risk` payload requires:
  - a new `risk.contractVersion`
  - schema and validator updates in the same change
  - fixture and compatibility-gate test updates in the same change
  - removal of superseded compatibility paths in the same change set

## Validation surfaces

- `src/contracts/schemas/analysis.js`
- `src/contracts/validators/analysis.js`
- `tests/context-pack/public-risk-contract.test.js`

Complete-response budgeting keeps an exact request-local pretty-JSON byte count
until a section or evidence/warning field changes. Absent and protected optional
sections reuse that count. Omission order, strict required evidence and the byte
limit remain unchanged. Risk edge callsite samples are memoized only within one
propagation run by caller, callee, file and sampling cap; taint and witness state
remain specific to each traversal state.

Within one risk propagation run, sink/callee order and immutable edge parameter and
framework-rule matches are prepared lazily. Edge preparation has an 8 MiB accounted
cache budget and falls back to recomputation when full. Tainted arguments, semantic
transitions, confidence, watch steps and witness admission remain state-specific.

Source excerpt ranges use half-open UTF-16 code-unit coordinates, matching indexed
JavaScript string spans. They are sliced from the same verified, strictly decoded
UTF-8 source snapshot before applying UTF-8 byte limits. Fractional, out-of-bounds,
split-surrogate and malformed-encoding spans cannot claim strict source fidelity.
Primary, call-site and prefetch consumers share this mapping. Source retention
accounts for both original bytes and the decoded string.

JSON context output budgets the final pretty-printed public envelope, including
derived SARIF/risk companions and the stdout newline. Rendering preserves strict
risk/evidence policy and the native caller payload; mandatory overflow returns
ERR_CONTEXT_PACK_RESPONSE_BUDGET. Risk path/frontier IDs become hydration
dependencies only after their candidate passes its byte/token admission.

Semantic-find measures its complete final envelope even for zero matches,
range-filtered candidates and unavailable analysis coverage. An oversized result
returns ERR_SEMANTIC_OUTPUT_LIMIT before publishing a continuation or evicting an
existing continuation. These are authored repairs awaiting Windows qualification.

Standalone risk explain retains per-artifact presence/load state and typed,
path-free warnings. Disabled or summary-only analysis stays distinct from valid
empty analysis, while missing required, malformed or unhydrated call-site
evidence marks analysis unavailable/incomplete. CLI, API and MCP receive that
same native status. Markdown always renders the status-bearing presentation.

Selection metadata records the filtered matching population before query caps.
JSON, Markdown and SARIF compose that population with any smaller presentation
cap, preserving total/shown/omitted counts without hydrating omitted flows.
Single-format consumers construct only the requested representation. Intentional
dual output shares its invocation-owned narrative projection; Markdown never
constructs discarded SARIF. These repairs have authored controls but no new
execution or performance qualification yet.
