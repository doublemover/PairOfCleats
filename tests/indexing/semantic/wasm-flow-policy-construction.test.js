import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { wasmModule, wasmSection } from '../../helpers/wasm-fixture.js';
import { collectStandaloneWasm } from '../../../src/index/semantic/wasm/standalone.js';
import { analyzeWasmModule } from '../../../src/index/semantic/wasm/flow.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/semantic/wasm-flow-policy-construction/')[1];
assert.ok(['off', 'deferred', 'unsupported-target', 'eager-budget', 'granted-budget', 'small-eager'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`wasm-policy-construction-${selected}`);
try {
  const small = selected === 'small-eager';
  const bytes = wasmModule({ types: [{ params: [], results: [] }],
    functions: [{ locals: small ? [] : Array(256).fill(0x7f), code: small ? [0x01]
      : Array.from({ length: 128 }, () => [0x02, 0x40, 0x0b]).flat() }],
    sections: [wasmSection(5, [1, 0, 1])], exports: [{ name: 'run', index: 0 }] });
  const generation = { baseBuildId: 'wasm-policy-fixture', semanticRevision: 0 }, storage = { generation, relativePath: 'semantic' };
  const basePolicy = normalizeSemanticConfig({ enabled: true, enrichment: { bindings: 'off', localFlow: 'eager', crossFileFlow: 'off' } });
  const collect = async (name, policy, flowGranted = false) => {
    const stagingRoot = path.join(dir, name);
    let calls = 0;
    const suppliedBytes = small ? new Uint8Array(bytes) : bytes;
    const result = await collectStandaloneWasm({ bytes: suppliedBytes, relPath: 'module.wasm', repositoryNamespace: 'fixture-wasm-policy', stagingRoot,
      storage, diskAccount: createSemanticDiskAccount(64 * 1024 * 1024), policy, flowGranted,
      analyzeWasm(module, options) {
        calls++; if (small) suppliedBytes[0] = 0xff;
        return analyzeWasmModule(module, options);
      } });
    const facts = result.semanticFactsRef;
    const store = createArtifactSemanticStore({ root: stagingRoot, repoRoot: dir, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      generation, partitions: facts.partitions });
    const syntaxRows = [], analysisRows = [], operands = [], edges = [];
    for (const partition of facts.partitions) {
      for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) {
        (partition.partitionId === facts.syntaxPartitionId ? syntaxRows : analysisRows).push(row);
      }
      for await (const row of store.iterateRows(partition.partitionId, 'semantic_operands')) operands.push(row);
      for await (const row of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(row);
    }
    assert.equal(result.semanticEvidenceArtifacts.length, 1, 'structure and flow share one retained binary/evidence sidecar');
    const evidence = JSON.parse(await fs.readFile(path.join(stagingRoot, result.semanticEvidenceArtifacts[0].path), 'utf8'));
    return { result, facts, syntaxRows, analysisRows, operands, edges, evidence, calls };
  };
  const offPolicy = { ...basePolicy, enrichment: { ...basePolicy.enrichment, localFlow: 'off' } };
  const baseline = await collect('baseline-off', offPolicy);
  assert.equal(baseline.calls, 0);
  const deferred = selected === 'deferred' || selected === 'granted-budget';
  const policy = selected === 'off' ? offPolicy : deferred ? { ...basePolicy, enrichment: { ...basePolicy.enrichment, localFlow: 'deferred' } }
    : selected === 'unsupported-target' ? { ...basePolicy, targets: [{ sourceUnitId: baseline.facts.sourceUnitId,
      sourceHash: baseline.facts.sourceHash, ref: { partitionId: baseline.facts.syntaxPartitionId, localId: 1 } }] } : basePolicy;
  const actual = await collect('selected', policy, selected === 'granted-budget');
  const attempted = ['eager-budget', 'granted-budget', 'small-eager'].includes(selected);
  assert.equal(actual.calls, Number(attempted), 'off/deferred/ineligible admission must precede analyzer construction');
  const counts = actual.result.wasmConstruction;
  assert.equal(counts.flowAttempted, attempted); assert.equal(counts.decodedInstructions, small ? 2 : 257);
  assert.equal(counts.instructions, small ? 2 : 257); assert.equal(counts.functions, 1); assert.equal(counts.storage, 1);
  assert.equal(actual.facts.syntaxPartitionId, baseline.facts.syntaxPartitionId);
  assert.equal(actual.facts.partitions.find(part => part.partitionId === actual.facts.syntaxPartitionId).canonicalHash,
    baseline.facts.partitions.find(part => part.partitionId === baseline.facts.syntaxPartitionId).canonicalHash);
  assert.deepEqual(actual.syntaxRows, baseline.syntaxRows, 'structural identity/content is independent of flow policy and outcome');
  assert.ok(actual.syntaxRows.every(row => !['block', 'value'].includes(row.kind)));
  assert.equal(actual.syntaxRows.filter(row => row.data?.astKind === 'WasmInstruction').length, small ? 2 : 257);
  assert.deepEqual(Buffer.from(actual.evidence.bytesBase64, 'base64'), bytes);
  assert.equal(actual.evidence.kind, 'wasm-binary-structure');
  assert.equal(actual.evidence.producerVersion, SEMANTIC_ANALYSIS_VERSIONS.wasmStructure);
  const fn = actual.evidence.records.find(row => row.kind === 'function'), memory = actual.evidence.records.find(row => row.storageKind === 'memory');
  assert.equal(fn.byteRange[1], bytes.length);
  assert.equal(bytes[fn.byteRange[0]], small ? 0 : 0x80, 'body range starts at its actual local-declaration vector');
  assert.deepEqual([...bytes.subarray(...memory.byteRange)], [0, 1], 'memory descriptor range retains actual limits bytes');
  for (const instruction of actual.evidence.records.filter(row => row.kind === 'instruction')) {
    const [start, end] = instruction.byteRange;
    assert.ok(start >= fn.byteRange[0] && end <= fn.byteRange[1] && end > start);
    assert.ok([0x01, 0x02, 0x0b].includes(bytes[start]));
  }
  const coverage = actual.facts.coverage.find(row => row.phase === 'localFlow');
  if (!attempted) {
    assert.equal(counts.flowNodesAllocated, 0); assert.equal(counts.flowEdgesConstructed, 0);
    assert.equal(actual.analysisRows.length, 0); assert.equal(actual.edges.length, 0); assert.equal(actual.operands.length, 0);
    assert.equal(coverage.state, selected === 'off' ? 'disabled' : selected === 'deferred' ? 'deferred' : 'unsupported');
    assert.ok(!coverage.reason.includes('wasm_flow_graph_budget'));
  } else if (!small) {
    assert.equal(coverage.state, 'partial'); assert.equal(coverage.reason, 'wasm_flow_graph_budget');
    assert.ok(counts.flowNodesAllocated > 32000); assert.equal(counts.retainedFlowNodes, 0);
    assert.equal(actual.analysisRows.length, 0, 'failed flow cannot leave a partial derived graph');
  } else {
    assert.ok(counts.retainedFlowNodes > 0); assert.ok(actual.edges.length > 0);
    assert.ok(actual.analysisRows.some(row => row.kind === 'block'));
    const valid = new Set([...actual.syntaxRows.map(row => `${actual.facts.syntaxPartitionId}:${row.id}`),
      ...actual.facts.partitions.filter(part => part.partitionId !== actual.facts.syntaxPartitionId)
        .flatMap(part => actual.analysisRows.map(row => `${part.partitionId}:${row.id}`))]);
    for (const edge of actual.edges) for (const ref of [edge.from, edge.to, edge.evidence]) assert.ok(valid.has(`${ref.partitionId}:${ref.localId}`));
  }
  const receipt = { selected, inputBytes: bytes.length,
    sourceHash: actual.facts.sourceHash, producers: SEMANTIC_ANALYSIS_VERSIONS,
    runtime: { node: process.version, v8: process.versions.v8, abi: process.versions.modules, platform: process.platform, arch: process.arch },
    baseline: baseline.result.wasmConstruction, selectedCounts: counts, analyzerCalls: actual.calls,
    qualification: 'construction-counters-only; no-heap-or-throughput-claim' };
  await fs.writeFile(path.join(dir, 'construction.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log(`WASM ${selected} preserves stable structural facts and admits only requested flow construction`);
