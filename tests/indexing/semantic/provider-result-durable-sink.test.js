import assert from 'node:assert/strict';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { combineSemanticProviderOutputs, dispatchToolingProviderResult } from '../../../src/index/tooling/result-dispatch.js';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';

// Authored regression; execution is deferred until the implementation batch is ready.
const f = await createRecoveryFixture('const value = 1;');
try {
  const syntax = await f.write([semanticNode(0, f.source.textLength)]);
  const original = createSemanticFactsRef({ source: f.source, partitions: [syntax],
    syntaxPartitionId: syntax.partitionId, storage: { generation: f.generation, relativePath: 'semantic' }, coverage: [] });
  const state = { semanticFactsByFile: new Map([['original.js', original]]), semanticCompilerContexts: [] };
  const runtime = { root: f.root, buildRoot: f.root };
  const context = { contextKey: 'c'.repeat(64), sourceUnits: [{ sourceUnitId: f.source.sourceUnitId, byteHash: f.source.byteHash }],
    providerId: 'fixture-external', providerVersion: '1', compilerVersion: null,
    configHash: 'd'.repeat(64), moduleResolutionHash: 'e'.repeat(64), vfsMappingHash: 'f'.repeat(64) };
  const evidence = { family: 'node', row: { id: 0, kind: 'evidence', span: [6, 11], scope: null,
    data: { method: 'fixture/binding', producerId: context.providerId, producerVersion: '1',
      evidenceKind: 'fixture-source-bound', sourceRef: f.source.sourceUnitId, artifactRef: null } } };
  const partition = await f.write([evidence], { partitionId: 'sa1:' + '1'.repeat(64), contextHash: context.contextKey });
  const output = { schemaVersion: 1, contexts: [context], partitions: [partition], coverageRef: null, diagnosticsRef: null };
  const result = { semanticFacts: [output, output], byChunkUid: new Map(), diagnostics: {}, symbolicTypeGraphs: [] };
  const noSink = await dispatchToolingProviderResult({ result });
  assert.equal(noSink.receipt.semantic.unused, 1);
  assert.equal(noSink.receipt.semantic.persisted, 0);
  const sink = createSemanticProviderResultSink({ state, runtime });
  const dispatched = await dispatchToolingProviderResult({ result, semanticSink: sink });
  assert.equal(dispatched.receipt.semantic.emitted, 2);
  assert.equal(dispatched.receipt.semantic.accepted, 1);
  assert.equal(dispatched.receipt.semantic.persisted, 1);
  assert.equal(dispatched.receipt.semantic.consumed, null, 'persistence does not imply query consumption');
  const selected = state.semanticFactsByFile.get('original.js');
  assert.equal(selected.partitions.length, 2, 'equivalent built-in and registered output ingest once');
  const detail = await createSemanticDetailService()({ store: f.store(selected.partitions), request: {
    repoRoot: f.root, generation: f.generation, refs: [{ partitionId: partition.partitionId, localId: 0 }]
  } });
  assert.equal(detail.records[0].kind, 'evidence');
  assert.equal(detail.records[0].data.producerId, 'fixture-external');
  assert.equal((await dispatchToolingProviderResult({ result, semanticSink: sink })).receipt.semantic.persisted, 0);
  const snapshot = state.semanticFactsByFile.get('original.js');
  const bad = structuredClone(output);
  bad.contexts[0].sourceUnits[0].byteHash = '0'.repeat(64);
  await assert.rejects(sink(bad), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  assert.equal(state.semanticFactsByFile.get('original.js'), snapshot);
  const conflict = structuredClone(output);
  conflict.partitions[0].canonicalHash = '2'.repeat(64);
  assert.throws(() => combineSemanticProviderOutputs([output, conflict]), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  const late = new AbortController(); late.abort();
  await assert.rejects(dispatchToolingProviderResult({ result, semanticSink: sink, signal: late.signal }), { name: 'AbortError' });
  await assert.rejects(sink(output, { signal: late.signal }), { name: 'AbortError' },
    'the host sink must observe request-local cancellation supplied by its dispatcher');
  const boundSink = createSemanticProviderResultSink({ state, runtime, signal: late.signal });
  await assert.rejects(boundSink(output, { signal: new AbortController().signal }), { name: 'AbortError' },
    'a request-local signal cannot override canceled build authority');
  assert.equal(state.semanticFactsByFile.get('original.js'), snapshot);
  const newSyntax = structuredClone(output);
  newSyntax.partitions[0].partitionId = 'sy1:' + '3'.repeat(64);
  await assert.rejects(sink(newSyntax), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  const unsupported = structuredClone(output); unsupported.diagnosticsRef = 'unadmitted.json';
  assert.throws(() => combineSemanticProviderOutputs([unsupported]), { code: 'ERR_TOOLING_UNSUPPORTED_OUTPUT' });
  console.log('provider result dispatch, immutable sink and source-bound detail contract');
} finally { await f.cleanup(); }
