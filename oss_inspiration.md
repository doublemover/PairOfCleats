# Open-source inspiration & feature ideas for PairOfCleats-style repo indexing/search

> Goal: steal proven ideas from existing code search, code intelligence, and “codebase awareness” tools — especially where they avoid re-implementing low-level IR/indexing and where they **speed up indexing** / **speed up queries**.

- ## 1) Fast exact search + regex (trigram-centric engines)

  - **Add a trigram “candidate generator” layer for substring + regex queries** (instead of scanning every file):
    - Zoekt is a *fast trigram-based code search* engine; it’s specifically designed for code and ships both CLI and long-running services (indexserver + webserver).  
      *Action:* add a positional trigram (or ngram) index that can answer “which files *might* match this pattern?” quickly, then only run the expensive exact check on that candidate set. (Inspired by Zoekt.)  
      *(Refs: [1], [3])*
    - GitLab’s “Exact Code Search” write-up (built on Zoekt) notes that Zoekt can convert regex patterns into efficient trigram queries “when possible.”  
      *Action:* implement regex→ngram-query rewriting for the subset of regex you can safely approximate; treat it as a prefilter, then verify matches exactly.  
      *(Refs: [4])*
    - For a smaller standalone building block, `regrams` is explicitly about converting regex to trigram queries in the spirit of Google’s codesearch.  
      *Action:* reuse/adapt this technique rather than invent your own regex→prefilter pipeline.  
      *(Refs: [41])*

  - **Treat punctuation as first-class searchable tokens** (don’t silently normalize it away):
    - GitHub’s code search write-up highlights code-search-specific requirements: searching for punctuation (like `.` or `(`), no stemming, no stop-word removal, and regex support.  
      *Action:* audit your analyzer/tokenizer choices (and query parsing) to ensure punctuation-heavy code queries are not degraded.  
      *(Refs: [18])*

  - **Invest in query-language ergonomics early** (it drives real-world performance by reducing “broad queries”):
    - Zoekt has a query language with filters like file/path constraints and other operators; it’s built to scale search.  
      *Action:* support fast “narrowing” (repo:, file:, lang:, branch:) so users and agents generate narrower queries that hit fewer candidate docs.  
      *(Refs: [2])*
    - Sourcebot emphasizes a rich query language (regex, boolean logic, repo/language filters, branch search) for fast/precise code search.  
      *Action:* mirror the most-used filters and make them cheap in the index (metadata columns, bloom filters, etc.).  
      *(Refs: [19], [20])*

  - **Use symbol metadata as a ranking signal for code search results**:
    - Zoekt recommends installing Universal Ctags because symbol information is a “key signal in ranking search results.”  
      *Action:* extract symbol definitions (ctags/tree-sitter/LSP) and boost matches near definitions, signatures, and exported APIs.  
      *(Refs: [3], [9])*

  - **“Interactive regex search” UX can be a feature (and drives architecture)**:
    - livegrep is an open-source “fast interactive regexp search” tool.  
      *Action:* treat streaming results and tight query loops as a requirement; this pushes you toward cheap candidate generation and memory-friendly index formats.  
      *(Refs: [6])*

  - **Look at OpenGrok for “developer-friendly cross-reference” features**:
    - OpenGrok positions itself as a “fast and usable source code search and cross reference engine,” with navigation of source trees and VCS history awareness.  
      *Action:* consider adopting its feature ideas: cross-reference UI, annotation views, “definition/reference” navigation, and showing history context where helpful.  
      *(Refs: [7])*

- ## 2) Indexing pipeline patterns that consistently speed up builds

  - **Separate a cheap “crawl + metadata pre-pass” from expensive parsing/embedding**:
    - ripgrep’s default behavior is a good model for “smart crawling”: respect `.gitignore`, skip hidden/binary files by default.  
      *Action:* build a fast “file manifest” step that:
        - collects file list + size + mtime/hash + language guess,
        - applies ignore rules,
        - classifies obvious binaries,
        - and schedules work (per-language queues) before deeper passes.  
      *(Refs: [8])*

  - **Make indexing incremental by default**:
    - A recurring theme across scalable systems: don’t reindex unchanged files.
    - Stack graphs (GitHub) emphasize *file-incremental* construction to amortize costs when only a small fraction of files change.  
      *Action:* track file content hashes → skip re-parsing/re-embedding unchanged files; make the index update model “append + merge” rather than “rebuild.”  
      *(Refs: [16], [17])*

  - **Adopt a “service-mode indexer” for continuous updates (even if you also support one-shot indexing)**:
    - Zoekt’s indexserver is designed to periodically fetch and reindex repositories; webserver serves queries over the built index.  
      *Action:* split “indexing” and “querying” into separate processes or at least separate concerns, so indexing can be parallelized + scheduled without stalling query latency.  
      *(Refs: [3])*

  - **Use durable job queues for parallel repo indexing** (rather than ad-hoc promise pools):
    - Sourcebot v3 explicitly moved to parallelized repo indexing + connection syncing via Redis & BullMQ.  
      *Action:* copy that architecture if you need many repos and predictable throughput; it also enables “backpressure” and safer concurrency.  
      *(Refs: [21])*

  - **Prefer streaming, line-oriented formats for metadata extraction**:
    - Universal Ctags supports JSON Lines output; it also has an interactive mode that communicates via JSON lines over stdio.  
      *Action:* treat symbol extraction like a stream processing problem (spawn tool, parse JSON lines, write to DB) to avoid huge intermediate JSON blobs.  
      *(Refs: [9], [10])*

- ## 3) Code intelligence / navigation: stop reinventing per-language semantics

  - **Ingest standard persisted code-intel formats instead of building bespoke LSP caches**:
    - LSIF is a standard format for language servers/tools to emit their knowledge about a workspace; it can later answer LSP-like requests without running a language server.  
      *Action:* accept LSIF artifacts as an optional input to PairOfCleats; you get precise “go to definition / find references” for languages where an LSIF indexer exists, and you can fall back to heuristics elsewhere.  
      *(Refs: [12])*
    - SCIP is a language-agnostic protocol for indexing source code for code navigation (definition/references/implementations), with multiple language bindings and tooling.  
      *Action:* prefer SCIP over ad-hoc JSON schemas if you’re building a serious cross-language code-nav layer; it’s designed to be consumed by tooling.  
      *(Refs: [11])*

  - **Copy GitHub’s “stack graphs” approach when you need *fast, file-incremental* name resolution**:
    - GitHub’s stack graphs project provides a Rust implementation allowing name-resolution rules to be defined in a declarative DSL, designed to be efficient and incremental and not require build tooling.  
      *Action:* if your current LSP-based approach is slow/fragile, consider a “purely syntactic name binding graph” fallback for supported languages.  
      *(Refs: [16], [17])*
    - Caveat: the `github/stack-graphs` repo is archived (read-only).  
      *Action:* treat it as inspiration or a vendored dependency, not a fast-moving upstream.  
      *(Refs: [16])*

  - **Glean (Meta) is the “big hammer” blueprint for code facts + derived relationships**:
    - Meta describes Glean as an open source system for collecting, deriving, and working with facts about source code, with an efficient query language; they use it for code browsing, code search, and documentation generation.  
      *Action:* if you find yourself wanting “queryable facts” (defs/refs, call graphs, ownership, API usage, etc.), consider a Glean-like architecture (facts → derivations → query service) instead of stuffing everything into ad-hoc tables.  
      *(Refs: [13], [14])*

  - **Kythe is the most relevant “open schema” precedent for cross-language xref**:
    - Kythe is an open source project for building cross-language, cross-platform code indexing tools.  
      *Action:* steal its *graph schema mindset* and its separation between “extractor (build context)” and “indexer (emit graph facts).” This matters a lot for compiled languages where build flags define semantics.  
      *(Refs: [15])*

- ## 4) “Codebase awareness” / LLM retrieval: practical ideas that reduce reimplementation

  - **Adopt the “Ask mode grounded in search + nav tools” pattern (Sourcebot)**:
    - Sourcebot explicitly markets “Ask Sourcebot” as using its code search + navigation tools so reasoning models can search, follow code nav references, and answer with inline citations.  
      *Action:* instead of trying to embed everything and hope, combine:
        - exact search (fast recall),
        - code nav (follow refs/defs),
        - and then only embed as a *reranker* or semantic enhancer.  
      *(Refs: [19])*
    - **License note:** Sourcebot is *fair-source* (FSL) rather than OSI “open source”; treat it as inspiration even if you can’t directly reuse code in all contexts.
      *(Refs: [20])*

  - **Make embeddings a first-class indexing artifact (and keep them optional)**:
    - Continue’s docs: embeddings are generated during indexing and then used by “codebase awareness” to perform similarity search over your codebase.  
      *Action:* separate “text index correctness” from “embedding index usefulness”: you should be able to rebuild one without the other.  
      *(Refs: [22])*

  - **Borrow retrieval evaluation discipline**:
    - Continue’s “accuracy limits” post argues you need metrics (it uses an F1 framing of precision/recall) and staged evaluation to improve retrieval pipelines.  
      *Action:* build an offline benchmark harness for your repo retrieval (top‑k file recall, snippet recall, MRR, etc.) and gate changes on it.  
      *(Refs: [23])*
    - Haystack has open tutorials on evaluating RAG pipelines with statistical + model-based metrics.  
      *Action:* copy the evaluation pipeline pattern (separate retrieval metrics from generation metrics).  
      *(Refs: [34])*

  - **Build a “repo map” (compressed high-level summary) rather than always retrieving raw chunks**:
    - Aider uses a concise repository map of important classes/functions with types and call signatures; their newer write-up explains switching from ctags to tree-sitter to get richer signatures and multi-language support via `py-tree-sitter-languages`.  
      *Action:* add a low-token “map” artifact to PairOfCleats (symbols + signatures + file paths), and use it as:
        - a navigation aid for the LLM,
        - a cheap prefilter for retrieval,
        - and a fallback when embeddings are missing/stale.  
      *(Refs: [24], [25])*

- ## 5) Structural / AST search: precision features that also help performance

  - **Add AST-level matching for “find usages / patterns” queries**:
    - `ast-grep` is a tree-sitter based tool for structural search/lint/rewrite.  
      *Action:* integrate AST-pattern search as a separate “structural index” (or on-demand engine) for queries where text search is too noisy.  
      *(Refs: [26])*

  - **Borrow Semgrep’s rule-driven approach as a plug-in layer**:
    - Semgrep is an open-source static analysis tool centered on pattern rules.  
      *Action:* use Semgrep-style rules to extract “interesting nodes” into your index (public APIs, risky sinks/sources, TODO/FIXME hotspots) and to answer certain classes of queries quickly.  
      *(Refs: [27])*

  - **Use Comby-style structural templates as a language-agnostic option**:
    - Comby provides structural search and replace.  
      *Action:* make it the fallback structural engine for languages you don’t support with tree-sitter/LSP, or for quick refactor queries.  
      *(Refs: [28])*

- ## 6) “Stop reimplementing the whole search engine” options (still OSS)

  - **If your pain is the inverted index implementation itself**:
    - Tantivy is a Lucene-inspired full-text search library written in Rust.  
      *Action:* consider replacing or offloading your token/BM25 index to a proven IR library (via FFI or a sidecar process) while keeping your higher-level orchestration in JS/TS.  
      *(Refs: [37])*
    - Meilisearch is an open-source search engine (Community Edition is MIT) and advertises full-text + semantic/hybrid search.  
      *Action:* if “stand up a server” is acceptable, you can outsource full-text ranking + filtering and focus on code-aware chunking/nav.  
      *(Refs: [38])*
    - Typesense is another open-source search engine positioned for speed and low-latency search-as-you-type.  
      *Action:* consider it for “UI search suggestions” / instant filtering, but be mindful it’s not code-regex-first.  
      *(Refs: [39])*

  - **If your pain is vector indexing / ANN**:
    - LanceDB is an open-source vector database designed for fast vector search and also mentions full-text + hybrid search with secondary indexes in its docs.  
      *Action:* consider swapping your vector layer to LanceDB if you need more mature ANN indexes, filtering, and on-disk formats, while keeping SQLite for metadata.  
      *(Refs: [35], [36])*

  - **If your pain is ingestion plumbing (loaders, chunking, evaluation)**:
    - LlamaIndex.TS is a TypeScript framework for “context engineering” and RAG; it includes embedding model abstractions.  
      *Action:* use it (or borrow its abstractions) for loaders/chunkers/metadata flows, while keeping your custom search backend.  
      *(Refs: [30], [31])*
    - LangChain’s JS ecosystem has standardized document loaders; its GitHub loader shows an existing pattern for fetching and turning a repo into “Documents.”  
      *Action:* reuse loader abstractions for connectors and file normalization, even if you don’t use LangChain for retrieval.  
      *(Refs: [32], [33])*

- ## 7) “Old but useful” code navigation/tagging ideas (cheap wins)

  - **Use GNU Global / ctags-style tag DBs as a lightweight fallback**:
    - GNU GLOBAL and ctags-like tools exist specifically to build tag files for code navigation across large projects; they’re battle-tested and editor-integrated.  
      *Action:* for languages where LSP/SCIP is heavy or broken, fall back to tags for “jump to definition by name” and for building repo maps quickly.  
      *(Refs: [9], [29])*

- ## 8) Concrete “feature gaps” to look for when comparing your repo to the best-in-class tools

  - **Regex prefiltering:** Can you convert parts of a regex into cheap ngram constraints? (Zoekt/GitLab ECS.)
  - **Index update model:** Do you reindex only changed files? Can you do it incrementally + in parallel? (Stack graphs / Sourcebot v3.)
  - **Rich query language:** Can you narrow searches cheaply by repo, lang, file path, branch? (Zoekt / Sourcebot.)
  - **Symbol-aware ranking:** Are symbol defs boosted? Do you have a notion of “definition match”? (Zoekt + ctags.)
  - **Persisted code intel ingestion:** Can you import SCIP/LSIF to avoid running language servers? (SCIP/LSIF.)
  - **“Ask” grounded answers with citations:** Can the agent follow defs/refs and cite the code? (Sourcebot.)
  - **Retrieval evaluation harness:** Do you have offline metrics + a benchmark dataset? (Continue / Haystack.)
  - **Structural search:** Do you support AST patterns for high-precision queries? (ast-grep / Semgrep / Comby.)

---

## References (copy/paste)

```text
[1]  https://github.com/sourcegraph/zoekt
[2]  https://sourcegraph.com/github.com/sourcegraph/zoekt/-/blob/doc/query_syntax.md
[3]  https://pkg.go.dev/github.com/sourcegraph/zoekt
[4]  https://about.gitlab.com/blog/exact-code-search-find-code-faster-across-repositories/
[5]  https://github.com/hound-search/hound
[6]  https://github.com/livegrep/livegrep
[7]  https://github.com/oracle/opengrok
[8]  https://github.com/BurntSushi/ripgrep
[9]  https://docs.ctags.io/en/latest/man/ctags-json-output.5.html
[10] https://docs.ctags.io/en/latest/interactive-mode.html
[11] https://github.com/sourcegraph/scip
[12] https://lsif.dev/
[13] https://engineering.fb.com/2024/12/19/developer-tools/glean-open-source-code-indexing/
[14] https://github.com/facebookincubator/Glean
[15] https://github.com/kythe/kythe
[16] https://github.com/github/stack-graphs
[17] https://github.blog/open-source/introducing-stack-graphs/
[18] https://github.blog/engineering/architecture-optimization/the-technology-behind-githubs-new-code-search/
[19] https://github.com/sourcebot-dev/sourcebot
[20] https://docs.sourcebot.dev/
[21] https://github.com/sourcebot-dev/sourcebot/discussions/256
[22] https://docs.continue.dev/customize/model-roles/embeddings
[23] https://blog.continue.dev/accuracy-limits-of-codebase-retrieval/
[24] https://aider.chat/docs/repomap.html
[25] https://aider.chat/2023/10/22/repomap.html
[26] https://github.com/ast-grep/ast-grep
[27] https://github.com/semgrep/semgrep
[28] https://github.com/comby-tools/comby
[29] https://www.gnu.org/software/global/
[30] https://developers.llamaindex.ai/typescript/framework/
[31] https://developers.llamaindex.ai/typescript/framework/modules/models/embeddings/
[32] https://docs.langchain.com/oss/javascript/integrations/document_loaders/web_loaders/github
[33] https://reference.langchain.com/javascript/classes/_langchain_community.document_loaders_web_github.GithubRepoLoader.html
[34] https://haystack.deepset.ai/tutorials/35_evaluating_rag_pipelines
[35] https://github.com/lancedb/lancedb
[36] https://docs.lancedb.com/
[37] https://github.com/quickwit-oss/tantivy
[38] https://github.com/meilisearch/meilisearch
[39] https://github.com/typesense/typesense
[41] https://github.com/aaw/regrams
```
