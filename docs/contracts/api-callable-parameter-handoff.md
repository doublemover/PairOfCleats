# API callable parameter handoff

API contract report version 1.1.0 adds `signature.parameters`, a version-1 arity
summary with explicit language, producer, source, presence/coverage reason,
original counts, declaration/signature ranges, and qualified arity bounds.
Readers still accept legacy report/artifact rows without this field; new 1.1.0
reports require it on every entry. The field has a canonical schema and semantic
count/range validation. Existing target/generation and warning-cap checks remain.

The symbols writer projects the compact summary from admitted compiler/Babel
callable nodes. Full slots/annotations remain in source-owned doc metadata;
neither a huge duplicate type store nor another AST is serialized into symbols.
The summary survives optional display-field trimming. It remains valid when
display signature, name or language text is cleared. Contradictory counts,
incompatible published languages or a legacy-display claim masquerading as
parser-node symbol authority are rejected. RecordsProducer advances 3 to 4 so
derived publication cannot reuse the old symbol meaning.

The API consumer uses that admitted summary directly. A present unavailable or
invalid summary cannot fall back to reparsing display text. Legacy rows without
the summary use a bounded JS/TS declaration subset, qualified as partial legacy
evidence. It distinguishes TypeScript `this` receivers and function-type arrows
from optional/default/rest syntax; required trailing runtime positions determine
minimum arity. Unsupported languages, decorators, truncated/unbalanced input,
oversized text and unsupported syntax remain unavailable. The bounded cache
keys language, schema policy and text, separately from node authority. This
fallback does not qualify full language/runtime conformance.

Unavailable formal authority on an observed call yields
`CALLABLE_PARAMETER_AUTHORITY_UNAVAILABLE`, rather than a definite argument-count
match or mismatch. The original warning cap/fail-on-warning policy applies.
Qualified metadata preserves required callbacks and excludes non-runtime
receivers, consistent with the
[TypeScript function specification](https://www.typescriptlang.org/docs/handbook/2/functions.html).
No parser/backend is disabled to accept production output, and no current
worktree source is reopened to replace retained evidence.

Authored, unrun tests exercise compiler/Babel source → canonical chunk/symbol
writers → cold JSONL reload → actual call-site writer → report, independent TS
argument-count diagnostics, actual row trimming, impossible-count/language
negatives, legacy cache qualification and actual-index CLI policy/clean cases.
The pre-existing optional/rest fixture now declares TypeScript for its `c?`
syntax; its original values and success assertions remain. #1678's actual-argument
preview/position, native missing-operand, type/risk and timer-spread consumers
remain pending; formal handoff alone does not close them. No runtime acceptance
or performance qualification is claimed by this source batch.
