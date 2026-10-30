# Parser-owned classification leaves

The first production slice of #1233 reuses native leaf spans only when a chunk
covers its parser owner's entire exact input. The input must be a clean native
parse, fit 24 KiB, and yield at most 4096 leaves, 32768 traversal steps and 128 KiB
of encoded immutable product. A smaller configured traversal allowance still
applies. Unsupported or exhausted capture leaves ordinary chunks available.

The chunk owner emits JSON `[start,end,type]` leaves with UTF-16 coordinates,
whole-input context, input length/UTF-8 bytes/exact UTF-16 hash, product version
and payload hash. No parser, grammar, tree, node or function is serialized.
Existing segment rebasing and scheduler JSON/binary result owners carry this
data. Public assembled chunk payloads do not include the internal product.

Reuse requires the current loaded parser and selected grammar identity: runtime,
language, export, installed native binding, wrapper/dependency source and grammar
metadata. Artifact fingerprinting is lazy and bounded to 128 files/64 MiB with a
64 KiB read buffer; unavailable identities retain standalone parsing. Shared
native-loader history does not add unrelated grammar binaries to that identity.
Metadata and artifact reads borrow the existing core descriptor owner with
original read/stat/close methods. A privately recognized unsettled descriptor
failure propagates through product attachment and chunking fallback; the existing
native identity state retains it for later calls. Failed synchronous numeric
close is never retried, and an unavailable identity cannot hide pending closure.
The Piscina `parseTreeSitter` entrypoint fixes optional capture off: its error
serialization cannot preserve the worker's private descriptor authority. That
route retains ordinary native chunks and standalone classification. The existing
scheduler executor and its JSON/binary product handoff remain eligible; no
serialized session is accepted as local settlement authority.
Installed artifacts are assumed immutable during the already loaded native
session. This is installed artifact identity and ordinary trusted scheduler/cache
provenance, not native-code attestation or an independent proof of arbitrary
caller-forged leaves.

Classification captures a bounded private copy before dictionary callbacks,
checks the complete input and native identity, then uses the existing leaf bucket
rules. It rebuilds every leaf's tokens under the current dictionary, extension
and normalization policy. No normalized token/result cache is shared. Successful
reuse consumes the same classification byte/chunk allowances as standalone
classification and cannot bypass disabled languages, file/chunk caps or exhausted
budgets. Existing standalone parsing remains the fallback on every mismatch.

Narrower/overlapping chunk contexts, parser recovery, transformed comment text,
different source/grammar/runtime/coordinates and incomplete products have no
equivalence claim here. Whole embedded segments can reuse only their identical
parser input under the matching effective language; a containing file's grammar
cannot substitute for that segment. The additional bounded traversal, artifact
identity reads, serialized leaf bytes, consumer copying and dictionary work are
costs to measure alongside avoided parses. This is no measured speedup or
process-memory bound, and ordinary 32/96 narrower-chunk files retain standalone
classification until a stronger context-equivalence owner exists.

Authored controls follow the actual native chunk owner through JSON/segment
handoff, dictionary changes, source/binding tampering, Unicode, recovery,
construction/classification caps and cancellation. Actual scheduler plan/executor/
JSON-binary lookup controls consume the product through canonical tokenization.
Real descriptor close-fault controls cover metadata, binding, nonstandard close
returns, the no-retry rule and actual native chunk-owner propagation.
All are **UNVALIDATED**. No tests, syntax, lint, format, bootstrap, native/child/IPC,
compiler/source execution, full indexes or performance measurements were run.
