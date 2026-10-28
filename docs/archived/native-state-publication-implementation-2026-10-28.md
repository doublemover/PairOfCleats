# Required native state publication — 2026-10-28

Source `a87beee17374ebfc8d22f415dd455590daf89443`, tree
`dabd97224f6689bc49573b1ec11359b2210c37ea`, branch
`codex/pr557-audit-repairs-20261012`. Unpublished; functional qualification pending.

Owner inspection found required SQLite/LMDB state writes and shared manifest
refresh swallowing original failures. LMDB could return an in-memory ready
object after failed disk publication. Malformed existing state could be replaced
by empty metadata. Its optional metrics catch could also hide an unsettled
descriptor/publication owner.

Required state read/write and present-manifest parse/shape/checksum/write failures
now propagate. The original JSON/atomic-file writer remains the publication
owner; no alternate retry or force cleanup is introduced. LMDB's extracted
state helper is the production command's actual function. SQLite keeps its
existing state selection and patch contract. Healthy manifest refresh retains
unrelated pieces, extensions and byte/checksum accounting. Legacy absent
manifest/piece compatibility stays explicit. Optional LMDB metrics require the
original resource observation to settle before best-effort suppression.

Eleven independently selectable `storage/native-index-state-publication/*`
cases are authored and **not executed**. They exercise actual state/manifest
producers, frozen original pending failures at the writer boundary, malformed
source, byte/checksum failures and healthy preservation. Existing embedding
manifest, artifact/bundle/incremental, native command/reader/category and full
original/follow-up acceptance remain required.

Static format/ESLint, five changed JavaScript syntax checks, whitespace and
shared-module cycle analysis (zero) completed. No project functional fixture,
child fixture, native campaign, benchmark or publication front gate ran.
Dependency inputs remain the successful exact-budget bootstrap inputs.

This addresses a concrete publication/failure-ownership gap under #1267/#1574
and SQLite correctness follow-up #284. It does not qualify all row counts or
build modes, implement custom/external producer cleanup, or introduce an atomic
two-file transaction/concurrent state-writer protocol. Those owner requirements
remain active. No issue closes or changes its overall classification here.

Compaction follow-up source `f92c53623fe170b7eeba025bb1c20b86832ff573`, tree
`f974d380d1cf05070f870bdc49bd7f2985738451`, removes the analogous failed-query-to-zero
path. Both `chunks` and `dense_vectors` are required by the authoritative SQLite
schema. Failed table metadata/count operations and invalid negative/unsafe counts
now fail through the original command owner. Zero requires an actual successful
query. Eight actual native fixtures are authored, unexecuted: metadata failure,
ordinary/pending query failure, invalid count, missing required chunk/dense table,
real empty dense data and nonempty dense preservation. They retain unchanged
pre-staging source bytes and once-only original close/metadata recovery controls.
Format/ESLint, two changed JavaScript syntax checks and whitespace passed. No
functional or native execution occurred. Nineteen state/compaction controls are
now authored; full row-ledger/build-mode and owner qualification still remain.
