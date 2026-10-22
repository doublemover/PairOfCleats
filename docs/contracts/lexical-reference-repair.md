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
