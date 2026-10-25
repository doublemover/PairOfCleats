# Semantic artifact reader input ownership

The artifact store captures each requested RecordRef before opening a piece or
starting a related-row query. The captured reference contains only the validated
`partitionId` and `localId`, is immutable, and does not alias the caller's object.
`getSourceSpans` owns its references before record hydration, so selecting the
source manifest and labeling the excerpt use the same submitted partition.
Related-index bounds and hydrated owner checks use one captured reference.

Record arrays retain the existing `maxRecords` admission before allocating a
copy. Required values and array entries must be own data properties; accessors
and holes are rejected without calling them. A thrown reflection failure is
propagated unchanged. Capturing does not accept a serialized resource session or
establish any new resource authority.

Field-group capture validates every supplied entry and retains only the existing
`span`, `scope`, and `data` groups. Duplicate groups remain accepted, with their
existing projection meaning and first-occurrence order. There is no new request
length cap or public option. At most three field names are retained, though
scanning a caller's duplicate-filled list and arbitrary Proxy reflection are not
total work bounds. Error classification remains `ERR_SEMANTIC_INTEGRITY` for this
artifact backend. Persisted producer meaning and format versions are unchanged.

The authored retained-writer/reader controls mutate refs and fields during real
piece reads, select between two sources with the same local ID, and exercise the
physical related-row index. They are **UNVALIDATED**. This change does not capture
store-construction options, foreign reader implementations, native SQLite input
ownership, or every direct operation/neighbor argument. Broader runtime, provider,
performance and full-index qualification remains open.

SQLite payload readers apply the configured UTF-8 `maxRowBytes` allowance in SQL
before exporting payload text. Related, coverage and frontier pages also admit
their aggregate encoded bytes against `maxHydrationBytes` (defaulting to the row
allowance), then hydrate through an iterator. Direct record batches share the
same aggregate admission. Oversized evidence rejects with
`ERR_SEMANTIC_OUTPUT_LIMIT`; invalid admitted JSON rejects with
`ERR_SEMANTIC_INTEGRITY`. A failed page publishes no continuation past unreturned
evidence. Internal `hydratedRows`/`hydratedBytes` metrics describe exported payload
text, not SQLite's native scan or expression-evaluation work. Resource admission
does not change semantic producer identities or persisted formats.
