import assert from 'node:assert/strict';
import { projectOutput, VIEW_LIMITS } from '../../../src/map/workspace/projection.js';

let copies = 0;
const rows = Array.from({ length: 10000 }, (_, index) => ({
  id: 'duplicate-label', name: `hit ${index}`, file: `file-${index}.js`,
  get evidence() { copies += 1; return { original: index }; }
}));
const input = { code: rows, pagination: { nextCursor: 'source-cursor' } };
for (const page of [0, 25, 49, 0]) {
  const before = copies, projection = projectOutput(input, { page });
  assert.equal(copies - before, VIEW_LIMITS.nodes, 'only admitted rows are spread into detail objects');
  assert.equal(projection.nodes.length, 200);
  assert.equal(projection.nodes[0].detail.originalRank, page * 200 + 1);
  assert.equal(projection.nodes[0].detail.mode, 'code');
  assert.equal(projection.coverage.responseEntities, 10000);
  assert.equal(projection.cursor, 'source-cursor');
  assert.equal(projection.sections.find(section => section.title === 'code · original ranking').value, rows);
}
const map = { options: {}, summary: {}, nodes: Array.from({ length: 202 }, (_, index) => ({ path: `${index}.js` })), edges: [
  { type: 'call', from: { file: '0.js' }, to: { file: '1.js' } },
  { type: 'import', from: { file: '200.js' }, to: { file: '201.js' } }
] };
for (const page of [0, 1]) {
  const projection = projectOutput(map, { page, relation: 'call' });
  assert.deepEqual(projection.relationKinds, ['call', 'import'], 'filter vocabulary comes from the complete admitted response before filtering');
}
assert.equal(projectOutput(map, { page: 1, relation: 'import' }).edges[0].kind, 'import');
console.log('Workspace detail copies follow admitted rows while preserving rank, source evidence, cursor and complete relation vocabulary.');
