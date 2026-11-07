# SQLite dense schema failures and original cleanup — 2026-10-28

Source `aceea960a5376eddd610e928f0f0dfe5c0b06ea1`, tree
`a9e2fec4bd570c7fde200aeab7dc1187b1d90772`, branch
`codex/pr557-audit-repairs-20261012`. Local/unpublished, functionally unqualified.

The dense updater's table probe swallowed query failures as table absence. Its
dimension probes also swallowed errors and could use a different column's first
DDL width to justify dropping an existing ANN table. Query/projection errors now
propagate with original resource observations. Only an actual absent row means
missing; invalid catalog shapes/identifiers/dimensions fail. Width uses the selected
native column type or bounded anchored CREATE VIRTUAL TABLE producer DDL for that
leading column. Ordinary table defaults and other-column widths cannot supply
authority. Unknown width refuses destructive rebuilding. Required synchronous
pragma failure is no longer hidden by the updater's outer empty catch.

The existing synchronous API remains. The actual updater and row-materialization
helper compose the existing SQLite constructor-time close owner and contained
source sessions. Late method replacement cannot change cleanup. Original unknown
work prevents rollback or unsafe close; confirmed ordinary work permits independent
DB/source disposal. Falsey work, rollback and independent frozen close failures
remain together. Explicit original-resource reconciliation can close after work
settles and use the actual contained descriptor's close-only capability; it never
re-enters vector reconciliation, initialization or rollback. Unknown asynchronous
or arbitrary source-close returns cannot stand in for the synchronous contract.
The legacy helper remains exported; no caller/coverage removal was inferred.

This coordinates original resources rather than registering complete custom-root
writer/publication authority. #1574 remains partial; shared successful close-result
and callback observation still require the common owner's audit/qualification.
No native crash cause is attributed from source review or a JavaScript checkpoint.

Thirty-three controls are authored: native table present/absent/failure/pending/
invalid evidence; selected type/DDL/absent/other-column/fake-default/oversize SQL,
invalid dimensions/identifiers and exact/pending query failures; captured close,
pending/replaced original work, independent/dual close errors, rejected async or
unknown source evidence and failed close capture; plus eight actual SQLite paths
for table/required pragma failure, late method replacement, work-plus-close,
falsey work-plus-close, original/replaced pending work and constructor failure.
The native cases retain the original vector on failure and exact-owner cleanup.
**All 33 and affected original dense/isolate/ANN/artifact/stream tests are unrun.**

Format/ESLint, four changed JavaScript syntax checks, static inventory and whitespace
checks passed; shared-module analysis found zero cycles before the final anchored
DDL refinement, which adds no imports. Node/dependency/patch/setup inputs are
unchanged. No functional test, native operation, child, debugger or benchmark ran.

The user's new instruction fixes the next boundary at checkpoint 240: freeze
implementation there, run full Windows-applicable suite and required qualification,
repair genuine failures and close implemented issues only with sufficient current
evidence. Current source inventory remains 482 pending / 146 partial / 90 unresolved
across 718 open reports. Source work continues solo until that boundary.
