# Agent tool usability

Versioned help and private-reader presentation make discovery, continuation and attribution explicit.

## Choose the surface

- Code search: `pairofcleats search --help --json`; every option: `pairofcleats search --help --all --json`.
- Commands: `pairofcleats help --json`; add `--all` for expert commands.
- Private history: `pairofcleats history help --json`; add `--all` for request schemas. Help opens no vault.

Sparse code search has implicit AND; ANN free text expresses semantic intent. Explicit Boolean operators and filters constrain both. Private history uses Unicode words, required quoted phrases and -word exclusions. Its lexical match knob selects strict AND, relaxed OR, or auto: one relaxed pass only after a complete zero-match strict result under identical filters. An empty later page never broadens the query. OR in private-history text is an ordinary word.

Code search supports top-k, not offset pagination. Keep scope and filters fixed when increasing top. Use `context-pack --repo . --seed file:src/index.js --hops 1` for related code. Code modification dates differ from history message dates.

## Trusted-host private reader

Construct `createHistoryAgentReader({service,requestContext,partition})` with an authenticated service. Existing action grants, policy rechecks, vault verification and source boundaries remain authoritative. No caller-supplied principal, vault path or policy defaults are accepted.

Execute `reader.execute('search',{query:'Cobalt',role:'user',top:2})`. Packets contain effective requests, role/date labels, coverage, full references, short citation labels, exact follow-up actions and generation-pinned `page.next`. Copy returned requests mechanically. `resolveHistoryCitation` resolves a label only inside its packet; the service still authorizes the returned action.

User-role text can quote third parties or describe hypotheticals. Inspect context before attributing biography. Occurrences are locations, not independent conversation counts. Artifact references do not prove availability. Scores describe relevance, never factual confidence.

Default summary omits the bulky raw envelope; `{detail:'full'}` preserves it. Original/member actions require original-read authority. Compact JSON plus newline defaults to 65536 bytes, configurable from 4096 to 2097152. Oversized responses return OUTPUT_BUDGET with no partial evidence. Hosts must also bound their enclosing protocols and readable rendering.

## Generation, timelines and context

New stores require `inference-history.v7`. Transactional generation counters advance on new imports and first tombstones; identical repeated imports do not advance them. Opaque generation references pin continuations and citation actions. Concurrent changes fail closed with ERR_INFERENCE_HISTORY_STALE. Previous store formats are rejected without mutation or migration. The old survey remains pinned to its unchanged old source; this implementation authorizes no production reimport.

Privacy rule changes also advance the generation. Index update time does not establish export freshness or full archive coverage. Diagnostics distinguish missing index, unavailable references, exhausted pages, no matches under filters and bounded truncation. Filter impact is not guessed by querying outside filters.

The timeline command retrieves the selected conversation path or an off-path anchor's ancestry in oldest/newest order with role/date filters. Correction-language markers are text signals; they do not establish acceptance. `mergeHistoryContexts` deduplicates overlapping messages from one generation, rejects inconsistent spans and reports omissions. It performs no reads and cannot establish full conversation completeness.

## Optional local semantic retrieval

Without an adapter, auto mode uses lexical retrieval. A trusted host can provision `createLocalHistorySemanticAdapter` with explicit model ID/version, dimensions, index generation and local encode/search callbacks. No models, networks, packages or embeddings are created by this interface. The host must vet callback locality; the JavaScript interface is not an OS sandbox.

Hybrid mode fuses authorized lexical and semantic ranks using weighted RRF; semantic-only mode omits lexical rank membership. Provider references are rehydrated from the authorized partition. Provider text is never evidence. Optional candidate spans are validated against the authorized redacted projection; text is extracted from that projection. Role/date/path/snapshot filters, phrases and exclusions remain enforced. Policy and generation are checked after asynchronous callbacks and before release. Optional reranking must return an exact permutation of the authorized shortlist. Callback waits are bounded to ten seconds; hosts remain responsible for stopping their own computation after cancellation.

Controls expose candidate limits, lexical/semantic weights, rank constant, per-conversation cap and optional reranking. A missing or stale configured index fails explicitly; there is no network fallback. Source fixtures use toy vectors only. A bounded in-memory incremental index now chunks explicitly supplied authorized projections, reuses unchanged content-hash/vector entries and atomically replaces generations. Its integration is verified with toy encoders; actual model provisioning and measured recall remain unverified.

## Research rationale and verification scope

- BEIR motivates retaining a lexical baseline: https://arxiv.org/abs/2104.08663
- ALCE motivates inspectable evidence and citations without treating citation presence as support: https://arxiv.org/abs/2305.14627
- LongMemEval motivates temporal questions, corrections and honest abstention: https://arxiv.org/abs/2410.10813
- RRF uses reciprocal ranks rather than incomparable raw scores: https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf
- MMR motivates optional diversity; the per-group cap here is not full MMR: https://www.cs.cmu.edu/~jgc/publication/MMR_DiversityBased_Reranking_SIGIR_1998.pdf
- Retrieve/rerank follows recall: https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html
- Lost in the Middle motivates bounded relevant context: https://arxiv.org/abs/2307.03172

These sources inform design; no improvement on the owner's archive is claimed. `history-agent.v1`, `search-help.v1` and `command-help.v1` identify the new interfaces. Synthetic checks do not rewrite old trial receipts. Private snippet reads, real embeddings, model downloads, installs and paid APIs remain held. Query rewriting, graph/ColBERT/RAPTOR retrieval and hypothetical personal-history generation are deferred. Owner audit/console/privacy is implemented as trusted-host source, with focused synthetic checks. Every service requires audit persistence acknowledgement before release. The optional local ledger uses a separate verified private root. The human-only controller has independent service authentication and partition-scoped audit reads. Its escaped HTML page is read-only until the host supplies a same-origin mutation handler and session-bound token verifier; submitted fields cannot supply authentication or scope. Record exclusions, exact literal redactions and untrusted owner annotations persist across imports; controlled originals cannot bypass them. No live human console service, ACL change, private audit inspection or backup erasure is claimed. See the [history specification](../specs/inference-history.md) for host contracts and limits.

## Host transport adapters

The source now includes a Fetch-compatible owner handler and a narrow agent broker. The owner routes are GET /owner/history, GET /owner/history/audit, and POST /owner/history/privacy. Host sessions supply identity, partition, a stable request-context handle, expiry, policy epoch and an optional human form token out of band. Request bodies cannot choose those facts. Origin, body/output limits, session revocation and mutation tokens are checked before evidence release or writes. The broker permits reader commands only.

The shared host boundary requires a trusted verification callback attesting separate OS-principal or separate-host isolation for the audit sink and human channel. Synthetic tests exercise failure and revocation contracts; this attestation is not proof that deployment isolation exists. No listener, account, credential issuer, model or private archive is started by these adapters. The owner must choose an existing authenticated session provider and transport, supply genuine isolation verification, and separately authorize actual deployment and archive/model evaluation.

## Explicitly authorized file evidence

The separate file-evidence extractor accepts only explicitly host-authorized canonical source/output roots and creates a fresh private catalog. It preserves top-level originals, hashes their bytes, and records every source/member occurrence. ZIP/gzip/tar payloads use bounded content-addressed blobs, including PAX/GNU path metadata; archive paths are never executed or materialized as filesystem paths. Duplicate containers retain a pointer to their original expansion. JSON, JSONL, UTF-8 text and HTML retain complete bounded document text with declared IDs, time/model/session/repository fields and exact textual references. Facts remain declarations, not verified execution or implementation. Exact attachment IDs can join recovered source names; no time/similarity joins are inferred.

The catalog is private-file-evidence.v1, separate from inference-history stores. Unsupported formats (including unimplemented database formats), invalid JSON, CRC/read failures, encryption, links and resource limits remain explicit inventory statuses. Media bytes are preserved without OCR, transcription or rendering. A separate authorized metadata callback can retain bounded image dimensions/animation metadata without exposing arbitrary EXIF/XMP payloads in summaries. An independently authorized document pass can use existing vetted PDF/DOCX parsers to recover text into separate provenance-bearing derivatives; warnings and raw parser payloads are excluded from its summary. Committed interrupted catalogs can be integrity-checked and finalized without reimporting originals. Nested archive depth, member/expanded bytes, entry count and fact traversal are bounded; limited fact extraction retains the original document. No model, executable, script, macro or remote loader is run. Existing catalogs are refused, selected-file recovery accepts explicit flat source names, and interrupted catalogs/originals are preserved. Reading another archive/vault or joining its private records requires its own authorization; this extractor grants none.
