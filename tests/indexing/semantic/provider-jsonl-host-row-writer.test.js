import assert from 'node:assert/strict';
import path from 'node:path';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { loadScipSemanticSources } from '../../../src/index/tooling/scip-semantic-import.js';
import { observeProviderProfile } from '../../../src/index/tooling/provider-profile.js';
import { createCanonicalProviderRequest, createCanonicalProviderRowWriter } from '../../../src/index/tooling/provider-row-writer.js';
import { importProviderJsonlReport } from '../../../src/index/tooling/provider-jsonl.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';

const f = await createRecoveryFixture('value value');
try {
  const syntax = await f.write([
    { family: 'node', row: { id: 0, kind: 'declaration', span: [0, 5], scope: null,
      data: { nameId: 0, declarationKind: 'fixture-value', flags: [], initializer: null, typeSyntax: null } } },
    { family: 'node', row: { id: 1, kind: 'occurrence', span: [6, 11], scope: null,
      data: { nameId: 0, roles: ['reference'], expression: null, flags: [] } } },
    { family: 'lookup', row: { kind: 'name', id: 0, value: 'value' } }
  ]);
  const facts = createSemanticFactsRef({ source: f.source, syntaxPartitionId: syntax.partitionId, partitions: [syntax],
    storage: { generation: f.generation, relativePath: 'semantic' }, coverage: [] });
  const state = { semanticFactsByFile: new Map([['original.js', facts]]), semanticCompilerContexts: [], semanticDiskAccount: f.account };
  const runtime = { root: f.root, buildRoot: f.root }, sources = await loadScipSemanticSources({ state, runtime });
  const selectedCommand = [path.join(f.root, 'original.js')];
  const profile = await observeProviderProfile({ repoRoot: f.root, providerId: 'fixture-rows', adapterVersion: '1',
    apiProfile: 'authored-fixture-only', configuredCommand: selectedCommand, resolvedCommand: selectedCommand,
    toolFiles: [{ path: 'original.js' }], sourceInputs: [{ path: 'original.js', hash: f.source.byteHash }], dependencyClosure: 'complete' });
  const request = createCanonicalProviderRequest({ profile, requestId: 'row-report', generation: f.generation, sources });
  const target = request.targets[0];
  const row = { family: 'node', row: { id: 0, kind: 'evidence', span: [6, 11], scope: null,
    data: { method: 'fixture/row', producerId: 'fixture-rows', producerVersion: '1', evidenceKind: 'authored-row',
      sourceRef: f.source.sourceUnitId, artifactRef: null } } };
  const report = { schemaVersion: 1, kind: 'canonical-rows-v1', batches: [{ sourceUnitId: target.sourceUnitId, rows: [row] }] };
  const messages = [
    { type: 'hello', protocolVersion: 1, requestId: request.requestId, requestHash: semanticHash('tooling.jsonl-request.v1', request) },
    { type: 'batch', requestId: request.requestId, sequence: 0, semanticRows: report.batches[0] },
    { type: 'final', requestId: request.requestId, complete: true, batchCount: 1, partitionCount: 1,
      outputHash: semanticHash('tooling.jsonl-rows.v1', report) }
  ];
  const encode = values => Buffer.from(values.map(value => JSON.stringify(value)).join('\n') + '\n');
  const policy = normalizeSemanticConfig({ enabled: true });
  const writer = createCanonicalProviderRowWriter({ request, profile, sources, state, policy });
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(writer(report, { signal: aborted.signal }), { name: 'AbortError' },
    'request-local abort reaches the host materializer before consuming its one completed report');
  const result = await importProviderJsonlReport({ chunks: [encode(messages)], request, rowWriter: writer,
    semanticSink: createSemanticProviderResultSink({ state, runtime }) });
  assert.equal(result.admission.persisted, 1);
  const selected = state.semanticFactsByFile.get('original.js');
  const detail = await createSemanticDetailService()({ store: f.store(selected.partitions), request: { repoRoot: f.root,
    generation: f.generation, refs: [{ partitionId: target.partitionId, localId: 0 }] } });
  assert.equal(detail.records[0].data.producerId, 'fixture-rows');
  await assert.rejects(writer(report), { code: 'ERR_TOOLING_PROVIDER_ROWS' });
  const unsafe = structuredClone(report); unsafe.batches[0].rows = [{ family: 'node', row: { id: 0, kind: 'declaration' } }];
  const freshWriter = createCanonicalProviderRowWriter({ request, profile, sources, state, policy });
  await assert.rejects(freshWriter(unsafe), { code: 'ERR_TOOLING_PROVIDER_ROWS' });
  const canceledBuildWriter = createCanonicalProviderRowWriter({ request, profile, sources, state, policy, signal: aborted.signal });
  await assert.rejects(canceledBuildWriter(report, { signal: new AbortController().signal }), { name: 'AbortError' },
    'transport-local authority cannot replace an aborted build writer');
  console.log('complete JSONL rows through host disk accounting, immutable sink and semantic detail');
} finally { await f.cleanup(); }
