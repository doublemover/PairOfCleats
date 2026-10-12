# Bounded Reladraw evidence workspace

Status: **real Chromium/service/Worker qualification passed; software WebGL only** (2026-10-12).

The initial workspace checkpoint was based on `codex/semantic-resume-campaign-20261010`
at `91b3c48968d3453d051bd41e23a70d98eca4f697`. The October 12 interface repairs use
the audited `bb9901ac808a24629c8004ddd2479006716498be` baseline.
The [owner's integration plan](https://chatgpt.com/space/page_aa58b6c8d548819184b23ee01c489455) identifies
`reladraw/reladraw`; the npm dependency is exactly `reladraw@0.16.0`, Apache-2.0.
The upstream NOTICE is retained in `docs/licenses/reladraw-NOTICE.txt`.
No upstream contribution, GitHub publication or live user indexing is part of this checkpoint.

## Open and use

1. Bootstrap this checkout with Node 26.x using the repository's normal procedure.
2. Start `pairofcleats service api --repo /your/repository`. From the checkout, use
   `node bin/pairofcleats.js service api --repo /your/repository`. The existing API prints the
   evidence-workspace URL (also `mapWorkspaceUrl` in JSON startup output).
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
| Composite context pack | graph plus independent primary-source/types/risk/semantic evidence surfaces | source/range/excerpt inspection, evidence selection | real isolated-index composite-context producer; browser workflow unqualified |
| Semantic detail/find/trace/explain | partition + local-ID identities, scope hierarchy, operands and typed edges | ordinal slots, ownership, names, source refs, available/omitted fields, frontier and explanations | real TypeScript collector fixture validated against semantic detail contract |
| Search | separate original-ranked result lists by mode | stable rank and hit membership, evidence inspector | real ranked memory search, duplicate-ID and rank tests; no client reranking |
| Enrichment result | task/state cards, authority and publication lineage | inspect blocked/completed state and diagnostics | real published-generation plan-only service fixture; no execution buttons |
| Runtime evidence/families | separate observations, inferred claims, families, integrity and joins | evidence list and explicit limitations | actual API/browser family→verified-coordinate observation→immutable inferred claim qualified with a saved synthetic capture; no live measurements |
| Impact/architecture/test suggestions/risk | report-specific entries and ordered witness/source fields | evidence/path inspection without invented relation edges | real architecture/test-suggestion producers and actual risk-index standalone/composite explanations; risk-delta adapter is contract-fixtured |
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
- Each API router owns at most eight active or suspended readers. An unref'd
  timer expires suspended readers after 60 seconds without requiring another
  request. Awaited router shutdown cancels active reads and closes every reader;
  failed reader cleanup remains a terminal error, including failure during idle
  expiry or an active read, and is reported again by the idempotent close operation.
  Cursors cannot cross router instances.
  Cursor tokens are single-use and tied to repository, generation and artifact.
- Source, response, display and omitted counts are distinct. The existing display limiter also
  preserves producer truncation, counts endpoint-filtered edges and recomputes display aggregates.
- Small/short viewports scroll the document vertically, keep wrapped editor controls
  above the footer, and show a fixed inspector when selected. Large diagrams retain
  their bounded internal scroll area and Fit diagram control.

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

Historical browser acceptance at the 2026-10-11 checkpoint was **blocked, not passed**: the installed shell Chromium could not create its
Unix singleton socket (`Operation not permitted`); the supported cloud browser could not reach
the isolated shell loopback preview (`ERR_CONNECTION_REFUSED`). A later owner-private synthetic-only Site was successfully deployed, but its cloud-browser
authentication redirect was denied. No sign-in was performed. No screenshots, visual-quality,
GPU, FPS, mobile-layout or genuine browser-interaction results were fabricated.

DOM emulation exercises real application controls and actual Reladraw output but
cannot qualify rendered layout or GPU behavior. The later October 12 task-owned
Chromium session qualified the actual local services without browser sign-in.
The second viewer remains documented in [Semantic stacks](code-maps.md#semantic-stacks-threejs).

The 2026-10-12 harness uses a real published SSR witness and actual API router for
catalog → artifact → exact semantic detail, ranked search, retained stale/cancelled
views, downloads and real Reladraw Worker deadlines. Saved synthetic CPU/code-log
captures join to verified SSR source coordinates and flow through family discovery,
observations and separate immutable inferred claims. Runtime receipts include
verification bytes and family-open counts. The independent Three.js CLI/server
qualifies source-member selection, records the actual WebGL renderer and injects
WebGL unavailability to verify source hierarchy/inspector fallback.

The final Linux x64 run used Node 26.8.1, Playwright 1.56.1 and Chromium 141.0.7390.37.
All eleven workflows passed in 19.08 seconds including awaited cleanup, within the
unchanged 30-second allowance. It followed five bounded actual artifact pages to
`alias.slice()` in retained SSR source, checked exact detail/span/hash identity,
and inspected all five desktop/mobile/Three.js screenshots. The injected Worker
stall terminated in 1.043 seconds and preserved the previous SVG. Runtime lookup
opened one family and verified 42,753 bytes for one admitted observation.

The observed renderer was WebGL 2 through ANGLE Vulkan SwiftShader with no context
loss. Saved profile 10 µs deltas are explicitly synthetic; verified source refs and
immutable inferred claims do not turn them into live or causal measurements.
Earlier startup/paging failures and narrower machine passes remain retained;
browser and screenshot review exposed and corrected same-origin module admission and mobile
editor/footer overlap before final layout acceptance.

Run the harness with explicitly supplied task-owned browser assets and an isolated
receipt directory; it does not install browser dependencies or capture a live process:

```text
node tests/map/workspace/browser-qualification.js --playwright /task/browser/node_modules/playwright/index.mjs --chromium /task/browser/chrome --out /task/evidence
```

`browser-qualification.json` records the checkout, source/generation identity, browser,
observed renderer, request statuses, measured worker deadline and workflow results.
The complete fixture has a 30-second work allowance, propagated into the build and
runtime import owners, with 5-second browser steps and a 1-second Worker deadline.
It awaits all resource cleanup and reports cleanup time separately; a failed or
over-budget run, including cleanup failure, cannot produce a passing receipt.
Desktop, mobile portrait/landscape and separate Three.js screenshots accompany it.
A headless software-renderer pass is distinct from hardware/GPU/platform acceptance;
inspect the screenshots for occlusion and visual quality before making that claim.
Perfetto was not requested and no adapter or live attach permission is implied.

## Alternate validation and remaining visual checks

DOM emulation is separate from browser acceptance. It exercises selection, Enter/space targets,
directed relationship navigation/history, filtering, renderer replacement, invalid-editor recovery,
repeated page changes and inert SVG handling. It does not run native Workers or WebGL.

Resource fixtures exercise 64 KiB page cuts, oversized individual row rejection, 3 MiB JSON
artifact rejection, eight-reader eviction, cancellation and recovery after rejection. Large complete
exports are intentionally rejected; this does not establish unrestricted large-index support.

The tiny actual-service workflows qualify selection/focus, source identity, downloads,
stale/cancelled views, bounded Worker deadlines, responsive control layout and software
WebGL fallback. Large graph label density, screen-reader order, CPU-pressure behavior,
hardware FPS/GPU performance and native Windows browser execution require separate receipts.
