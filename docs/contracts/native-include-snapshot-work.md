# Native include snapshot work

Sealed C authority parses each retained source once per inventory/verification
operation. Immutable directive summaries bind the source SHA-256, literal spelling,
quoted/angle form and preprocessed UTF-16 occurrence offsets. These offsets describe
the continuation/comment-normalized text, not original physical source positions.
The original project file hashes remain the physical source authority. Existing
dynamic/trigraph/digraph, macro include, unsupported directive/extension, escaping
path and linked-object rejections remain; mismatched include delimiters also fail.

Compilation-entry projection deduplicates `-I` roots in first-occurrence argv
order. Quoted includes search the source directory first. Snapshot-local search
contexts include source directory, ordered roots, literal form and ordered admitted
`-D`/standard flags. Each entry prepares those roots once; source-directory/form
contexts are reused without repeatedly serializing full root lists per include.
Different flags or root order cannot inherit another context's resolved result.
No compiler command is executed to build this inventory.

One operation-local candidate table retains every earlier absent candidate and
the first present candidate per context. It memoizes ordinary-file observations
only within this operation, then reobserves every unique witness before granting
completeness. Changed existence/type/device/inode/size/modification/change identity
fails conservatively. Containment checks surround asynchronous lstat; unsupported
objects and unscanned present files cannot enter the closure. A new inventory call
observes filesystem state afresh. Source path sets, entry roots and argv are
captured before asynchronous probing, so caller mutation cannot rewrite that
operation's selected context.

Existing limits remain 64 entries, 512 source/project files, 1 MiB per source,
16 MiB source/project bytes and 4,096 unique probes. Separate internal work bounds
admit 4,096 preprocessing directives, 4,096 distinct literal resolutions and at
most 64 × 4,096 expanded resolution requests. Context preparation admits 16 MiB
of serialized key work; retained context keys and probe metadata each admit 8 MiB.
These are conservative completeness frontiers, with explicit exhausted reasons;
they do not raise public/native authority caps. Metadata byte accounting does not
claim absolute JavaScript heap/RSS bounds. No process-global probe cache survives.

The work receipt separates source parse calls/bytes/code units, directives,
resolution requests/search contexts/reuse, context preparation/retention bytes,
unique candidate observations/reuse, actual asynchronous lstat calls, containment
checks, final verification probes and retained rows/serialized bytes. Source-byte
counts represent one lexical preparation per source, including fixed preprocessing,
regex and hash passes; they are not a count of engine character comparisons.
Failures retain incomplete phase/budget evidence and original resource settlement;
pending observations cannot be reclassified as ordinary absent files.

The complete deterministic receipt joins the native inventory identity, with the
shared `lspBindings` producer version bumped for ordered include semantics and
bounded completeness. Linux ELF/toolchain qualification remains unchanged and
separate from portable Windows source/search controls. The authored regression
covers exact positive/negative order, the two `-Iz -Ia` counterexamples through
actual argv projection, duplicate expansion beyond 4,096 occurrences, unchanged
lexical work at 1/4/16 entries, true broad-probe/context limits, construction changes,
simulated linked metadata, cancellation and original pending failure callbacks.
No symlink or compiler is created/run by those controls; an inert file used only
for executable-locator projection does not qualify a toolchain. Execution and
representative timing/CPU/heap qualification remain deferred.
