import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createAnalysisPartitionId, canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { projectRetainedSemanticRoleView } from '../../../src/graph/analogy/retained-semantic-view.js';
import { findSourceMotifs, materializeSourceMotifLens } from '../../../src/graph/analogy/source-motifs.js';

// Authored only: synthetic parser/analysis rows through real writer/store/index.
const f = await createRecoveryFixture('left(); right(); function target() {}');
try {
  const expression = (id, span) => ({ ...semanticNode(id, f.source.textLength), row: {
    ...semanticNode(id, f.source.textLength).row, span
  } });
  const syntax = await f.write([expression(0, [0, 6]), expression(1, [8, 15]),
    { family: 'node', row: { id: 2, kind: 'declaration', span: [17, f.source.textLength], scope: null,
      data: { nameId: 0, declarationKind: 'function', flags: [], initializer: null, typeSyntax: null } } },
    { family: 'lookup', row: { kind: 'name', id: 0, value: 'target' } }]);
  const contextKey = 'fixture-context';
  const partitionId = createAnalysisPartitionId({ pass: { name: 'fixture-motif-calls', version: '1' },
    inputPartitionHashes: [syntax.canonicalHash], compilerContext: contextKey,
    dependencySummaryHashes: [], analysisPolicy: {} });
  const ref = localId => ({ partitionId: syntax.partitionId, localId });
  const edge = (id, from, certainty, context = contextKey, condition = null) => ({ family: 'edge', row: {
    id, kind: 'callTarget', from: ref(from), to: ref(2), callSite: ref(from), operandOrdinal: null,
    contextKey: context, condition, evidence: null, certainty
  } });
  const analysis = await f.write([edge(0, 0, 'exact-static'), edge(1, 1, 'modeled'),
    edge(2, 0, 'heuristic', contextKey, ref(0)), edge(3, 1, 'exact-static', 'other-context')],
  { partitionId, contextHash: 'c'.repeat(64) });
  const partitions = [syntax, analysis];
  const queryIndex = await writeSemanticQueryIndex({ root: f.stagingRoot, generation: f.generation,
    partitions, store: f.store(partitions), diskAccount: f.account });
  const store = f.store(partitions, { queryIndex });
  const world = { generation: f.generation, repositoryNamespace: f.root, contextKey };
  const nodes = [{ ref: ref(0), roles: ['leftCall'] }, { ref: ref(1), roles: ['rightCall'] },
    { ref: ref(2), roles: ['target'] }];
  const projected = await projectRetainedSemanticRoleView({ store, world, nodes });
  assert.equal(projected.projection, 'retained-canonical-semantic-records/v1');
  assert.equal(projected.truncated, false);
  assert.ok(projected.retainedMetadataBytes > 0 && projected.retainedMetadataBytes <= 4 * 1024 * 1024);
  assert.equal(projected.otherContextEdges, 1);
  assert.equal(projected.evidence.length, 3, 'parallel target observations retain their distinct original evidence');
  assert.equal(projected.normalization.status, 'checked-in-model');
  assert.equal(projected.normalization.plan, 'checked-alternative');
  assert.equal(projected.normalization.ordering, 'not-observed');
  assert.equal(new Set(projected.evidence.map(row => row.id)).size, 3);
  assert.ok(projected.evidence.some(row => row.edge.condition !== null));
  const matches = findSourceMotifs({ view: projected.view, motifId: 'shared-call-target/v1' });
  assert.equal(matches.matches.length, 1);
  const match = matches.matches[0];
  assert.equal(match.relationWitnesses[0].relations.length, 2);
  assert.ok(match.relationWitnesses[0].relations.some(row => row.certainty === 'heuristic'));
  assert.equal(match.relationWitnesses[1].relations[0].certainty, 'may');
  assert.ok(match.conditions.every(condition => condition.status === 'unknown'));
  assert.equal(match.roleMap.target, canonicalSemanticJson(ref(2)));
  await fs.writeFile(f.original, 'changed live worktree');
  const lens = materializeSourceMotifLens({ view: projected.view, match, taskId: 'shared-target-review' });
  assert.equal(lens.facets.find(facet => facet.roles.includes('target')).text, f.bytes.toString().slice(17));
  assert.equal(lens.analogy.transfer, 'not-established');
  const partial = await projectRetainedSemanticRoleView({ store, world, nodes, maxIncidentRows: 1 });
  assert.equal(partial.truncated, true);
  assert.equal(partial.view.coverage, 'partial');
  const mutableWorld = structuredClone(world), mutableNodes = structuredClone(nodes);
  const pinned = await projectRetainedSemanticRoleView({ world: mutableWorld, nodes: mutableNodes,
    store: { ...store, getRecords: async (...args) => {
      const rows = await store.getRecords(...args);
      mutableWorld.contextKey = 'changed-after-read';
      mutableWorld.generation.baseBuildId = 'changed-after-read';
      mutableNodes[0].roles[0] = 'publisher'; mutableNodes[1].ref.localId = 2;
      return rows;
    } } });
  assert.deepEqual(pinned.view.world, world, 'the original world is pinned before the first awaited store read');
  assert.equal(findSourceMotifs({ view: pinned.view, motifId: 'shared-call-target/v1' }).matches.length, 1,
    'later role and record-ref mutation cannot rewrite the selected structural question');
  let selectionReads = 0, getterCalls = 0;
  const countedStore = { ...store, getRecords: (...args) => { selectionReads++; return store.getRecords(...args); } };
  const accessorNodes = [{ ref: ref(0), get roles() { getterCalls++; return ['leftCall']; } }];
  await assert.rejects(projectRetainedSemanticRoleView({ store: countedStore, world, nodes: accessorNodes }), /getters/);
  assert.equal(getterCalls, 0, 'selection accessors are rejected without invocation');
  await assert.rejects(projectRetainedSemanticRoleView({ store: countedStore, world: { ...world, unqualified: true }, nodes }), /generation-pinned/);
  const excessiveMetadata = Array.from({ length: 64 }, (_, id) => ({ ref: ref(id), roles: Array(16).fill('r'.repeat(4096)) }));
  await assert.rejects(projectRetainedSemanticRoleView({ store: countedStore, world, nodes: excessiveMetadata }), /metadata allowance/);
  assert.equal(selectionReads, 0, 'unadmitted selections fail before canonical source or record acquisition');
  for (const malformed of [
    page => ({ ...page, done: 'yes' }),
    page => ({ ...page, edges: null }),
    page => ({ ...page, offset: 0, done: true, edges: [projected.evidence[0].edge] }),
    page => ({ ...page, offset: 128, edges: Array(129).fill(projected.evidence[0].edge) })
  ]) {
    await assert.rejects(projectRetainedSemanticRoleView({ world, nodes,
      store: { ...store, getNeighbors: async (...args) => malformed(await store.getNeighbors(...args)) } }), /bounded progress/);
  }
  await assert.rejects(projectRetainedSemanticRoleView({ store, world: { ...world,
    generation: { ...f.generation, baseBuildId: 'wrong-generation' } }, nodes }), /generation-pinned/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(projectRetainedSemanticRoleView({ store, world, nodes, signal: abort.signal }), { name: 'AbortError' });
  const lateAbort = new AbortController();
  await assert.rejects(projectRetainedSemanticRoleView({ world, nodes, signal: lateAbort.signal,
    store: { ...store, getNeighbors: async (...args) => {
      const page = await store.getNeighbors(...args); lateAbort.abort(); return page;
    } } }), { name: 'AbortError' });
} finally { await f.cleanup(); }
console.log('canonical retained semantic records, call motifs and source lens controls passed');
