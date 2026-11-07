# Strict JSON collector admission — 2026-10-27

Branch `codex/pr557-audit-repairs-20261012`; functional checks deferred.

| Source | Tree | Change |
| --- | --- | --- |
| `6dda561942e5a7472cb9e69d6eae68b6052f661f` | `3838a3717db7ee9f70487dda28406aeb3b30ae10` | Shared strict collector admission and aggregate cursor traversal |
| `1d72db1a7c70b5c4e4dcd97bf985d7d1cdfaa04d` | `8f6869904a94a345847552a1dace041d7d1c9582` | Deep JSONC compatibility failure remains a qualified depth omission |

Strict JSON previously ignored collector controls and independently traversed
every reference subtree plus the general graph. Whole-width enqueue/entries/value
arrays could exceed the visited-node bound before the next check. Strict `.json`,
`.resolved` and anonymous routes now use the common source/token/match/line/time
owner. Truncated grammar input cannot become a successful prefix parse. Strict
syntax and last-key-wins remain native JSON semantics; JSONC still owns its own
dialect. Native parse time is accounted before/after, never presented as a hard
interrupt. Cancellation and invalid syntax have separate extraction reasons.

One deterministic preorder cursor walk shares 20,000 admitted values and 20,000
active frames between general/reference traversal. Completed frames leave no
consumed backing queue. Reference keys restart the existing depth-three scope;
overlapping reference ancestors do not repeatedly walk a value. Token/match
admission precedes Set growth. Exact observed/retained counts and bounded limits/
reasons flow through the existing extraction and actual relation projection;
unknown total omissions remain unknown. Invalid references and budget stops
cannot become complete-looking empty success. Deep strict compatibility remains,
while valid deep JSONC-only syntax is not labelled malformed by the strict parser.

JSON reference policy 2 enters file parse identity; shared import-resolution
producer changes 20→21. Preorder truncation order is explicit/versioned. Existing
receipt layouts, public controls and parser dialects remain. See the
[contract](../contracts/json-import-admission.md) for bounds and zero-cap meanings.

Twenty `indexing/imports/json-collector-admission/*` cases are authored,
**unexecuted**. They cover route/cap precedence, strict/JSONC and deep compatibility,
source/line admission, last-key/prototype/depth semantics, small wide/frontier/
nested aggregate counters, fake-clock accounting, cancellation, invalid references
and actual config-to-relation receipt handoff. Existing JSONC boundary, extraction,
replay and import-budget checks remain required. Static format/ESLint, syntax,
config budget, inventory and whitespace checks pass; shared module analysis found
zero cycles. No measured work result, latency/resource or functional pass is
claimed. #1664 remains open for those checks and complete original acceptance.
