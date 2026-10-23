import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { prepareScipSemanticImport, loadScipSemanticSources, writeScipSemanticImport } from '../../../src/index/tooling/scip-semantic-import.js';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';

const f = await createRecoveryFixture('value value value');
try {
  const syntax = await f.write([
    ...[[0, 5], [6, 11]].map((span, id) => ({ family: 'node', row: { id, kind: 'declaration', span, scope: null,
      data: { nameId: 0, declarationKind: 'fixture-binding', flags: [], initializer: null, typeSyntax: null } } })),
    { family: 'node', row: { id: 2, kind: 'occurrence', span: [12, 17], scope: null,
      data: { nameId: 0, roles: ['reference'], expression: null, flags: [] } } },
    { family: 'lookup', row: { kind: 'name', id: 0, value: 'value' } }
  ]);
  const facts = createSemanticFactsRef({ source: f.source, syntaxPartitionId: syntax.partitionId, partitions: [syntax],
    storage: { generation: f.generation, relativePath: 'semantic' }, coverage: [] });
  const state = { semanticFactsByFile: new Map([['original.js', facts]]), semanticCompilerContexts: [],
    semanticDiskAccount: f.account, semanticEvidenceArtifacts: [] };
  const runtime = { root: f.root, buildRoot: f.root };
  const admittedSources = await loadScipSemanticSources({ state, runtime });
  const symbol = 'scip npm fixture 1 value().';
  const indexFor = definitions => ({ metadata: { projectRoot: 'file:///producing-root/' }, documents: [{
    relativePath: 'original.js', positionEncoding: 2, symbols: [{ symbol, relationships: [] }],
    occurrences: [...definitions.map(range => ({ symbol, symbolRoles: 1, range })),
      { symbol, symbolRoles: 0, range: [0, 12, 17] }]
  }] });
  const prepare = index => {
    const bytes = Buffer.from(JSON.stringify(index));
    const producingReceipt = { schemaVersion: 1, artifactHash: createHash('sha256').update(bytes).digest('hex'),
      profileHash: 'a'.repeat(64), repositoryNamespace: f.source.repositoryNamespace, generation: f.generation,
      projectVariant: 'debug', producerRoot: index.metadata.projectRoot, sources: [{ documentPath: 'original.js',
        sourceUnitId: f.source.sourceUnitId, byteHash: f.source.byteHash, syntaxPartitionId: syntax.partitionId,
        syntaxHash: syntax.canonicalHash, mappingIdentity: null }] };
    return prepareScipSemanticImport({ bytes, producingReceipt,
      expectedReceiptHash: semanticHash('tooling.scip-producing-receipt.v1', producingReceipt),
      generation: f.generation, repositoryNamespace: f.source.repositoryNamespace, projectVariant: 'debug',
      producerRoot: index.metadata.projectRoot, admittedSources });
  };
  const write = async prepared => {
    const result = await writeScipSemanticImport({ prepared, state, policy: normalizeSemanticConfig({ enabled: true }),
      semanticSink: createSemanticProviderResultSink({ state, runtime }) });
    const store = f.store(state.semanticFactsByFile.get('original.js').partitions), rows = [], edges = [];
    const partitionId = result.output.partitions[0].partitionId;
    for await (const row of store.iterateRows(partitionId, 'semantic_records')) rows.push(row);
    for await (const row of store.iterateRows(partitionId, 'semantic_edges')) edges.push(row);
    const binding = rows.find(row => row.kind === 'binding');
    const detail = await createSemanticDetailService()({ store, request: { repoRoot: f.root, generation: f.generation,
      refs: [{ partitionId, localId: binding.id }] } });
    return { result, rows, edges, binding, detail };
  };

  const exact = prepare(indexFor([[0, 0, 5]]));
  assert.equal(exact.status, 'admitted');
  assert.deepEqual(exact.documents[0].occurrences[0].declarationRefs, [{ partitionId: syntax.partitionId, localId: 0 }]);
  const exactWritten = await write(exact);
  assert.equal(exactWritten.binding.data.status, 'resolved');
  assert.equal(exactWritten.detail.records[0].data.candidateCount, 1);

  const substring = prepare(indexFor([[0, 1, 4]]));
  assert.equal(substring.status, 'partial');
  assert.equal(substring.omitted, 1, 'an unjoined definition is an explicit omitted observation');
  assert.deepEqual(substring.documents[0].occurrences[0].declarationRefs, [], 'a partial identifier is not the parser declaration');
  const substringWritten = await write(substring);
  assert.equal(substringWritten.binding.data.status, 'heuristic');
  assert.equal(substringWritten.edges.some(edge => edge.kind === 'evidenceInput'), false);
  assert.equal(substringWritten.edges.some(edge => edge.to.partitionId === syntax.partitionId && edge.to.localId === 0), false,
    'contained source range cannot acquire an exact persisted declaration target');
  assert.equal(substringWritten.detail.records[0].data.status, 'heuristic');

  const multiple = prepare(indexFor([[0, 0, 5], [0, 6, 11]]));
  const multipleWritten = await write(multiple);
  assert.equal(multipleWritten.binding.data.status, 'ambiguous');
  assert.equal(multipleWritten.binding.data.candidateCount, 2);
  const byId = new Map(multipleWritten.rows.map(row => [row.id, row]));
  const ownInputs = multipleWritten.edges.filter(edge => edge.kind === 'evidenceInput');
  assert.equal(ownInputs.length, 2, 'each definition contributes evidence to its own occurrence, not every same-symbol definition');
  for (const edge of ownInputs) {
    assert.equal(edge.to.partitionId, syntax.partitionId);
    assert.deepEqual(byId.get(edge.from.localId).span, edge.to.localId === 0 ? [0, 5] : [6, 11]);
  }
} finally { await f.cleanup(); }
console.log('SCIP exact parser declaration joins, per-definition evidence and retained detail controls passed');
