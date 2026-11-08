# SQLite compaction identity and shared-mode preservation — 2026-10-28

Source `bc1e38284608b1c015c892cdf4893cdd42aa8e5e`, tree
`7189df462255aa34a0d1aeba9c2d2a523759ba85`, branch
`codex/pr557-audit-repairs-20261012`. Local/unpublished, functionally unqualified.

Compaction intentionally reassigns IDs in file/start/old-ID order and normalizes
file paths. Reusing the earlier artifact digest would reject valid compaction.
The actual compactor now independently streams original source identities in
that existing order, allowing only sequential reassignment and its existing path
normalizer. Covered UID/mode/file/range/line/metadata fields remain exact. The
actual output must match after VACUUM and pass native file/dense/admitted-ANN
relations before its original database is replaced.

The real build runner obtains the witness from the original completion object's
private producer association, repeats its post-compaction ledger check before
final replacement and preserves the earlier artifact check/witness separately.
Copied JSON, another completion or an absent witness cannot qualify the receipt.
Public result JSON remains `{skipped:false}`; existing exact result assertions
remain intact. Source/chunk checks do not yet cover every payload/vector field,
source file hash, bundle/incremental source or final-path publication identity.

Source inspection also found a data-loss defect: shared-mode rejection depended
on a semantic-generation marker. Without that marker, a mode-only rewrite could
replace the file and discard another mode. The guard now checks known mode-bearing
tables independently of semantic metadata, including empty file-manifest modes
and NULL/unknown modes, before rewriting anything. It preserves unsupported shared
compaction rather than pretending to retain rows the implementation does not copy.

The common digest cursor also keeps original successful step observations through
projection and hashing. Late revocation blocks the next native step and retains
original cleanup ownership. Normal native rows add no per-row observation history;
resource-bearing observations have a bounded fail-closed history.

Sixteen tiny actual SQLite controls cover planned ID reassignment plus real vector
mapping, copied-result refusal, corrupted UID/file/range/metadata copies,
post-VACUUM mutation, missing file/orphan dense rows, exact source-query failure,
invalid source IDs, nonsemantic shared chunk/empty-manifest/NULL/doc-length modes,
and missing normalization ownership. Failures assert byte-identical original files
and retired owned staging. One additional inert cursor control proves late
revocation precedes another step and retains the original return owner. **All 17
controls and existing compaction/build/ledger tests are unexecuted.**

Format/ESLint, six changed JavaScript syntax checks, static inventory and whitespace
checks passed; shared-module analysis found zero cycles. No functional fixture,
native operation, child, debugger or benchmark ran. Dependencies/setup inputs and
semantic output versions are unchanged; this batch strengthens validation without
changing produced meaning.

#284 remains partial. Complete original file/hash and bundle/incremental identity,
payload/vector values/validity, final publication/generation replay and original/
follow-up correctness/resource/performance acceptance remain. The 718-open source
inventory remains 482 pending / 146 partial / 90 unresolved.
