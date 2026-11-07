import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { wasmModule } from '../../helpers/wasm-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { collectStandaloneWasm } from '../../../src/index/semantic/wasm/standalone.js';
import { analyzeWasmModule } from '../../../src/index/semantic/wasm/flow.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';

const { dir } = await prepareIsolatedTestCacheDir('wasm-construction-scaling');
const samples = [];
try {
  for (const [locals, blocks] of [[0, 0], [16, 8], [64, 16], [256, 128]]) {
    const bytes = wasmModule({ types: [{ params: [], results: [] }], functions: [{ locals: Array(locals).fill(0x7f),
      code: Array.from({ length: blocks }, () => [0x02, 0x40, 0x0b]).flat() }], exports: [{ name: 'run', index: 0 }] });
    let baseline;
    for (const mode of ['off', 'deferred', 'eager']) {
      let analyzerCalls = 0;
      const result = await collectStandaloneWasm({ bytes, relPath: 'module.wasm', repositoryNamespace: 'wasm-construction-samples',
        stagingRoot: path.join(dir, `${locals}-${blocks}-${mode}`), storage: {
          generation: { baseBuildId: 'construction-samples', semanticRevision: 0 }, relativePath: 'semantic' },
        diskAccount: createSemanticDiskAccount(64 * 1024 * 1024),
        policy: normalizeSemanticConfig({ enabled: true, enrichment: { bindings: 'off', localFlow: mode, crossFileFlow: 'off' } }),
        analyzeWasm(module, options) { analyzerCalls++; return analyzeWasmModule(module, options); } });
      const counts = result.wasmConstruction, facts = result.semanticFactsRef;
      assert.equal(counts.decodedInstructions, blocks * 2 + 1);
      assert.equal(counts.instructions, blocks * 2 + 1);
      assert.equal(analyzerCalls, Number(mode === 'eager'));
      if (mode !== 'eager') {
        assert.equal(counts.flowNodesAllocated, 0); assert.equal(counts.flowEdgesConstructed, 0);
        assert.equal(counts.flowAttempted, false);
      } else {
        assert.equal(counts.flowAttempted, true); assert.ok(counts.flowNodesAllocated > 0);
      }
      const syntax = facts.partitions.find(part => part.partitionId === facts.syntaxPartitionId);
      if (!baseline) baseline = { sourceHash: facts.sourceHash, syntaxPartitionId: facts.syntaxPartitionId, canonicalHash: syntax.canonicalHash };
      else assert.deepEqual({ sourceHash: facts.sourceHash, syntaxPartitionId: facts.syntaxPartitionId, canonicalHash: syntax.canonicalHash }, baseline,
        'same retained structural evidence is compared across all phase policies');
      samples.push({ locals, blocks, inputBytes: bytes.length, sourceHash: facts.sourceHash, mode, analyzerCalls, counts });
    }
  }
  const eager = samples.filter(row => row.mode === 'eager');
  assert.ok(eager.at(-1).counts.flowNodesAllocated > eager.at(-2).counts.flowNodesAllocated * 10,
    'the largest admitted input must exercise substantially more solver construction');
  console.log(JSON.stringify({ qualification: 'serial-synthetic-work-and-construction-counters; no throughput/RSS claim',
    runtime: process.version, producers: { structure: SEMANTIC_ANALYSIS_VERSIONS.wasmStructure, flow: SEMANTIC_ANALYSIS_VERSIONS.wasmFlow }, samples }));
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Increasing WASM locals/blocks retain equal structural evidence while off/deferred avoid measured flow construction.');
