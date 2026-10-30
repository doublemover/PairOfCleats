# Offline SQL catalog evidence

Implementation status: functional qualification deferred. Issue #1188 remains partial. Source batches have static checks; parser/runtime fixtures and published-consumer qualification remain unrun in the current continuation.

`collectOfflineSqlCatalogEvidence` takes an explicit imported catalog snapshot and independent expected identity/context. The snapshot binds PostgreSQL dialect, server version, ordered explicit `searchPath`, extension versions, migration identity and generation. Tables/columns carry physical schema/name identities and original source/hash/span witnesses. The host supplies those immutable migration sources alongside selected query sources; stale witnesses, mismatched contexts, duplicate names, dynamic `$user`/temporary search-path entries and wrong generations are rejected. No connection, credential discovery, endpoint lookup, catalog query or migration execution occurs.

The adapter uses the current application node-sql-parser **5.4.0** PostgreSQL AST for syntax and scope selection. That pinned grammar omits many table/column locations even when its generic location option is enabled. A bounded application-owned source qualifier therefore retains exact token ranges for direct SELECT projections and FROM/JOIN heads, cross-checks those ranges against the selected AST and preserves quoted case/escaped names. It skips comments and strings, including dollar quoting, without searching by identifier text. The qualifier is restricted to 32 KiB per query, bounded tokens/nesting/statements and the overall 20-source/500-KiB input scope. It does not replace the SQL grammar.

Unqualified tables resolve through the supplied search path in order. Unqualified columns resolve only when the admitted FROM scope identifies one candidate; ambiguous candidates remain explicit. Qualified aliases are local to that supported SELECT scope. Temporary objects, missing tables/columns, CTEs/subqueries, nonprojection/predicate ranges and unsupported expressions remain unknown or diagnostic. Function overloads, procedural SQL, MySQL/SQLite semantic binding, live type checking and PostgreSQL language-server integration are not implemented. Current application module closure stays explicitly unqualified and every result is partial.

The declaration identifies source-qualified reference/diagnostic evidence for bounded detail/navigation. Reports use the existing [canonical source-linked writer, provider sink and target-verified detail consumer](source-linked-schema-evidence.md). Physical catalog object identity and ambiguous source candidates are retained separately from rendered names. No schema type display string becomes a compiler type domain or runtime call graph.

The authored `indexing/semantic/sql-offline-catalog-evidence` fixture covers two search paths, ambiguous join columns, quoted identifiers, temporary/templated/nested SQL unknowns, strings that contain SQL keywords, stale schema/context rejection and actual canonical disk/sink/detail contracts. Its catalog and parser inventory are synthetic and unrun. Remaining work includes a qualified local catalog export/receipt owner, the concrete PostgreSQL tool profile and offline diagnostics, observed module/runtime closure, automatic project discovery, full scope/type/function support and published consumer/platform/cancellation proof.


## Table-column alias lists

Adapter **3** and shared compiler-binding producer **26** retain source-qualified
table-reference parts, quote policy, alias name/span and ordered exposed-column
names/spans. The bounded qualifier consumes a column-alias list as part of the
FROM occurrence instead of skipping its parentheses. The catalog has no admitted
physical column-order contract, so such a binding reports
`table_column_alias_list_unsupported` for column resolution, with no physical
column candidates or navigation target. Independently valid physical table
references remain resolved. A qualified ordinary binding in the same SELECT
can still resolve; an unqualified column that could belong to the renamed
binding remains unresolved. Ordinary alias spelling is also checked against the
parser observation. Parentheses inside a quoted alias name do not create a
column-alias list.

This conservative scope follows [PostgreSQL's positional alias rules](https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-TABLE-ALIASES).
The [pinned parser grammar](https://github.com/taozhi8833998/node-sql-parser/blob/5.4.0/pegjs/postgresql.pegjs)
encodes supported alias lists into its alias string; source token structure owns
the exact name/column distinction. Its quoted table-alias branch does not admit
a following column list, so that input remains a syntax/dialect diagnostic.
No catalog order or live database behavior is inferred. The report retains
`tableColumnAliases: false` alongside its existing partial coverage.

Authored controls extend the existing actual parser → qualifier → report →
canonical writer/detail fixture with swapped/qualified/partial/quoted-column,
duplicate/overlong/self-join lists, an ordinary alias containing literal
parentheses, and the pinned quoted-table-alias syntax exclusion. Unsupported
columns never appear as navigation candidates; table targets and full query
binding witnesses survive persistence. Existing search-path, ambiguity, source,
context, temporary-object and no-database controls remain.
