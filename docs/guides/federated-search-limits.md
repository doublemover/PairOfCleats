# Read a federated search result

Use [Search two repositories](workspaces.md) to prepare membership and the
individual indexes. This page explains the search routes and how to distinguish
a complete answer from unavailable work. The examples describe supported source
contracts; their execution on the current Windows candidate remains deferred.

## Ranked search and filter enumeration

Ranked CLI search uses `node bin/pairofcleats.js search --workspace <file>`.
The HTTP route is `POST /search/federated`; the MCP tool is `search_workspace`.
All three call the same coordinator. HTTP requires an allowlisted workspace file,
every member root, and the federation cache root. A workspace id alone does not
discover a configuration file.

Supply query text to rank candidates. Omit query text and supply an effective
filter to enumerate indexed matches. A queryless HTTP request can use this shape:

```json
{
  "workspacePath": "C:/work/workspace.jsonc",
  "strict": true,
  "search": {
    "mode": "code",
    "backend": "memory",
    "type": "FunctionDeclaration",
    "top": 2
  }
}
```

An empty query without filters rejects. Mode, backend, ANN settings and page size
alone do not select indexed rows. Nested search fields use the structured search
contract; unknown fields and invalid types reject rather than being ignored.

Enumeration returns one eligible repository/mode page at a time. Reuse its
`pagination.nextCursor` with exactly the same filters and selection, as `cursor`
or `search.cursor`. If both aliases are supplied they must agree. A changed
generation rejects continuation. Stop when `hasMore` is false, even if an earlier
repository returned no matches. A prose page searches only prose; extracted prose
has its own admitted task and cursor. Ranked queries cannot use these cursors.

## Completeness and selection

Ranked responses contain per-repository `status`, `completeness`, requested,
eligible and fulfilled modes, failures, and freshness. Filter enumeration reports
unavailable repository/mode pairs in `meta.completeness.unavailable`, alongside
whether pages remain. Inspect those fields before treating omitted hits as
evidence that a repository has no matches.

Default execution permits partial results when another repository succeeds.
`strict:true`, or CLI `--federated-strict`, rejects unavailable requested modes
before cache reuse or child execution. A present index with no matching rows is
a healthy empty result. A failed child envelope or missing mode payload is a
failure, not an empty result. Strict child failures reject promptly and stop new
admissions; already started reads drain before request-owned caches retire.

Disabled members are omitted by default. Explicit selection or
`select.includeDisabled:true` includes them in the requested scope, so strict
completeness also applies to them. Default cohort selection can deliberately
exclude incompatible members; inspect `meta.cohorts.excluded`. Such exclusions
do not mean an admitted index failed. An explicit cohort selector chooses that
cohort. Cohort policy `strict` instead rejects multiple compatible-key groups;
it is separate from execution strictness. Neither setting authorizes a build.

## Limits, generations and caches

Ranked search caps the global result count at 500 per mode, retained candidates
at 1,000 per repository/mode, and concurrent repositories at 32. Defaults are 10
global results, at most 50 retained candidates per repository, and concurrency 4.
Zero result/candidate limits produce no merged hits; they do not establish that
an unavailable index is healthy. Merge keeps source scores separately and ranks
with deterministic reciprocal-rank contribution and tie breakers.

Latest child calls use the retained per-mode builds admitted by the workspace
manifest. Mixed roots use separate mode calls. Results must match admitted mode
signatures, and a final manifest check rejects generation changes. This creates
no globally simultaneous workspace snapshot. Historical selectors remain
per-repository references and must match the admitted workspace signatures;
different historical generations reject rather than receiving current freshness.

Ranked outer-cache entries bind generation, selected members, priorities,
cohorts, filters and execution policy. Relative modification filters share a
request time anchor and a changed cutoff cannot reuse an earlier ranked result.
Enumeration retains its initial cutoff across pages. Expiration is checked before
a cache hit can refresh recency. Failed partial work and cancelled requests do
not establish a reusable successful result.

Workspace membership, per-repository `.pairofcleats.json`, retained indexes,
generated manifest/catalog, and the federation result cache remain distinct.
Workspace `cacheRoot` does not relocate individual repository caches. Local
path-based identities are not portable cross-machine repository ids. Graph,
semantic and context commands have their own scope; workspace search does not
make every command federated. See [graph/context contracts](../contracts/graph-tools-cli.md)
and [HTTP/MCP contracts](../contracts/mcp-api.md).
