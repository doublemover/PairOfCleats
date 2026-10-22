import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createAnalysisPartitionId } from '../../../src/index/semantic/identity.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { projectRetainedSemanticRoleView } from '../../../src/graph/analogy/retained-semantic-view.js';
import { findSourceMotifs, compareSourceMotifMatches, materializeSourceMotifComparisonLens }
  from '../../../src/graph/analogy/source-motifs.js';
import { CONTEXT_PACK_RESPONSE_MAX_BYTES } from '../../../src/context-pack/response-budget.js';

// Authored only: two actual canonical stores feed existing motif/lens owners.
const fixtures = [];
const build = async (label, { partial = false, padding = 0, parallel = false } = {}) => {
  const names = label === 'left' ? ['left', 'right', 'target'] : ['alpha', 'beta', 'destination'];
  const source = `${names[0]}(); ${names[1]}(); function ${names[2]}(){/*${'x'.repeat(padding)}*/return 1;}`;
  const f = await createRecoveryFixture(source); fixtures.push(f);
  const ref = localId => ({ partitionId: f.partitionId, localId });
  const call = id => {
    const text = names[id] + '()', start = source.indexOf(text);
    return { ...semanticNode(id, f.source.textLength), row: { ...semanticNode(id, f.source.textLength).row,
      span: [start, start + text.length] } };
  };
  const syntax = await f.write([call(0), call(1),
    { family: 'node', row: { id: 2, kind: 'declaration', span: [source.indexOf('function'), source.length], scope: null,
      data: { nameId: 0, declarationKind: 'function', flags: [], initializer: null, typeSyntax: null } } },
    { family: 'lookup', row: { kind: 'name', id: 0, value: names[2] } }]);
  const contextKey = label + '-build-context';
  const partitionId = createAnalysisPartitionId({ pass: { name: 'fixture-motif-comparison', version: '1' },
    inputPartitionHashes: [syntax.canonicalHash], compilerContext: contextKey, dependencySummaryHashes: [], analysisPolicy: {} });
  const edge = (id, from, certainty, condition = null) => ({ family: 'edge', row: { id, kind: 'callTarget',
    from: ref(from), to: ref(2), callSite: ref(from), operandOrdinal: null, contextKey, condition, evidence: null, certainty } });
  const edges = [edge(0, 0, label === 'left' ? 'exact-static' : 'modeled'), edge(1, 1, 'heuristic')];
  if (parallel) edges.push(edge(2, 0, 'heuristic', ref(0)));
  const analysis = await f.write(edges, { partitionId, contextHash: 'c'.repeat(64) });
  const partitions = [syntax, analysis];
  const queryIndex = await writeSemanticQueryIndex({ root: f.stagingRoot, generation: f.generation,
    partitions, store: f.store(partitions), diskAccount: f.account });
  const projected = await projectRetainedSemanticRoleView({ store: f.store(partitions, { queryIndex }),
    world: { generation: f.generation, repositoryNamespace: f.root, contextKey },
    nodes: [{ ref: ref(0), roles: ['leftCall'] }, { ref: ref(1), roles: ['rightCall'] }, { ref: ref(2), roles: ['target'] }],
    ...(partial ? { maxIncidentRows: edges.length } : {}) });
  const found = findSourceMotifs({ view: projected.view, motifId: 'shared-call-target/v1' });
  assert.equal(found.matches.length, 1);
  return { f, view: projected.view, match: found.matches[0], source };
};
try {
  const left = await build('left', { parallel: true }), right = await build('right', { partial: true });
  const request = { leftView: left.view, leftMatch: left.match, rightView: right.view, rightMatch: right.match };
  const comparison = compareSourceMotifMatches(request);
  assert.equal(comparison.rolePairs.length, 3);
  assert.ok(comparison.rolePairs.every(pair => pair.left.worldRef.repositoryNamespace === left.f.root
    && pair.right.worldRef.repositoryNamespace === right.f.root));
  assert.ok(comparison.rolePairs.every(pair => pair.left.sourceRef.sourceUnitId !== pair.right.sourceRef.sourceUnitId));
  assert.equal(comparison.sourceCoverage.left, 'complete-declared-view');
  assert.equal(comparison.sourceCoverage.right, 'partial');
  const relation = comparison.relationCorrespondence[0];
  assert.equal(relation.leftWitnesses.length, 2); assert.equal(relation.rightWitnesses.length, 1);
  assert.equal(relation.certaintyLabels, 'different-declared-labels');
  assert.deepEqual(relation.leftCertainties, ['exact-in-model', 'heuristic']);
  assert.deepEqual(relation.rightCertainties, ['may']);
  assert.equal(relation.edgeBijection, 'not-established'); assert.equal(relation.truthEquivalence, 'not-implied');
  assert.ok(comparison.conditions.every(condition => condition.status === 'unknown'));
  assert.equal(comparison.transfer, 'not-established'); assert.equal(comparison.behavioralEquivalence, 'not-implied');
  const reversed = compareSourceMotifMatches({ leftView: right.view, leftMatch: right.match, rightView: left.view, rightMatch: left.match });
  assert.notEqual(comparison.comparisonId, reversed.comparisonId, 'direction and both pinned worlds are part of correspondence identity');
  assert.equal(compareSourceMotifMatches(request).comparisonId, comparison.comparisonId);
  assert.throws(() => compareSourceMotifMatches({ ...request, rightMatch: { ...right.match } }), /owned/);
  await fs.writeFile(left.f.original, 'changed live left'); await fs.writeFile(right.f.original, 'changed live right');
  const lens = materializeSourceMotifComparisonLens({ comparison, taskId: 'compare-two-implementations' });
  assert.equal(lens.status, 'projected');
  assert.ok(lens.left.facets.find(facet => facet.roles.includes('target')).text.includes('function target'));
  assert.ok(lens.right.facets.find(facet => facet.roles.includes('target')).text.includes('function destination'));
  assert.ok(lens.left.facets.every(facet => facet.worldRef.repositoryNamespace === left.f.root && facet.editAuthority === 'not-granted'));
  assert.ok(lens.right.facets.every(facet => facet.worldRef.repositoryNamespace === right.f.root && facet.editAuthority === 'not-granted'));
  assert.equal(lens.analogy.relationSupport[0].leftWitnessCount, 2);
  assert.equal(lens.analogy.conditions[0].status, 'unknown');
  assert.equal(lens.renderedBytes, Buffer.byteLength(JSON.stringify(lens) + '\n'));
  assert.equal(lens.left.renderedBytes, Buffer.byteLength(JSON.stringify(lens.left) + '\n'));
  assert.equal(lens.right.renderedBytes, Buffer.byteLength(JSON.stringify(lens.right) + '\n'));
  assert.throws(() => materializeSourceMotifComparisonLens({ comparison: { ...comparison }, taskId: 'forged' }), /owned/);
  const overflow = materializeSourceMotifComparisonLens({ comparison, taskId: 'bounded', maxFacets: 1 });
  assert.equal(overflow.status, 'mandatoryOverflow');
  assert.equal(overflow.left.facets.length, 0); assert.equal(overflow.right.facets.length, 0);
  assert.equal(overflow.analogy.rolePairs.length, 3, 'presentation overflow retains the compact owned correspondence');
  const largeLeft = await build('left', { padding: 75000 }), largeRight = await build('right', { padding: 75000 });
  const largeComparison = compareSourceMotifMatches({ leftView: largeLeft.view, leftMatch: largeLeft.match,
    rightView: largeRight.view, rightMatch: largeRight.match });
  const pairedBudget = materializeSourceMotifComparisonLens({ comparison: largeComparison, taskId: 'whole-pair-budget' });
  assert.equal(pairedBudget.status, 'mandatoryOverflow');
  assert.equal(pairedBudget.overflowReason, 'paired-source-response-budget');
  assert.equal(pairedBudget.left.facets.length, 0); assert.equal(pairedBudget.right.facets.length, 0);
  assert.ok(pairedBudget.renderedBytes <= CONTEXT_PACK_RESPONSE_MAX_BYTES);
  assert.equal(pairedBudget.renderedBytes, Buffer.byteLength(JSON.stringify(pairedBudget) + '\n'));
  const controller = new AbortController(); controller.abort();
  assert.throws(() => compareSourceMotifMatches({ ...request, signal: controller.signal }), { name: 'AbortError' });
  assert.throws(() => materializeSourceMotifComparisonLens({ comparison, taskId: 'aborted', signal: controller.signal }), { name: 'AbortError' });
} finally { for (const f of fixtures) await f.cleanup(); }
console.log('paired canonical motif correspondence, qualified sources and complete response budget controls passed');
