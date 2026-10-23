# Semantic request capture

Status: UNVALIDATED source implementation and authored regression.

The public detail, find and trace runners capture their request before validation,
repository/config resolution, generation lookup or store callbacks. Their direct
services use the same capture before reading store scope or entering an external
read scope. Generation, refs, selectors, slots, type queries, fields, includes,
limits and cursor values therefore describe one submitted request across awaits.
Caller mutations cannot replace a generation after admission, change the operation
being performed, append unvalidated type queries or change the cursor's request.

`src/semantic/request-snapshot.js` copies only schema-declared JSON containers and
freezes them bottom up. The existing canonical validators still validate required
fields, alternatives and scalar values. Copy admission uses each existing array's
`maxItems`, or its unique enum cardinality, before allocating the owned array. It
does not encode the entire request, clone immutable strings, add a public knob or
introduce an arbitrary input-byte limit. Accessors, cycles, sparse/decorated arrays,
symbols, unknown enumerable fields and nonplain objects fail before callbacks.
An own optional data property set to `undefined` is omitted, preserving existing
Ajv programmatic admission; required fields, array items and unknown fields do not
gain that exception. CLI page loops already initialize their explicit cursor to
`null`. Canonical find request and range errors now carry the same existing
`ERR_SEMANTIC_QUERY_CONTRACT` as capture failures, so the shared transport reports
both as a bad request. Invalid find results retain their internal failure behavior.
Reflection failures propagate unchanged, including private resource observations.

A private weak map recognizes only a capture made with the same schema in this
process, allowing a runner and service to share the owned immutable request. This
recognition grants no file, lease, resource-settlement or semantic-source authority.
Relative repository normalization recaptures the new root envelope before awaits.
Response generation containers no longer alias the mutable caller request.

The regression authors actual retained-row writer/reader paths, direct services,
public store-opening callbacks and a registered symbolic graph queried through the
actual type store. It also covers continuation identity, array boundaries and exact
reflection failure propagation. These controls have not been executed. Provider,
native, editor, full-index and runtime qualification remain open. Existing text
fields without length bounds and arbitrary JavaScript proxy/reflection work are
not total input-memory bounds; this change bounds copied containers according to
the current request schemas. Store metadata and other callback inputs have their
existing ownership contracts and are not captured by this helper. Successful
semantic producer, artifact, schema and cursor format identities are unchanged.
