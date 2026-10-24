import assert from 'node:assert/strict';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSourceRoleView, checkSourceMotifMap, findSourceMotifs, materializeSourceMotifLens }
  from '../../../src/graph/analogy/source-motifs.js';

const world = { generation: { baseBuildId: 'build', semanticRevision: 0 }, repositoryNamespace: 'repo', contextKey: 'config' };
const snapshot = createSemanticSourceSnapshot({ bytes: Buffer.from('produce;artifact;checkA;checkB;publish;other;'),
  repositoryNamespace: 'repo', path: 'flow.js', language: 'javascript' });
const roleNames = ['producer', 'artifact', 'validator', 'validator', 'publisher', 'artifact'];
const nodes = roleNames.map((role, index) => ({ id: 'n' + index, kind: 'source-entity', roles: [role],
  sourceRef: { sourceUnitId: snapshot.manifest.sourceUnitId, span: [index, index + 1], coordinateUnit: 'utf16' } }));
const edge = (id, kind, from, to) => ({ id, kind, from, to, contextKey: 'config', certainty: 'may', evidenceId: 'evidence:' + id });
const relations = [edge('produce', 'produces', 'n0', 'n1'), edge('checkA', 'validates', 'n2', 'n1'),
  edge('checkB', 'validates', 'n3', 'n1'), edge('publish', 'publishes', 'n4', 'n1')];
const args = { world, nodes, relations, sources: [snapshot], coverage: 'partial' };
const view = createSourceRoleView(args), motifId = 'validate-before-publish/v1';
const found = findSourceMotifs({ view, motifId });
assert.equal(found.matches.length, 2);
assert.equal(found.status, 'complete-in-retained-view');
assert.equal(found.globalAbsence, 'not-established');
assert(found.matches.every(match => match.conditions.every(condition => condition.status === 'unknown')));
assert(found.matches.every(match => match.relationWitnesses.every(row => row.relations.every(relation => relation.certainty === 'may'))));
// Independent brute force over distinct four-tuples using direct adjacency membership.
const expected = [];
for (const producer of nodes) for (const artifact of nodes) for (const validator of nodes) for (const publisher of nodes) {
  if (new Set([producer.id, artifact.id, validator.id, publisher.id]).size !== 4) continue;
  if (!producer.roles.includes('producer') || !artifact.roles.includes('artifact') || !validator.roles.includes('validator') || !publisher.roles.includes('publisher')) continue;
  if (relations.some(row => row.kind === 'produces' && row.from === producer.id && row.to === artifact.id)
    && relations.some(row => row.kind === 'validates' && row.from === validator.id && row.to === artifact.id)
    && relations.some(row => row.kind === 'publishes' && row.from === publisher.id && row.to === artifact.id)) expected.push(validator.id);
}
assert.deepEqual(found.matches.map(match => match.roleMap.validator).sort(), expected.sort());
assert.equal(checkSourceMotifMap({ view, motifId, roleMap: { ...found.matches[0].roleMap, publisher: 'n0' } }).status, 'rejected');
assert.equal(checkSourceMotifMap({ view, motifId, roleMap: { ...found.matches[0].roleMap, artifact: 'n5' } }).status, 'rejected');
const wrongObject = createSourceRoleView({ ...args, relations: relations.map(row => row.kind === 'publishes' ? { ...row, to: 'n5' } : row) });
assert.equal(findSourceMotifs({ view: wrongObject, motifId }).matches.length, 0);
const reversed = createSourceRoleView({ ...args, relations: relations.map(row => row.kind === 'validates' ? { ...row, from: row.to, to: row.from } : row) });
assert.equal(findSourceMotifs({ view: reversed, motifId }).matches.length, 0);
assert.equal(findSourceMotifs({ view, motifId, maxMatches: 1 }).reason, 'match-budget');
assert.equal(findSourceMotifs({ view, motifId, maxStates: 0 }).reason, 'state-budget');
const controller = new AbortController(); controller.abort();
assert.equal(findSourceMotifs({ view, motifId, signal: controller.signal }).reason, 'cancelled');
const lens = materializeSourceMotifLens({ view, match: found.matches[0], taskId: 'review' });
assert.equal(lens.facets.length, 4);
assert.equal(lens.analogy.transfer, 'not-established');
assert.equal(lens.renderedBytes, Buffer.byteLength(JSON.stringify(lens) + '\n'));
assert.throws(() => materializeSourceMotifLens({ view, match: { ...found.matches[0] }, taskId: 'forged' }), /owned/);
const cacheNodes = nodes.slice(0, 4).map((node, index) => ({ ...node, roles: [['input', 'summary', 'reader', 'invalidator'][index]] }));
const cache = createSourceRoleView({ ...args, nodes: cacheNodes, relations: [edge('dependency', 'depends-on', 'n1', 'n0'),
  edge('read', 'reads', 'n2', 'n1'), edge('invalidate', 'invalidates', 'n3', 'n1')] });
assert.equal(findSourceMotifs({ view: cache, motifId: 'cache-with-invalidation/v1' }).matches.length, 1);
snapshot.manifest.path = 'caller-mutated.js';
assert.equal(materializeSourceMotifLens({ view, match: found.matches[0], taskId: 'stable' }).facets.length, 4);
console.log('source motif and task-lens contract passed');
