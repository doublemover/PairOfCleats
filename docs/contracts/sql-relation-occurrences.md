# SQL relation-name occurrences

SQL relation producer **2** projects declared node-sql-parser AST roles rather
than treating arbitrary properties named table as physical relations. Statement
relation heads, declarations, possible CTE references, derived bindings, opaque query-alias
observations and column qualifiers are distinct. Only relation-use occurrences
feed the conservative legacy usages display. CREATE table/view targets remain
declarations. Column qualifiers and aliases cannot manufacture tables.

The parser has already decoded identifier characters. The producer retains
ordered db/schema/table segments exactly, including brackets, backticks, literal
dots and significant edge spaces. A literal dotted name is one segment; a
qualified name has multiple segments. Display quotes non-simple segments and is
not a binding identity. Decoded-name IDs hash a typed dialect/segment sequence;
they identify parser observations, not catalog-equivalent identifiers. Lexical
quoting/case folding and catalog bindings remain explicitly unqualified when the
parser omitted them. No working-tree lookup or live database is introduced.

An occurrence ID binds exact UTF-16LE JS-string hash, dialect, statement scope,
AST path, role and decoded observation. AST source extents are retained when
available and otherwise null; no inferred token offset is invented. CTE lookup
is conservative across case and recursive/forward scope, with an explicit
reason. Derived/nested scopes retain their physical inner relation heads without
promoting their outer aliases to relations. Unsupported statement roles/shapes
and unavailable parser evidence remain qualified rather than a complete empty
inventory.

Artifact validation recomputes typed name/occurrence identities and display,
checks role cardinality, retained counts, unique IDs and source extent bounds.
The strict sqlRelationEvidence envelope persists through buildFileRelations,
file_relations JSON/shards and content-sensitive cross-file cache identity. It is
stripped from per-chunk codeRelations to avoid replication. Recognition separates
recognized empty/nonempty, unavailable extraction and partial empty. Coverage
remains partial for the declared AST subset, catalog binding is not attempted,
and unknown omitted occurrences stay null. Reasons have at most 16 keys. Supported
relation heads are SELECT/FROM, DML targets, CREATE TABLE/VIEW declarations and
CREATE INDEX/ALTER TABLE table inputs. Other statement roles remain explicit
unknowns. Source admission is 512 Ki UTF-16 code units, AST/work queues 32,768 nodes, depth 128,
roots/occurrences 4,096, decoded segments/aliases 1,024 code units and retained
occurrences 512 KiB. Oversized sources retain unavailable qualification without
claiming an admitted text hash. These are internal bounds, not public knobs.

Shared sqlRelations version and actual parser availability/version participate
in ordinary parse and semantic runtime dependencies. Historical cached bare
arrays need normal refresh; source and extraction policy are not inferred from
an empty usages list. Generic import/extraction summaries and graph propagation
under #1662 still need their shared first-handoff coverage repair; this SQL
receipt alone does not qualify that wider pipeline. #1719 therefore retains that
integration remainder explicitly. Full catalog binding remains with #1188.

Authored fixtures use the real registry/parser route for alias renaming, schema
names, literal dots, brackets/backticks/edge spaces, matching CREATE/use decoded
names, CTE shadowing, derived aliases, qualified columns, valid empty SQL, parser
failure and source admission. They persist/reload JSON and sharded file relations
and exercise the actual cross-file usage fingerprint owner, preserving full
qualification and rejecting invalid typed roles. Runtime execution remains
deferred. The existing declaration, scanner and offline catalog fixtures remain.
