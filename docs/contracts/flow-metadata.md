# Flow field presence and qualification

Missing flow analysis is different from an analysis which produced an empty
result. Internally, default doc metadata leaves absent/null flow facts absent.
Explicit `false` and empty arrays remain values. The enrichment merge is the
shared admission owner for `dataflow`, `controlFlow`, `throws`, `awaits`, `yields`
and `returnsValue`.

The version 1 `flowEvidence` envelope binds the exact UTF-16LE JavaScript source
hash, source length, chunk range, declared owner, language and optional generation
to individual field values. It retains producer/version, analysis scope, fact
kind, authority and bounded reasons. Field states are `unknown`, `disabled`,
`unavailable`, `partial`, `produced-empty`, `produced-positive` or `conflict`.
Unknown source stays null. These identities detect accidental rebinding, not
authenticity or source admission on their own.

The merge owns its output, including mutable flow values; adapters can share or
freeze their input. It does not reanalyze source. Different source, range, owner,
language or generation receipts are rejected. Comparable field kinds/scopes use
semantic, syntax, then legacy authority. A verified negative does not lose to an
unqualified positive. Different scopes or fact kinds are incomparable. Equal
authority disagreement retains the original value, marks conflict and records
bounded diagnostics, without unioning contradictory values. Lower authority is
ignored explicitly. Disabled analysis removes the ordinary flow field and
records `disabled`; it cannot become an all-zero successful analysis.

Plain legacy producer values remain partial, source-bound observations at the
current invocation when source is available. Presence alone does not establish
parser authority or a verified negative. The old special false-to-true override
has no independent precedence.

Managed adapters consume compact products copied during the existing native
declaration/call traversal. Dart, Scala, Groovy, Julia and R can provide a partial
subset of recognized control/effect node roles within an admitted callable body.
The shared declaration owner and body extent exclude signature evaluation,
unowned nested callables and other declarations. Comments/string contents cannot
produce effect nodes. Native traversal/recovery/body limitations remain explicit.
Control counts are syntactic counts; effect fields are syntactic observations.
Semantic reads/writes/mutations/aliases are unavailable in this producer.

No raw chunk regex fallback has semantic flow authority. Templates and routes
without a qualified flow owner retain unavailable per-field coverage, including
literal-only output. Their existing template lookup/section syntax, native call
products and complete searchable source are preserved separately. This is not a
claim of unsupported whole-language analysis or a template execution model.

Both final docmeta and metadata v2 carry the envelope and retained fields.
Metadata validation checks value hashes, identity and range agreement. Chunk
serialization and incremental bundles preserve the receipt. Shared
`flowMetadata` and native flow-product versions fence ordinary/semantic parse
reuse and native chunk caches. Parser trees/handles are not retained or cloned;
source hashing is shared through the existing invocation context. No performance
speedup is claimed without equal-evidence measurement.

Regression owners are `flow-field-authority.test.js` under
`tests/indexing/file-processor/` and `managed-flow-source-ownership.test.js` under
`tests/lang/contracts/`. The shared heuristic adapter contract rejects fabricated
numeric summaries from ownerless slices. The durable implementation receipt
records functional execution separately from authored coverage.
