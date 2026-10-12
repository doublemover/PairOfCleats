#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTypeIrArena, serializeTypeIr } from '../../../src/index/tooling/typescript/type-ir/index.js';
import { createSymbolicTypeGraph, normalizeTypeExpressions } from '../../../src/shared/symbolic-types.js';
import { normalizeProviderPayload } from '../../../src/index/tooling/provider-output-contract.js';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { runToolingPass } from '../../../src/index/type-inference-crossfile/tooling.js';
import { compactHit } from '../../../src/retrieval/cli/render-output.js';
import { buildMetaV2 } from '../../../src/index/metadata-v2.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-symbolic-payload-'));
try {
  const arena = createTypeIrArena({ contextKey: 'fixture-context' });
  const expression = arena.union([arena.literal('a'), arena.literal('b')]);
  const graph = createSymbolicTypeGraph(serializeTypeIr(arena, expression));
  const ref = { schemaVersion: 1, domain: 'finite-string', graphId: graph.graphId,
    contextKey: arena.contextKey, nodeId: expression.id };
  const typeExpressions = normalizeTypeExpressions({ schemaVersion: 1, interpretation: 'declared-type-denotation', returnType: ref,
    params: { value: [ref] }, declarationRef: { sourceId: 'input.ts', sourceHash: 'a'.repeat(64), start: 0, end: 40 },
    display: { returnType: 'Letters', signature: '(value: Letters): Letters', params: { value: ['Letters'] } } });
  const payload = normalizeProviderPayload({ typeExpressions });
  assert.deepEqual(payload.typeExpressions, typeExpressions);
  assert.equal(payload.returnType, undefined, 'presentation must not become a semantic string fact');
  assert.equal(payload.signature, undefined);
  const chunkUid = 'ck64:v1:fixture:input.ts:symbolic';
  const chunk = { chunkUid, chunkId: 'symbolic', file: 'input.ts', name: 'echo', kind: 'function',
    lang: 'typescript', ext: '.ts', start: 0, end: 40, docmeta: {} };
  const inputs = { documents: [{ virtualPath: 'input.ts', languageId: 'typescript',
    text: 'function echo(value: Letters): Letters {}', docHash: 'fixture-source' }], targets: [{ chunkRef: { docId: 0, chunkUid, chunkId: 'symbolic',
    file: 'input.ts', segmentUid: null, segmentId: null, range: { start: 0, end: 40 } },
  virtualPath: 'input.ts', virtualRange: { start: 0, end: 40 } }] };
  TOOLING_PROVIDERS.clear();
  registerToolingProvider({ id: 'symbolic-fixture', version: '1.0.0', kinds: ['types'],
    capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
    getConfigHash: () => 'symbolic-fixture', async run() {
      return { byChunkUid: { [chunkUid]: { payload: { typeExpressions } } }, symbolicTypeGraphs: [graph, graph] };
    } });
  const result = await runToolingProviders({ strict: true, toolingConfig: {}, cache: { enabled: false } }, inputs);
  assert.equal(result.symbolicTypeGraphs.length, 1, 'one graph is shared across provider output');
  assert.deepEqual(result.byChunkUid.get(chunkUid).payload.typeExpressions, typeExpressions);
  const pass = await runToolingPass({ rootDir: root, buildRoot: root, chunks: [chunk], entryByUid: new Map(),
    log: () => {}, toolingConfig: { enabledTools: ['symbolic-fixture'], cache: { enabled: false } }, toolingDocuments: inputs });
  assert.equal(pass.symbolicTypeGraphs.length, 1);
  assert.deepEqual(chunk.docmeta.typeExpressions, typeExpressions);
  assert.equal(chunk.docmeta.inferredTypes, undefined, 'alias display must not enter legacy inference');
  assert.equal(chunk.docmeta.returnType, undefined);
  assert.equal(chunk.docmeta.paramTypes, undefined);
  const metadata = buildMetaV2({ chunk, docmeta: chunk.docmeta, analysisPolicy: {} });
  assert.deepEqual(metadata.types.expressions, typeExpressions);
  assert.equal(metadata.returns, null);
  for (const hit of [chunk, { ...chunk, docmeta: null, metaV2: metadata }]) {
    const compact = compactHit(hit);
    assert.deepEqual(compact.typeExpressions, typeExpressions,
      'compact search preserves exact refs, declaration provenance, and interpretation for detail navigation');
    assert.deepEqual(compactHit(compact).typeExpressions, typeExpressions,
      'the output budget may compact an already compact hit without dropping refs');
    assert.equal(compact.docmeta, undefined);
    assert.equal(compact.returnType, undefined, 'display aliases do not become return-type facts');
  }

  TOOLING_PROVIDERS.clear();
  registerToolingProvider({ id: 'missing-graph', version: '1.0.0',
    capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
    getConfigHash: () => 'missing-graph', async run() { return { byChunkUid: { [chunkUid]: { payload: { typeExpressions } } } }; } });
  await assert.rejects(runToolingProviders({ strict: true, toolingConfig: {}, cache: { enabled: false } }, inputs),
    { code: 'ERR_TOOLING_REQUIRED_COMPUTATION_INCOMPLETE', reason: 'symbolic_type_missing' });
  console.log('symbolic meaning survives provider, docmeta and meta-v2 without display-string inference or graph duplication');
} finally {
  TOOLING_PROVIDERS.clear();
  await fs.rm(root, { recursive: true, force: true });
}
