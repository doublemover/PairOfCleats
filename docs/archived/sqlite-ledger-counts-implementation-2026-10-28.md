# SQLite ledger count/capability admission — 2026-10-28

Source `26aba2371ff227384caa579602fe4899b612b0a1`, tree
`24c0bfc216803b835c45a869721e8cf291ae1ce0`, branch
`codex/pr557-audit-repairs-20261012`. Local, unpublished and functionally unqualified.

#284's current source still normalized missing/nonfinite/negative counts to zero,
floored fractions, skipped dense equality for expected zero and ignored ANN zero.
The internal ledger now uses version 2 with explicit unavailable counts and exact
zero/positive dense checks before and after import. Invalid/unknown producer or
probe evidence fails with the actual pre/post input class. Original pending
bundle/snapshot work cannot become a structured successful count result.

Actual post-import counts now share one required read-only native connection and
transaction, including ANN presence. Required query/extension errors propagate
after original native closure instead of falling back to null. The existing
probe owner still supports explicit optional diagnostic fallback. Actual full
build and successful incremental-update paths use the same post-import ledger
before readiness reporting; grouped output counts are required too. Artifact/
bundle producers expose their actual ANN readiness, so disabled, unavailable and
ready states remain distinct. Ready missing/empty tables fail; present admitted
tables compare exactly, including zero. Existing trusted extension admission is
reused for actual ANN reads. Optional sqlite-vec execution remains separate.

Thirty-two new `storage/sqlite/build/row-ledger-count-evidence/*` controls cover
nine invalid count forms before/after import, exact-zero extras, ready empty/
absent ANN, disabled/optional absence, unavailable file count, original pending
snapshot and six real SQLite cases: measured zero, positive rows, required query
failure, required absent ANN, empty ANN with dense rows and one owned transaction.
Existing row-ledger assertions remain unchanged. **All controls and affected
full/incremental/bundle/native fixtures are unexecuted.**

Format/ESLint, six JavaScript syntax checks, static inventory and whitespace
checks passed; shared-module analysis found zero cycles. No native operation,
functional fixture, child or publication gate ran. Dependency inputs are unchanged.

#284 moves from unresolved to partial source implementation. Counts do not prove
row identity: expected file/hash/range, chunk-to-dense/ANN correspondence, bounded
missing/extra/duplicate/misbound samples and generation-qualified replay remain.
Successful count results explicitly report identity coverage unqualified and
file counts observed-only. No issue closes or native/correctness/performance
acceptance is claimed. Current source classification: **482 qualification
pending / 145 partial / 91 unresolved** across the same 718 live open issues.
