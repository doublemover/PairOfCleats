import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { prepareScipSemanticImport, loadScipSemanticSources, writeScipSemanticImport, SCIP_SEMANTIC_IMPORT_VERSION } from '../../../src/index/tooling/scip-semantic-import.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';

const f = await createRecoveryFixture('😀 value value');
try {
  const syntax = await f.write([
    { family: 'node', row: { id: 0, kind: 'declaration', span: [3, 8], scope: null,
      data: { nameId: 0, declarationKind: 'fixture-function', flags: [], initializer: null, typeSyntax: null } } },
    { family: 'node', row: { id: 1, kind: 'occurrence', span: [9, 14], scope: null,
      data: { nameId: 0, roles: ['reference'], expression: null, flags: [] } } },
    { family: 'lookup', row: { kind: 'name', id: 0, value: 'value' } }
  ]);
  const facts = createSemanticFactsRef({ source: f.source, syntaxPartitionId: syntax.partitionId, partitions: [syntax],
    storage: { generation: f.generation, relativePath: 'semantic' }, coverage: [] });
  const state = { semanticFactsByFile: new Map([['original.js', facts]]), semanticCompilerContexts: [],
    semanticDiskAccount: f.account, semanticEvidenceArtifacts: [] };
  const runtime = { root: f.root, buildRoot: f.root };
  const admittedSources = await loadScipSemanticSources({ state, runtime });
  await assert.rejects(loadScipSemanticSources({ state: { ...state,
    semanticFactsByFile: new Map([['original.js', { ...facts, sourceHash: '0'.repeat(64) }]]) }, runtime }),
  { code: 'ERR_SCIP_IMPORT_IDENTITY' }, 'retained byte identity must still join the current parser facts');
  const index = { metadata: { projectRoot: 'file:///producing-root/', toolInfo: { name: 'scip-fixture', version: '1' } },
    documents: [{ relativePath: 'original.js', positionEncoding: 2, symbols: [{ symbol: 'scip npm fixture 1 value().', relationships: [] }],
      occurrences: [{ symbol: 'scip npm fixture 1 value().', symbolRoles: 1, range: [0, 3, 8] },
        { symbol: 'scip npm fixture 1 value().', symbolRoles: 0, range: [0, 9, 14] }] }] };
  const receiptFor = value => ({ schemaVersion: 1, artifactHash: createHash('sha256').update(Buffer.from(JSON.stringify(value))).digest('hex'),
    profileHash: 'a'.repeat(64), repositoryNamespace: f.source.repositoryNamespace, generation: f.generation,
    projectVariant: 'debug', producerRoot: index.metadata.projectRoot, sources: [{ documentPath: 'original.js', sourceUnitId: f.source.sourceUnitId,
      byteHash: f.source.byteHash, syntaxPartitionId: syntax.partitionId, syntaxHash: syntax.canonicalHash, mappingIdentity: null }] });
  const prepare = (value, receipt = receiptFor(value)) => prepareScipSemanticImport({ bytes: Buffer.from(JSON.stringify(value)),
    producingReceipt: receipt, expectedReceiptHash: semanticHash('tooling.scip-producing-receipt.v1', receipt),
    generation: f.generation, repositoryNamespace: f.source.repositoryNamespace, projectVariant: 'debug', producerRoot: index.metadata.projectRoot, admittedSources });
  for (const [positionEncoding, definition, reference] of [[1, [0, 5, 10], [0, 11, 16]], [2, [0, 3, 8], [0, 9, 14]], [3, [0, 2, 7], [0, 8, 13]]]) {
    const variant = structuredClone(index); variant.documents[0].positionEncoding = positionEncoding;
    variant.documents[0].occurrences[0].range = definition; variant.documents[0].occurrences[1].range = reference;
    assert.deepEqual(prepare(variant).documents[0].occurrences[0].span, [3, 8]);
  }
  const prepared = prepare(index);
  assert.deepEqual(prepared.adapterIdentity, { version: SCIP_SEMANTIC_IMPORT_VERSION, sourceCoordinates: SEMANTIC_ANALYSIS_VERSIONS.lspBindings });
  const splitScalar = structuredClone(index);
  splitScalar.documents[0].occurrences.push({ symbol: 'scip npm fixture 1 value().', symbolRoles: 0, range: [0, 0, 1] });
  assert.equal(prepare(splitScalar).rejected, 1, 'UTF16 roundtrip alone cannot admit half of the leading emoji');
  const oldMeaning = { ...prepared, adapterIdentity: { ...prepared.adapterIdentity, sourceCoordinates: 'old-coordinate-meaning' } };
  await assert.rejects(writeScipSemanticImport({ prepared: oldMeaning }), { code: 'ERR_SCIP_IMPORT_IDENTITY' });
  const legacyMeaning = { ...prepared }; delete legacyMeaning.adapterIdentity;
  await assert.rejects(writeScipSemanticImport({ prepared: legacyMeaning }), { code: 'ERR_SCIP_IMPORT_IDENTITY' });
  const result = await writeScipSemanticImport({ prepared, state, policy: normalizeSemanticConfig({ enabled: true }),
    semanticSink: createSemanticProviderResultSink({ state, runtime }) });
  assert.equal(result.persisted, 1);
  assert.equal(result.output.contexts[0].providerVersion, SCIP_SEMANTIC_IMPORT_VERSION);
  const store = f.store(state.semanticFactsByFile.get('original.js').partitions), records = [];
  for await (const row of store.iterateRows(result.output.partitions[0].partitionId, 'semantic_records')) records.push(row);
  const binding = records.find(row => row.kind === 'binding');
  assert.equal(binding.data.status, 'resolved');
  assert.ok(records.filter(row => row.kind === 'evidence').every(row => row.data.producerVersion === SCIP_SEMANTIC_IMPORT_VERSION));
  const detail = await createSemanticDetailService()({ store, request: { repoRoot: f.root, generation: f.generation,
    refs: [{ partitionId: result.output.partitions[0].partitionId, localId: binding.id }] } });
  assert.equal(detail.records[0].data.candidateCount, 1);
  const stale = receiptFor(index); stale.sources[0].byteHash = '0'.repeat(64);
  assert.throws(() => prepare(index, stale), { code: 'ERR_SCIP_IMPORT_IDENTITY' });
  const escape = structuredClone(index); escape.documents[0].relativePath = '../escape.js';
  assert.throws(() => prepare(escape), { code: 'ERR_SCIP_IMPORT_IDENTITY' });
  const ambiguous = structuredClone(index); ambiguous.documents[0].positionEncoding = 0;
  assert.throws(() => prepare(ambiguous), { code: 'ERR_SCIP_IMPORT_IDENTITY' });
  const unknown = prepareScipSemanticImport({ bytes: Buffer.from(JSON.stringify(index)), producingReceipt: null });
  assert.equal(unknown.status, 'non-authoritative');
  assert.equal((await writeScipSemanticImport({ prepared: unknown })).persisted, 0);
  console.log('SCIP source receipt, exact UTF-8/16/32 ranges, canonical sink and binding detail');
} finally { await f.cleanup(); }
