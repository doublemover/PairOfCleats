# PairOfCleats — dependency reference bundle

This bundle is a curated set of implementation-relevant deep links for dependencies used (or intended) in the PairOfCleats indexing/search pipeline. Each dependency has its own short reference sheet with practical notes plus the original deep links.

## How to use (recommended)
1. Start with `TOPIC_GUIDE.md` to map a task to likely dependencies.
2. Open the specific dependency sheet under `deps/` for deep links and gotchas.
3. When implementing, turn the **Suggested extraction checklist** into unit tests and benchmark fixtures.

## Package sheets (grouped)
### AST querying (selectors over ESTree)
- [esquery](deps/esquery.md)

### AST traversal (JS/TS/ESTree/Babel AST)
- [@babel/traverse](deps/babel-traverse.md)

### Binary detection (magic numbers)
- [file-type](deps/file-type.md)

### Binary serialization for artifacts
- [msgpackr](deps/msgpackr.md)

### Caching / single-flight async work
- [lru-cache](deps/lru-cache.md)

### Compressed bitsets / postings sets
- [roaring-wasm](deps/roaring-wasm.md)

### Compression / zip artifacts
- [fflate](deps/fflate.md)

### Config validation / schema enforcement
- [ajv](deps/ajv.md)

### Config/document parsing (YAML) with positional fidelity
- [yaml](deps/yaml.md)

### Determinism / reproducible sampling
- [seedrandom](deps/seedrandom.md)

### Doc parsing (Markdown) and positional chunking
- [micromark](deps/micromark.md)

### Dockerfile parsing
- [dockerfile-ast](deps/dockerfile-ast.md)

### Embeddings/inference (ONNX Runtime)
- [onnxruntime-node](deps/onnxruntime-node.md)

### Encoding detection
- [chardet](deps/chardet.md)

### Fast parsing/transform (JS/TS)
- [@swc/core](deps/swc-core.md)

### Fast text search integration
- [@vscode/ripgrep](deps/vscode-ripgrep.md)

### File watching / incremental indexing
- [chokidar](deps/chokidar.md)

### Filesystem crawling
- [fdir](deps/fdir.md)

### Framework parsing (Astro)
- [@astrojs/compiler](deps/astrojs-compiler.md)

### Framework parsing (Svelte)
- [svelte](deps/svelte.md)

### Framework parsing (Vue SFC)
- [@vue/compiler-sfc](deps/vue-compiler-sfc.md)

### Glob parsing/matching
- [picomatch](deps/picomatch.md)

### Graph modeling (relations and traversals)
- [graphology](deps/graphology.md)

### GraphQL document parsing/visiting
- [graphql](deps/graphql.md)

### HTML parsing with locations
- [parse5](deps/parse5.md)

### Hashing / stable IDs
- [xxhash-wasm](deps/xxhash-wasm.md)

### High-resolution latency histograms
- [hdr-histogram-js](deps/hdr-histogram-js.md)

### Ignore semantics (.gitignore-compatible)
- [ignore](deps/ignore.md)

### JSDoc comment parsing and conversion
- [@es-joy/jsdoccomment](deps/es-joy-jsdoccomment.md)

### JSDoc type parsing
- [jsdoc-type-pratt-parser](deps/jsdoc-type-pratt-parser.md)

### JSON-with-comments parsing and edits
- [jsonc-parser](deps/jsonc-parser.md)

### Language detection / file classification
- [linguist-languages](deps/linguist-languages.md)

### Log formatting / developer ergonomics
- [pino-pretty](deps/pino-pretty.md)

### Logging (structured, high-performance)
- [pino](deps/pino.md)

### MDX parsing/compilation
- [@mdx-js/mdx](deps/mdx-js-mdx.md)

### Metrics (Prometheus client)
- [prom-client](deps/prom-client.md)

### Microbench tooling
- [tinybench](deps/tinybench.md)

### Multi-pattern search / dictionary matching
- [aho-corasick](deps/aho-corasick.md)

### Parsing (TS/JS → ESTree) + typed services
- [@typescript-eslint/typescript-estree](deps/typescript-eslint-typescript-estree.md)

### Parsing / Type analysis (TS/JS)
- [typescript](deps/typescript.md)

### Pattern-based AST search (high-performance)
- [@ast-grep/napi](deps/ast-grep-napi.md)

### Persistent KV store (LMDB)
- [lmdb](deps/lmdb.md)

### Process execution
- [execa](deps/execa.md)

### Protocol Buffers parsing/tooling
- [protobufjs](deps/protobufjs.md)

### Python typing / diagnostics
- [pyright](deps/pyright.md)

### SQLite storage backend
- [better-sqlite3](deps/better-sqlite3.md)

### Safe regex (ReDoS-resistant)
- [re2js](deps/re2js.md)

### TOML parsing
- [smol-toml](deps/smol-toml.md)

### Template parsing (Handlebars)
- [@handlebars/parser](deps/handlebars-parser.md)

### Template parsing (Nunjucks)
- [nunjucks](deps/nunjucks.md)

### Text decoding/encoding (streaming)
- [iconv-lite](deps/iconv-lite.md)

### Text vs binary heuristics
- [istextorbinary](deps/istextorbinary.md)

### Vector index (HNSW) lifecycle
- [hnswlib-node](deps/hnswlib-node.md)

### Version parsing and range evaluation
- [semver](deps/semver.md)

### Work sharding / load balancing
- [greedy-number-partitioning](deps/greedy-number-partitioning.md)

### Worker pools / parallel indexing
- [piscina](deps/piscina.md)

### XML parsing
- [fast-xml-parser](deps/fast-xml-parser.md)
