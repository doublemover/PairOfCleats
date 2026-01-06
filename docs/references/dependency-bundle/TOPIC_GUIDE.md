# TOPIC_GUIDE — mapping PairOfCleats tasks to dependencies

Use this as an entrypoint when you know *what you’re trying to build* but not which dependency sheet is most relevant.

## Repository scanning & ingestion (ignore rules, binary/text, encodings)

- [fdir](deps/fdir.md)
- [ignore](deps/ignore.md)
- [file-type](deps/file-type.md)
- [istextorbinary](deps/istextorbinary.md)
- [chardet](deps/chardet.md)
- [iconv-lite](deps/iconv-lite.md)
- [picomatch](deps/picomatch.md)

## Language detection & routing to parsers

- [linguist-languages](deps/linguist-languages.md)

## TS/JS parsing, metadata, type inference

- [typescript](deps/typescript.md)
- [@typescript-eslint/typescript-estree](deps/typescript-eslint-typescript-estree.md)
- [@babel/traverse](deps/babel-traverse.md)
- [esquery](deps/esquery.md)
- [@swc/core](deps/swc-core.md)
- [@ast-grep/napi](deps/ast-grep-napi.md)
- [jsdoc-type-pratt-parser](deps/jsdoc-type-pratt-parser.md)
- [@es-joy/jsdoccomment](deps/es-joy-jsdoccomment.md)

## Docs parsing & chunking (Markdown/MDX/HTML)

- [micromark](deps/micromark.md)
- [@mdx-js/mdx](deps/mdx-js-mdx.md)
- [parse5](deps/parse5.md)

## Framework/template parsing (Vue/Svelte/Astro/Handlebars/Nunjucks)

- [@vue/compiler-sfc](deps/vue-compiler-sfc.md)
- [svelte](deps/svelte.md)
- [@astrojs/compiler](deps/astrojs-compiler.md)
- [@handlebars/parser](deps/handlebars-parser.md)
- [nunjucks](deps/nunjucks.md)

## Config parsing & validation (JSON/YAML/TOML/JSONC)

- [ajv](deps/ajv.md)
- [yaml](deps/yaml.md)
- [smol-toml](deps/smol-toml.md)
- [jsonc-parser](deps/jsonc-parser.md)
- [fast-xml-parser](deps/fast-xml-parser.md)
- [dockerfile-ast](deps/dockerfile-ast.md)

## Search prefiltering & tooling integration

- [@vscode/ripgrep](deps/vscode-ripgrep.md)
- [execa](deps/execa.md)

## Worker pools, sharding, and incremental watching

- [piscina](deps/piscina.md)
- [greedy-number-partitioning](deps/greedy-number-partitioning.md)
- [chokidar](deps/chokidar.md)

## Index artifacts: hashing, compression, serialization

- [xxhash-wasm](deps/xxhash-wasm.md)
- [fflate](deps/fflate.md)
- [msgpackr](deps/msgpackr.md)

## Durable indexes/backends (SQLite/LMDB) & ANN (HNSW)

- [better-sqlite3](deps/better-sqlite3.md)
- [lmdb](deps/lmdb.md)
- [hnswlib-node](deps/hnswlib-node.md)
- [roaring-wasm](deps/roaring-wasm.md)

## Embeddings/inference

- [onnxruntime-node](deps/onnxruntime-node.md)

## Metrics/logging/benchmarks

- [pino](deps/pino.md)
- [pino-pretty](deps/pino-pretty.md)
- [prom-client](deps/prom-client.md)
- [hdr-histogram-js](deps/hdr-histogram-js.md)
- [tinybench](deps/tinybench.md)
- [seedrandom](deps/seedrandom.md)

## Version parsing for dependency metadata

- [semver](deps/semver.md)

## Graph relations (imports/calls/refs)

- [graphology](deps/graphology.md)

## Multi-pattern scanning and safe regex

- [aho-corasick](deps/aho-corasick.md)
- [re2js](deps/re2js.md)

## Schema/query languages

- [graphql](deps/graphql.md)
- [protobufjs](deps/protobufjs.md)
