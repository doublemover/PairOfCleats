# Embedding state deltas and invocation conflicts — 2026-10-28

**UNVALIDATED source:** `5400c00b68ea8f038bd85286f61b9e8447f7d7a1`, tree
`58439d4a191050c1028c9840de9a77e1b660f483`, branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

Embedding callers loaded state early and later replaced the whole object. Native
writer serialization alone could not prevent those stale objects from discarding
new SQLite/LMDB namespaces. Terminal failure reporting also freshly loaded state
and could mark a newer attempt or generation failed.

The actual embedding state owner now joins the existing publication mutex and
merges only changed top-level fields and individual extension keys against the
original loaded baseline. Private hashes bind the actual object and path without
retaining another full state. Conflicting changes fail; identical intent can be
replayed to repair an independently failed manifest. Unchanged fields retain the
latest state, explicit deletion remains possible and prototype-named keys remain
ordinary data. Caller mutation during lock admission belongs to the next write.

The real runtime receipt owner returns an attempt-ID string. Initial publication
claims that exact reference by compare-and-set; subsequent writes require it.
Terminal reloads retain the original generation and invocation constraints while
loading fresh data. A new generation, replaced attempt, copied object or path
mismatch cannot authorize publication. Validation reads use the same mutex.
Initial claims retain the existing explicit restart/recovery behavior; this does
not establish exclusive ownership of an entire embedding execution or make the
state/manifest pair crash-atomic. Embedding-manifest and initial-generation
writer adoption remain source work, along with broader recovery/cleanup owners.

Nineteen `indexing/embeddings/state-publication-conflicts/*` controls are authored
and **unexecuted**. They use actual embedding/native producers and publication
locks, including competing claims, stale terminal reports, root identity changes,
queued data capture, repeated native updates and final manifest checksums.
Original publication-readiness fault/abort assertions remain, now initialized by
the actual loader. The terminal pending-read fault targets the actual synchronous
contained-file open. No missing/corrupt state is repaired by fixture weakening.

Format/ESLint, seven JavaScript syntax checks, whitespace and static module-cycle
analysis (zero cycles) passed. No functional fixture, child, native operation,
server or benchmark ran. #1267/#1574/#284 remain open with unchanged counts:
**480 qualification-pending, 145 partial, 93 unresolved** of 718 open issues.
Source is unpublished; functional qualification and the publication gate remain
deferred under the implementation-first instruction.
