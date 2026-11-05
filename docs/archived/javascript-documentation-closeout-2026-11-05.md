# JavaScript documentation closeout — November 5, 2026

#668's parser-owned JSDoc implementation now passes its complete authored
acceptance. This batch closes its execution and CI-selection gap; the production
adapter already exists at parent `5e2a1a9a86e36c9124bcfdada4f6e6d13aec5cb3`.
No new parser dependency, semantic behavior or public configuration is introduced.

The [contract](../contracts/javascript-documentation.md) documents the selected
`jsdoc` dialect, original type-text preservation, bounded admission and separate
syntax/documentation authority. The source parser supplies privately captured
comment ranges; strings, templates, unrelated comments and later public-AST
tampering cannot invent tags. Prepared declaration metadata parses each admitted
block once. Standalone callers use the same parser under explicit work bounds.
JavaScript relation producer version2 already invalidates prior replay meaning.

The [machine receipt](javascript-documentation-closeout-2026-11-05.json) retains
candidate source digests, complete focused reports and publication checks.
**21 documentation cases and two declaration/replay cases pass**: all three
original reported defects; optional/default/rest/dotted names; nested record,
generic, union and return types; leading comments outside chunks; malformed,
empty and unavailable distinctions; byte/type-depth bounds; Babel/Acorn/Esprima;
actual registered chunk-to-metadata assembly; explicit AST precedence, including
empty arrays; embedded offsets, prototype-like names and comment tampering.
The existing JavaScript contract matrix passed in the adjacent dependency batch.

The existing shared-module performance/budget fixture also passes with unchanged
thresholds. This is a budget qualification, not a claimed latency improvement.
Every focused fixture used one job, a 30-second deadline, zero retries and
native-status redo disabled; no failure, timeout or skip remains in those runs.
The 21 previously unselected documentation cases now have explicit ordered
ci-lite membership; their two declaration/replay controls already had owners.

All eight publication checks pass, including43 gate fixtures. The final lane
inventory contains2062 ci-lite /239 ci /43 gate /23 ci-long /11 conformance,
2378 total, with no missing IDs, duplicates or manifest mismatches. Hosted
execution of the new membership remains tied to its eventual CI source rather
than an earlier green run. Local `.tmp`/`.testLogs` paths are historical
author-workspace provenance; the compact reports are embedded in the receipt.
