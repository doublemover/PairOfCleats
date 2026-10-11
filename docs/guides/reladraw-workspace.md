# Bounded Reladraw evidence workspace

Status: **first-stage implementation checkpoint, not browser-qualified and not a complete viewer replacement** (2026-10-11).

Based on `codex/semantic-resume-campaign-20261010` at `91b3c48968d3453d051bd41e23a70d98eca4f697`.
The [owner's integration plan](https://chatgpt.com/space/page_aa58b6c8d548819184b23ee01c489455) identifies
`reladraw/reladraw`; the npm dependency is exactly `reladraw@0.16.0`, Apache-2.0.
The upstream NOTICE is retained in `docs/licenses/reladraw-NOTICE.txt`.
No upstream contribution, GitHub publication or live user indexing is part of this checkpoint.

## Open and use

1. Bootstrap this checkout with Node 26.x using the repository's normal procedure.
2. Start the existing `pairofcleats service api` for the authorized repository.
3. Open `/map/workspace` on the service's printed local origin.
4. Choose **Query index**, select **catalog**, and enter `{"repoRoot":"/your/repository"}`.
   If the API requires a bearer token, enter it in the memory-only token field.
5. Select an available logical artifact and choose **Inspect this artifact**. Row pages replace
   one another. Semantic record rows offer **Load semantic detail** against their exact generation.
6. For existing exported reports or query responses, **Open output** reads a JSON file of at most
   2 MiB locally in the browser. This does not upload the file.
7. The operation selector also exposes the existing canonical search, context, semantic,
   risk and runtime request envelopes. Enter the corresponding documented request JSON;
   this checkpoint does not yet provide polished operation-specific forms.

Static application assets contain no repository data and can load before token entry.
The API's origin checks run before assets; every data operation retains the API's authentication,
repository resolution and allowlist boundaries. Arbitrary paths/URLs cannot be requested by the
workspace controller. Enrichment is **plan-only**; enqueue/drain is rejected.

The existing `map-iso` command and renderer are not replaced by this checkpoint. The workspace
is available through the API service; code-map JSON can be opened directly.

## Information architecture and output coverage

The complete schema-derived physical/logical inventory is
[`reladraw-artifact-coverage.json`](reladraw-artifact-coverage.json). It enumerates all **136**
artifact names registered by this campaign's contracts. Inventory completeness does not mean
136 independent end-to-end artifact tests have run.

| Output | Projection | Interaction | Validation / limit |
| --- | --- | --- | --- |
| Code map | file/member containment and six directed relation kinds | bounded page, hierarchy, selection, type filter, all member metadata | real code-map producer fixture; source omissions preserved; 200 nodes/400 edges |
| Graph context pack | canonical NodeRef identities, source edge orientation | relationships, witness paths, confidence, unresolved endpoints | real graph-store producer, resolved/unresolved and incoming-edge fixtures; ambiguous candidates never promoted |
| Composite context pack | graph plus independent primary-source/types/risk/semantic evidence surfaces | source/range/excerpt inspection, evidence selection | schema-informed adapter; no real service/browser workflow qualification yet |
| Semantic detail/find/trace/explain | partition + local-ID identities, scope hierarchy, operands and typed edges | ordinal slots, ownership, names, source refs, available/omitted fields, frontier and explanations | real TypeScript collector fixture validated against semantic detail contract |
| Search | separate original-ranked result lists by mode | stable rank and hit membership, evidence inspector | real ranked memory search, duplicate-ID and rank tests; no client reranking |
| Enrichment result | task/state cards, authority and publication lineage | inspect blocked/completed state and diagnostics | schema-informed adapter; no execution buttons |
| Runtime evidence/families | separate observations, inferred claims, families, integrity and joins | evidence list and explicit limitations | schema-informed adapter; capture/comparison browser workflows not yet exercised |
| Impact/architecture/test suggestions/risk | report-specific entries and ordered witness/source fields | evidence/path inspection without invented relation edges | partial adapter coverage, needs producer fixtures for each report variant |
| Symbolic type query | membership/cardinality results; response-inline compressed word DAG | literal/ordered-concat inspection, shared child identities, no expanded-string allocation | recovered compressed-result contract fixture; backend remains separately unpublished |
| Logical array artifacts | manifest-pinned sequential row pages via existing loaders | 128-row / 64 KiB pages, single-use bounded cursors | 300-row loader fixture, expiration/stale/scope checks |
| Semantic physical family | published-store row stream carrying partition/generation and exact row | semantic record → detail query | uses existing published store; real two-file published-index → rows → detail fixture passed |
| Object/manifest artifacts | exact bounded object, generation and storage provenance | lazy field expansion | bounded load, explicit unavailable on oversize/unsupported form |
| Binary stores, offsets, unknown future artifact names | manifest provenance only | availability, physical pieces, hashes, known/unknown bytes | deliberately not decoded into invented nodes; use logical/query surfaces |

Auxiliary storage formats, recovery journals and dense numeric stores are not architecture nodes.
Unknown totals/values remain unknown. Missing artifacts and partial responses are visible.
The inspector exposes convenient identity/source/certainty fields plus every original field via
lazy expansion (40 entries at a time, nesting cap 32). Only one response is retained; there is
no accumulated expanded-path graph cache.

## Bounds and lifecycle

- JSON response/file admission: 2 MiB. Oversized complete exports require a narrower query.
- One projection page: 200 nodes / 400 edges. Omitted endpoint/edge counts remain visible.
- One Reladraw worker, 256 KiB source, 1-second deadline; replacement terminates the worker.
- AST admission: 200 explicit nodes, 400 edges, 650 statements; expanded node cap rechecked.
- Custom SVG/file icons are rejected. Rendered SVG is rebuilt through an inert allowlist.
- Original labels are quoted as data; identities are bound separately from diagram names.
- Editing failures keep the last valid layout for the same projection. A changed projection
  clears old geometry rather than displaying an old generation beneath a new coverage label.
- Requests abort predecessors and use latest-request-wins plus explicit generation checking.
- Artifact service owns at most eight readers with 60-second idle expiration, pruned on calls.
  Cursor tokens are single-use and tied to repository, generation and artifact.
- Source, response, display and omitted counts are distinct. The existing display limiter also
  preserves producer truncation, counts endpoint-filtered edges and recomputes display aggregates.

The 2 MiB artifact read ceiling is intentionally conservative. It can reject large JSON/columnar
artifacts, and semantic stores have their own backend admission rules. This is not demonstrated
million-symbol qualification. Full-index query services, not Reladraw, own global search/graph work.

## Unpublished symbolic backend

The separately recovered source at `a3e0e4f81c5e4a2accb7296162014011f3eacb5e` adds inferred-return
schema v2 and `classify-compressed` / `finite-string-word-dag-v1`. Its recovery archive SHA-256 is
`b57c2447cebd7eb77d03e6bbecf0a828a306866832ab73538adf7dbd60bd558e`.
Its contracts were inspected; **the backend patches were not applied here**. The adapter can
inspect these bounded exported responses without flattening word DAGs. The base campaign API
will reject a compressed query until that backend is separately reconciled and integrated.

## Verification receipts and remaining gates

Focused Node fixtures cover projection, actual Reladraw parse/resolve/render with source-derived
semantic rows, label injection, identity/rank preservation, unresolved orientation, 10,000-input
paged admission, request/worker replacement, timeout, generation mismatch, catalog pagination,
API auth/origin/repository/static-path boundaries and the existing viewer contract matrix.

Browser acceptance is **blocked, not passed**: the installed shell Chromium could not create its
Unix singleton socket (`Operation not permitted`); the supported cloud browser could not reach
the isolated shell loopback preview (`ERR_CONNECTION_REFUSED`). No screenshots, visual-quality,
GPU, FPS, mobile-layout or genuine browser-interaction results were fabricated.

Next required step is a supported private preview reachable by the cloud browser, or explicit
approval of another suitable test environment. Public publication and user-computer tasks are
not authorized here. After browser access, run real repeated/interrupt flows and inspect screenshots;
add producer-backed fixtures for remaining report families. The two-file published test index
now covers catalog→semantic detail, actual code maps, graph context, impact and ranked memory search. Complete the Reladraw stage's usefulness gate before starting
Three.js replacement.

The second stage remains unstarted: colored geometric stacks, segment-level links, larger-stack
links and overall pipeline plumbing; semantic zoom, legible hierarchy and bounded navigation.
Do not interpret this checkpoint as permission to skip the renderer comparison/readability gate.
