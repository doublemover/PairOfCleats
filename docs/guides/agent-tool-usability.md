# Agent tool usability

Versioned help and private-reader presentation make discovery, continuation and attribution explicit without changing retrieval or authorization.

## Choose the surface

- Code search: `pairofcleats search --help --json`. Every parser option: `pairofcleats search --help --all --json`.
- Commands: `pairofcleats help --json`; add `--all` for expert commands.
- Private history: `pairofcleats history help --json`; add `--all` for request schemas. This opens no vault and executes no archive reads.

Sparse code search has implicit AND; ANN free text expresses semantic intent. Explicit Boolean operators and filters constrain both. Private history has literal Unicode-word AND only. Start with a distinctive term; refine deliberately. Code modification filters differ from message-date filters.
Code search supports top-k, not offset pagination. Keep query/filter/scope fixed when increasing top and compare returned chunk identities/locations. Use `context-pack --repo . --seed file:src/index.js --hops 1` for related code. Current `-n` and `-h` aliases are documented; no retired flags are restored.

## Trusted-host private reader

Construct `createHistoryAgentReader({service,requestContext,partition})` with an authenticated service. Existing action grants, policy rechecks, vault verification and source boundaries remain authoritative. There are no caller-supplied principals, vault paths, imports or policy defaults.
Execute `reader.execute('search',{query:'Cobalt',role:'user',top:2})`. The packet carries effective requests, roles/dates, coverage, short citation labels, full IDs, exact context/references/original actions and `page.next`. Copy returned requests mechanically; short labels are display handles, never lookup authority.
Role=user can contain quoted third-party or hypothetical text. Inspect context before attributing biography. Occurrences are locations, not independent conversation counts. Artifact references do not prove availability.
Default summary omits the bulky raw envelope. `{detail:'full'}` preserves it. Exact original/member requests retain raw results and require existing original-read permission. Snippet/projection metadata and readable summaries disclose text truncation.
Compact JSON plus newline defaults to a 65536-byte cap, configurable from 4096 to 2097152. An oversized response returns OUTPUT_BUDGET with no partial evidence. Reduce top/text sizes or explicitly increase the cap; no automatic retries. Hosts must bound their enclosing protocols and readable rendering separately.

## Version and scope

`history-agent.v1`, `search-help.v1`, and `command-help.v1` identify these new interfaces. The underlying history schema version and old survey helper/snapshot remain unchanged; no new changes are credited to old trial results.
The earlier trial motivates discovery and mechanical bookkeeping; it does not establish comparative model performance or justify specializing around six prompts. Checks here use synthetic evidence. No external model evaluation, private snippet read or embedding run was performed.

## Retrieval follow-up backlog

Owner-requested: effortless defaults with expert controls; relevance/context/diversity and provenance; research-backed lexical/hybrid and optional reranking abstractions. The current archive is FTS5/BM25, not a separately embedded archive. The import receipt and schema/table definitions confirm this; general code embedding support is a separate domain.
Next implementation: optional trusted local candidate/rerank hooks behind partition authorization; explicit capability/mode reporting; retain lexical expert controls and exact provenance. Add source-policy rechecks after any asynchronous ranker, deterministic fusion/diversity and bounded context. Research selection is pending the parent's evidence.
Deferred operations: private full-archive embedding computation, model downloads, software installs and external paid embedding APIs require their applicable approval. This source change authorizes none of those. Owner audit/console/exclusions remain a separate unfinished implementation queue.

Implemented building blocks: ranking.js provides bounded deterministic weighted reciprocal-rank fusion, optional per-provenance-group diversity and a reranker permutation guard. These pure utilities perform no retrieval, permission checks or embedding. They are not wired into private archive execution; a future trusted hybrid adapter must fetch/filter candidates within one partition and recheck policy before emission. Defaults retain proven lexical behavior until that adapter is accepted.

## Research rationale and remaining integration

- BEIR: keep a lexical baseline; dense retrieval does not justify replacing it across domains. https://arxiv.org/abs/2104.08663
- ALCE: preserve retrievable evidence and inspectable citations; citation presence alone does not prove support. https://arxiv.org/abs/2305.14627
- LongMemEval: distinguish extraction, temporal questions, corrections and honest abstention. https://arxiv.org/abs/2410.10813
- RRF: implemented rank-list fusion uses reciprocal ranks rather than incomparable raw scores. https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf
- MMR: diversity is an optional control, not a reason to drop decision chains. The current per-group cap is a simple deterministic control, not a full MMR implementation. https://www.cs.cmu.edu/~jgc/publication/MMR_DiversityBased_Reranking_SIGIR_1998.pdf
- Retrieve/rerank: optional shortlist reranking follows recall, not a substitute for it. https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html
- Lost in the Middle motivates bounded relevant context rather than dumping entire conversations. https://arxiv.org/abs/2307.03172

These sources inform design; no gain on the owner's archive is claimed.
Implemented: auto matching first performs strict matching; only a complete zero-match result permits one bounded relaxed pass. All date/role/path/snapshot filters, quoted phrases and -word exclusions remain fixed. Explicit strict and relaxed knobs remain. A later empty page does not trigger relaxation. This is a declared retrieval policy, not a hidden query rewrite.
Implemented: packet-scoped resolveHistoryCitation returns the exact context/references/original action, rejecting missing or ambiguous labels. The service still authorizes it.
Diagnostics disclose no index, unavailable references, exhausted pages, no matches under filters and resource truncation. Filter impact is not guessed by querying outside filters. Generation/freshness are explicitly unknown where the store records no such identity; a future manifest is still required.
Remaining requested work: actual local semantic candidate adapter with model/index identities and incremental content hashes; correction-aware/temporal retrieval, small-span conversation indexing, overlapping-context merge, accepted-preference evidence tests, and optional query rewriting that retains the original. Preserve branch ancestry and role attribution already provided by the reader. Heavy graph/ColBERT/RAPTOR and hypothetical personal-history generation remain optional/deferred.
