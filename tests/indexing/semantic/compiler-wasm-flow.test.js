import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SEMANTIC_ANALYSIS_VERSIONS, WASM_VALIDATOR_RUNTIME, semanticAnalysisPolicyIdentity } from '../../../src/index/semantic/analysis-versions.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { collectCompilerBoundaryFlow } from '../../../src/index/semantic/compiler-boundary-flow.js';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { wasmHostFixture, wasmModule } from '../../helpers/wasm-fixture.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-wasm-'));
const bytes = 'new Uint8Array([' + [...wasmHostFixture()].join(',') + '])';
const identity = 'new Uint8Array([' + [...wasmModule({ functions: [{ code: [0x20, 0] }], exports: [{ name: 'run', index: 0 }] })].join(',') + '])';
try {
  const fixture = await createCompilerBoundaryFixture(root, {
    'input.ts': `export {}; const chosen = (x:number) => x+1; const unused = (x:number) => x-1;
      const module = new WebAssembly.Module(${bytes});
      const instance = new WebAssembly.Instance(module, {env:{chosen, unused}});
      const alias = instance; const result = alias.exports["run"](17);
      instance.exports["missing"](18);
      const second = new WebAssembly.Instance(module, {env:{chosen:unused}}); second.exports.run(19);
      const asyncResult = await WebAssembly.instantiate(${identity}); asyncResult.instance.exports.run(20);
      const compiled = await WebAssembly.compile(${identity});
      const asyncInstance = await WebAssembly.instantiate(compiled); asyncInstance.exports.run(21);`,
    'dynamic.ts': `export {}; declare const bytes: Uint8Array; const dynamic = new WebAssembly.Instance(new WebAssembly.Module(bytes)); dynamic.exports.run(1);
      const mutableBytes = ${identity}; mutableBytes[0]=4; const mutable = new WebAssembly.Instance(new WebAssembly.Module(mutableBytes)); mutable.exports.run(2);
      declare const instance: WebAssembly.Instance; instance.exports.run(3);`,
    'fake.ts': `export {}; const WebAssembly = { Module: class { constructor(x:any){} }, Instance: class { exports={run:(x:number)=>x}; constructor(x:any){} } }; const fake = new WebAssembly.Instance(new WebAssembly.Module(${identity})); fake.exports.run(1);`,
    'fake-bytes.ts': `export {}; class Uint8Array { constructor(x:any){} } const fake = new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]) as any);`,
    'bad-imports.ts': `export {}; const fn = (x:number)=>x; const m = new WebAssembly.Module(${bytes}); const imports={chosen:fn};
      const a = new WebAssembly.Instance(m, {env:{...imports}}); a.exports.run(1);
      const b = new WebAssembly.Instance(m, {env:{chosen:fn, chosen:(x:number)=>x+1}}); b.exports.run(2);`,
    'mutated-instance.ts': `export {}; const result = await WebAssembly.instantiate(${identity}); declare const replacement: WebAssembly.Instance; result.instance = replacement; result.instance.exports.run(1);`,
    'malformed.ts': 'export {}; new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0,1,255]));'
  });
  const { group, state, policy, documents, syntaxPartitions, storeFor, stagingRoot } = fixture;
  assert.equal(semanticAnalysisPolicyIdentity(policy), semanticHash('semantic.analysis-policy.v2', {
    enrichment: policy.enrichment, targets: policy.targets, producers: SEMANTIC_ANALYSIS_VERSIONS,
    wasmValidatorRuntime: WASM_VALIDATOR_RUNTIME, overrides: []
  }), 'derived replay identity includes the validating runtime');
  const partitions = await collectCompilerBoundaryFlow({ group, state, policy });
  const store = storeFor([...syntaxPartitions, ...partitions]), records = new Map(), edges = [], operands = [], coverages = [];
  const key = ref => ref.partitionId + ':' + ref.localId;
  for (const partition of [...syntaxPartitions, ...partitions]) {
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) records.set(key({ partitionId: partition.partitionId, localId: row.id }), { ...row, source: partition.sourceUnitId });
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(row);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_operands')) operands.push(row);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_coverage')) coverages.push(row);
  }
  const row = ref => records.get(key(ref));
  const wasm = [...records.values()].filter(row => row.data.astKind === 'WasmInstruction');
  assert.ok(wasm.length > 0, 'real binary instructions published');
  assert.ok(operands.some(operand => row(operand.parent)?.data.astKind === 'WasmInstruction' && row(operand.parent).data.operation === 'call' && operand.slot === 'argument' && operand.ordinal === 0), 'stack inputs use shared detail/trace operand slots');
  assert.ok(wasm.every(row => row.span === null), 'byte offsets never masquerade as UTF16 source spans');
  const exportLinks = edges.filter(edge => edge.kind === 'callTarget' && row(edge.from)?.data.boundaryKind === 'wasm-export-entry-request');
  assert.equal(exportLinks.length, 6, 'sync aliases, separate instances and both awaited instantiate overloads retain decoded export targets even when host imports are unresolved');
  assert.ok(exportLinks.every(edge => edge.certainty === 'exact-static' && row(edge.to).data.boundaryKind === 'wasm-module-function'));
  assert.notDeepEqual(exportLinks[0].to, exportLinks[1].to, 'instances keep separate host-import channels');
  const importLinks = edges.filter(edge => edge.kind === 'callTarget' && row(edge.from)?.data.boundaryKind === 'wasm-module-import-function');
  assert.equal(importLinks.length, 2, 'only the exact decoded import name joins; unused/spread/duplicate namespaces do not');
  const input = documents.find(doc => doc.item.file === 'input.ts');
  assert.equal(exportLinks.filter(edge => row(edge.from).source === input.item.source.sourceUnitId).length, 4);
  const targets = importLinks.map(edge => { const span = row(edge.to).span; return input.sourceFile.text.slice(...span); });
  assert.ok(targets.includes('(x:number) => x+1')); assert.ok(targets.includes('(x:number) => x-1'));
  assert.ok(edges.some(edge => edge.kind === 'argumentToParameter' && row(edge.from)?.data.origin === 'parameter' && row(edge.to)?.span));
  assert.ok(edges.some(edge => edge.kind === 'returnToResult' && row(edge.from)?.data.origin === 'return' && row(edge.to)?.span));
  const negativeSources = documents.filter(doc => ['dynamic.ts','fake.ts','fake-bytes.ts','malformed.ts'].includes(doc.item.file)).map(doc => doc.item.source.sourceUnitId);
  assert.ok(wasm.every(row => !negativeSources.includes(row.source)), 'unknown/mutable/invalid bytes and fake libraries never decode');
  const mutated = documents.find(doc => doc.item.file === 'mutated-instance.ts').item.source.sourceUnitId;
  assert.ok(exportLinks.every(edge => row(edge.from).source !== mutated));
  assert.ok(coverages.some(row => row.reason?.includes('wasm_instantiation_result_mutation_or_escape')));
  assert.ok(coverages.some(row => row.reason?.includes('wasm_export_function_name_missing')));
  assert.ok(coverages.some(row => row.reason?.includes('wasm_import_exact_host_target_unresolved')));
  const evidenceRows = [...records.values()].filter(row => row.kind === 'evidence' && row.data.producerId === 'semantic-wasm');
  assert.ok(evidenceRows.length);
  for (const evidence of evidenceRows) {
    const value = JSON.parse(await fs.readFile(path.join(stagingRoot, evidence.data.artifactRef), 'utf8'));
    assert.equal(value.coordinateUnit, 'byte');
    assert.equal(value.validatorRuntime, WASM_VALIDATOR_RUNTIME);
    assert.ok(value.records.every(record => records.has(key(record.ref))));
    assert.equal(Buffer.from(value.bytesBase64, 'base64').length, value.byteLength);
    assert.ok(state.semanticEvidenceArtifacts.some(item => item.path === evidence.data.artifactRef));
  }
  const repeated = await collectCompilerBoundaryFlow({ group: { ...group, workerDocuments: [...documents].reverse() }, state, policy });
  assert.deepEqual(repeated.map(partition => partition.canonicalHash).sort(), partitions.map(partition => partition.canonicalHash).sort());
  console.log('WASM exact host/module links, provenance rejection and persisted binary evidence passed');
} finally { await fs.rm(root, { recursive: true, force: true }); }
