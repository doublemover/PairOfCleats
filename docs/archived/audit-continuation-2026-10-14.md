# Audit continuation, 2026-10-14

Canonical status: [roadmap](../roadmap.md). Implementation base: `654fa6c53`.

## SRC-010: cold metadata page seeking

Artifact and LMDB continuations now hydrate authenticated metadata rows from
an optional version-2 representation in the existing bounded cache owner.
Version-1 ID entries remain supported. The 16 MiB entry, 64 MiB total, 32-entry
limits, HMAC identity, block hashes, contained-file checks and admission lock
remain enforced. Oversized, missing or corrupt entries fall back to the
authoritative backend. Relation-dependent loads retain the full loader.

Fresh-process tests pass for artifact, SQLite and LMDB: 10,000 rows, eleven
pages of 997, 10,000 predicate scans and 19,003 hydrated metadata rows.
Artifact/LMDB previously loaded 110,000 rows. Integrity, cold-page and enumeration
regressions also pass, including Unicode rows, corruption, generation mismatch,
oversized-row fallback and bounded eviction. Historical local receipts:
`.testLogs/run-1792029255578-wquzas` (artifact) and
`.testLogs/run-1792029296830-hu26z3` (four related fixtures).

The full wrapper's existing five-second child deadline failed in three focused
attempts (5.1 seconds each). A separate diagnostic completed in 5.34 seconds;
that is not passing acceptance. The deadline was not raised. Source-loader
qualification is distinct from wrapper startup; SRC-010 remains qualification-
limited until the wrapper passes on the target host. No cross-platform claim.

## EMB-009: representative bounded provider measurements

[Durable measurement and corpus](embedding-throughput-2026-10-14.json) records
24 actual repository excerpts: eight files at 128/512/2048 characters (short
files stop at EOF), text/source SHA-256, complete text, pinned model hashes,
provider settings, wall/native busy/tokenizer time, padding, and thread-observation
availability. The sample spans indexing, retrieval, protocol, tests, docs and
package metadata. It is a bounded varied-code sample, not production sizing.

Official Xenova/all-MiniLM-L6-v2 revision
`751bff37182d3f1213fa05d7196b954e230abad9` supplied fp32/q8 ONNX models and
tokenizer assets; model SHA-256 checks passed before use. Windows, Node 26.8.1,
CPU provider, requested intra-op=2/inter-op=1. Initialization and one warmup
are excluded from measurements; each precision process completed within 30s.
Each batch size is one trial, in order, with a warm tokenization cache. Native
thread attribution is unavailable on this host; requested counts are not
observed native counts. Default tokenizer truncation applies (512-token ceiling);
`maxLength` in the historical recipe is not a recognized ONNX config override.

| Batch | fp32 texts/s | q8 texts/s | Useful tokens | Padded tokens |
| --- | ---: | ---: | ---: | ---: |
| 1 | 13.70 | 14.23 | 5,896 | 5,896 |
| 4 | 5.50 | 5.53 | 5,896 | 12,288 |
| 8 | 4.94 | 5.56 | 5,896 | 12,288 |
| 16 | 5.25 | 6.18 | 5,896 | 12,288 |

All vectors were finite and 384-dimensional. q8/fp32 cosine across batch-1
outputs: minimum 0.9851014, mean 0.9907595; **all 24 fall below 0.999**.
This preserves the existing q8 precision limitation; throughput is not precision
acceptance. Mixed-length padding explains why these batch results do not support
a larger default batch. No default, provider or precision policy was changed.
EMB-009's missing representative measurement is supplied; it remains qualified
only for this CPU/model/corpus, with q8 parity and platform limits explicit.

## Reproduction and provenance

Raw output/models under `temp/tasks/dependency-ci-audit-20261014` are historical
author-workspace artifacts, not clean-checkout deliverables. After the normal
bootstrap, obtain the pinned official model assets listed in the durable JSON
and verify their hashes. Place the script below at
`temp/tasks/dependency-ci-audit-20261014/representative.mjs`, with assets under
`models/Xenova/all-MiniLM-L6-v2` in that task directory. For exact corpus replay,
replace the source-file extraction loop with the durable JSON's `corpus` array;
current source prefixes may differ from the measured snapshot. Invoke each
precision separately using a parent `spawnSync` with `timeout: 30000`, no retry.
The exact historical script follows; its redundant maxLength field has no effect.

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createOnnxEmbedder } from '../../../src/shared/onnx-embeddings.js';
import { observeProcessThreads } from '../../../src/shared/provider-thread-observation.js';
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const root = process.cwd();
const base = path.resolve('temp/tasks/dependency-ci-audit-20261014');
const precision = process.argv[2];
const modelDir = path.join(base, 'models/Xenova/all-MiniLM-L6-v2');
const files = ['src/index/embedding.js','src/shared/onnx-embeddings.js','src/retrieval/pipeline/filter-enumeration.js','src/retrieval/pipeline/filter-enumeration-cache.js','src/shared/jsonrpc.js','tests/perf/bench/query-runtime.js','docs/roadmap.md','package.json'];
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const corpus = [];
for (const file of files) {
 const source = await fs.readFile(file, 'utf8');
 for (const length of [128,512,2048]) {
  const text = source.slice(0,length);
  corpus.push({file, sourceSha256:sha(source),textSha256:sha(text),characters:text.length,text});
 }
}
const baselineThreads = observeProcessThreads();
const adapter = createOnnxEmbedder({rootDir:root,modelId:'Xenova/all-MiniLM-L6-v2',modelsDir:path.join(base,'models'), normalize:true,onnxConfig:{modelPath:path.join(modelDir,'onnx',precision === 'q8'?'model_quantized.onnx':'model.onnx'),tokenizerId:modelDir,executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1,maxLength:256}});
const rows=[];
try {
 await adapter.embedderPromise;
 await adapter.getEmbeddings([corpus[0].text]);
 const counts = await adapter.estimateTokens(corpus.map(x=>x.text));
 for (const batchSize of [1,4,8,16]) {
  const before = adapter.executionInfo();
  const started=performance.now();
  let paddedTokens=0;
  const vectors=[];
  for(let offset=0;offset<corpus.length;offset+=batchSize){
   const group=corpus.slice(offset,offset+batchSize);
   paddedTokens+= Math.max(...counts.slice(offset,offset+batchSize))*group.length;
   const result=await adapter.getEmbeddings(group.map(x=>x.text));
   if(result.length!==group.length || result.some(v=>v.length!==384 || !Array.from(v).every(Number.isFinite))) throw Error('invalid vectors');
   vectors.push(...result.map(v=>Array.from(v)));
  }
  const wallMs=performance.now()-started;
  rows.push({batchSize,wallMs,textsPerSecond:corpus.length*1000/wallMs,usefulTokens:counts.reduce((a,b)=>a+b,0),paddedTokens,before,after:adapter.executionInfo(),threads:observeProcessThreads()});
  if(batchSize===1) await fs.writeFile(path.join(base,`${precision}-vectors.json`),JSON.stringify(vectors));
 }
 await fs.writeFile(path.join(base,`${precision}-representative.json`),JSON.stringify({precision,platform:process.platform,node:process.version,modelRevision:'751bff37182d3f1213fa05d7196b954e230abad9',baselineThreads,corpus:corpus.map(({text,...item})=>item),rows},null,2));
 console.log(JSON.stringify(rows.map(({batchSize,wallMs,textsPerSecond,usefulTokens,paddedTokens})=>({batchSize,wallMs,textsPerSecond,usefulTokens,paddedTokens}))));
} finally {await adapter.dispose();}

```

## Final local validation

Implementation head: `3182a603c`. The required front gate passed:
format/ESLint, configuration budget, environment audit, generated-surface
freshness, command-surface audit, workflow contracts, and all 39 gate cases.
Gate: jobs=1, timeout=30s, retries=0, native redo=false; 82.9s total, slowest
case 9.22s, zero failures/timeouts/skips. Historical author-workspace receipt:
`.testLogs/run-1792029940908-d3s8lr`. Diff whitespace check passed.
The earlier environment/archive failures were repaired as recorded in the
[dependency/CI receipt](dependency-ci-reconciliation-2026-10-14.md).
The five-second wrapper failure and q8 parity limitation remain separate from
this passing gate. No push, hosted rerun, merge or bot-PR closure was performed.
