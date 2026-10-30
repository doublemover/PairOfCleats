# Inert lexical rename proposal

Unvalidated first source slice of #1507, consuming the #1506 lexical pilot.
`proposeLexicalRename` accepts an explicit target declaration, original owned
semantic source snapshots, source spans, and a caller-admitted reference universe.
It generates source overlays in memory and never writes files or invokes tools.

Every supplied reference is resolved before and after the rename, including
untouched references and formerly failed lookups. A changed free binding refutes
preservation. An incomplete reference universe or resolution frontier returns
unknown. The changed declaration keeps an explicit proposal-local correspondence
within its unchanged lexical scope; overlay source identities are newly computed
by the canonical source snapshot owner. Proposal-local references are not
published canonical semantic facts for the new source.

Binding preservation applies only to the admitted closed lexical model and
supplied universe. Syntax validity, native validation and behavior preservation
remain separate, unestablished results. In particular, identifier-shaped text is
not proof of language-specific syntax validity. Closure receipt strings must be
admitted by the upstream owner before this internal API is exposed publicly.

Work/source bounds retain explicit unknown frontiers; the returned proposal is
inert even after a successful model check. Remaining work includes canonical
public schemas, real profile/closure admission, source-overlay native checking,
qualification/import/move synthesis, recursive/joint candidate search, resumable
search state, editor/CLI/API/MCP consumers and empirical qualification.
The authored regression source has not been executed.

The internal retained consumer `proposeRetainedCanonicalLexicalRename` now reads
one selected syntax partition through the canonical artifact store. It shares
`captureRetainedLexicalInputs` with the retained lookup consumer, including one
contained, verified source capture, dense record inventory, original-source
coordinates and pinned profile maps. Declaration and occurrence sites come from
those records. The current worktree cannot supply missing bytes or retarget a
proposal. Mapped sources, cross-partition lexical parents and escaped or otherwise
nonmatching source spellings remain unavailable to this restricted adapter.

An explicit occurrence annotation map supplies namespace/datum admission for
every captured reference, including untouched and formerly missing names.
Definition-only occurrences are counted separately and cannot duplicate the
declaration edit. Missing reference annotations keep preservation unknown;
captured syntax alone does not choose a language namespace or prove binding
closure. The planner checks every admitted occurrence before and after the
overlay, so capturing an untouched formerly failed lookup refutes preservation
in the declared model.

A complete reference-universe receipt must contain exactly `state`, `receiptId`,
`world`, `partitionId`, `inputInventoryHash`, `profileHash` and
`occurrenceAnnotationsHash`. Its world includes the captured source snapshot.
Inventory and profile hashes come from the shared capture projection; the
occurrence-profile hash uses the sorted canonical ref/annotation entries under
`semantic.retained-lexical-occurrence-profile.v1`. A missing or mismatched receipt
keeps the proposal partial. Matching these identities binds trusted upstream
admission to the actual input; it does not independently prove that a language
adapter has admitted a complete reference universe. A row prefix, including an
exact allowance, always leaves that obligation open.

The capture retains the existing row/source/metadata allowances. The planner
also bounds encoded before/after resolution evidence independently of source
and overlay bytes; evidence exhaustion returns an explicit unknown frontier,
never a sliced complete preservation claim. This bounds retained encoded
evidence, not all temporary allocations or process memory. Source snapshots pass
the shared own-data/full-manifest admission owner. Syntax reparse, native binding
validation, behavior preservation, applying edits, public workflows and durable
continuation remain unimplemented. Canonical writer/store/overlay regressions
are authored and unrun; this integration changes no persisted semantic producer.
