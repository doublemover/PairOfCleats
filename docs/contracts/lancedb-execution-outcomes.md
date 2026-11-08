# LanceDB execution outcomes

Successful native empty arrays remain successful empty results. An explicitly
empty candidate set still avoids loading LanceDB. A disabled/unselected backend
retains its normal availability policy.

For a selected published LanceDB descriptor, missing/unsupported optional
dependency or API shape raises `ERR_LANCEDB_UNAVAILABLE`. Ordinary connection,
table-open, query-construction, materialization and row-iteration failures
propagate their original value after the existing lease/cleanup owner settles.
Independent abort and caller cancellation remain distinct from successful empty
output. Failed original close retains its existing LanceDB owner/cause and cannot
become an ordinary sparse fallback while unsettled.

The adapter does not choose fallback or print a fallback-success warning. Its
existing ANN consumer owns failure counts, cooldown, latency admission, fallback,
vector-only capability checks and query-result cache admission. An ordinary
failed attempt contributes no healthy latency sample and cannot start progressive
larger-topN work as though it were a successful underfilled response.

`RETRIEVAL_EXECUTION_VERSION` is2. The envelope fields and query-cache container
format are unchanged. Existing admission rejects v1 execution metadata because
it could certify a swallowed native failure as complete/cacheable. Old author
caches are not rewritten or deleted for migration; incompatible entries remain
misses and subsequent successful searches can persist new canonical metadata.
This is conservative query-result invalidation, not a change to source chunks,
embedding spaces, index artifact formats, or semantic producer versions.
