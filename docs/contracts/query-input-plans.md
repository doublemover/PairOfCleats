# Admitted query input plans

Comparison, parity and the search benchmark runner admit their selected query
file before build/search dispatch. Plain text uses trimmed nonblank, non-comment
lines. JSON accepts a nonempty string array or an object containing only that
array as `queries`, or the declared [generated workload version 2](generated-query-semantics.md).
The latter must have matching query rows, strings, counts and generation receipt;
producer-declared completeness remains separately labeled. Blank strings and non-string entries fail with the path and
entry index; objects do not become `[object Object]` searches. Literal strings
with that text remain valid queries. Inputs require valid UTF-8.

The existing explicit `query-field` projection remains available to query-pool
consumers that intentionally select query text from records. Its normalization
receipt names that projection. Model comparison and the parity child select string input;
structured per-query mode/filter/judgment records are unsupported there and must
not be silently reduced to unrelated requests.

The matrix's explicit text projection captures each admitted query pool into a
run-owned JSON string list before child dispatch. Its report retains the original
plans and the ordered-pool selection policy. Repeated occurrences survive both
within and across pools; the matrix does not silently deduplicate their weights.

Version 2 plans freeze the actual ordered selected cases, normalization, limit,
source-content digest and source selection. Every occurrence has a distinct ID
and unit weight, including repeated identical text. Content edits and selected
limits change plan identity; paths remain human provenance. Reports retain the
plan beside requested filenames, and comparison/parity rows retain case IDs.
Version 2 adds declared generator-workload admission and retains its producer
qualification separately. Earlier version 1 receipts remain historical; their
identity is not reused as the newer input plan.

Explicit missing, malformed, unreadable or empty input fails closed. The parity
smoke policy alone permits a missing optional default file to select its named
inline fallback. The receipt identifies that effective source and exact cases.
Malformed or empty default files cannot invoke it. No new CLI fallback switch is
introduced. The legacy safe reader returns an empty list only for an absent
optional file; required consumers use the admitted plan directly.

The input fixture checks object/primitive/blank rejection, literal controls,
intentional query-field projection, repeats, frozen snapshots, changed content
and limits, optional missing-default provenance, read failures, pending resource
ownership and invalid UTF-8. Actual comparison/parity CLI children reject invalid
explicit files before an index build or search. Response/observed-backend and
judgment qualification remain independent owners; query admission alone proves
the selected workload, not successful retrieval or measured parity.
