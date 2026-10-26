import assert from 'node:assert/strict';
import { nativeControlRows } from '../../../src/index/semantic/native-control-rows.js';
import { createNativeFlowConstruction } from '../../../src/index/semantic/native-flow-construction.js';
import { prepareSemanticBatchEntry, readPreparedSemanticBatchEntry, semanticBatchEntryBytes } from '../../../src/index/semantic/prepared-batch.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { createNativeFlowTree } from '../../helpers/native-flow-construction.js';

const partitionId = 'sa1:' + 'b'.repeat(64), source = { language: 'python', sourceUnitId: 'su1:' + 'c'.repeat(64) };
const create = (tree, options = {}) => {
  const construction = createNativeFlowConstruction({ maxBytes: 131072, ...options });
  const coverage = { scope: { sourceUnitId: source.sourceUnitId }, phase: 'localFlow',
    state: 'unsupported', reason: 'unstarted', observedCount: null, completedCount: 0, frontierRef: null };
  return { construction, coverage, iterator: nativeControlRows({ collector: tree.collector, partitionId,
    source, version: '3', coverage, construction }) };
};
const tiny = create(createNativeFlowTree({ statements: 1 }));
const tinyRows = [...tiny.iterator];
for (const entry of tinyRows) assert.equal(readPreparedSemanticBatchEntry(entry).rowJson, canonicalSemanticJson(entry.row));
assert.equal(tiny.construction.isStop(Object.assign(new Error('foreign limit'), { code: 'ERR_NATIVE_FLOW_CONSTRUCTION_BUDGET' })), false);
assert.deepEqual(tinyRows.map(entry => entry.family + ':' + (entry.row.kind || entry.row.phase)), [
  'node:evidence', 'node:block', 'node:block', 'node:block', 'edge:evidenceInput',
  'edge:controlNext', 'edge:exceptional', 'node:block', 'edge:evidenceInput', 'edge:controlNext', 'coverage:localFlow'
]);
assert.deepEqual(tinyRows.filter(entry => entry.family === 'node').map(entry => entry.row.id), [0, 1, 2, 3, 4]);
assert.deepEqual(tinyRows.filter(entry => entry.family === 'edge').map(entry => [entry.row.id, entry.row.from.localId, entry.row.to.localId]),
  [[0, 3, 0], [1, 3, 1], [2, 3, 2], [3, 4, 2], [4, 4, 3]]);
assert.equal(tiny.coverage.completedCount, 4);
assert.ok(tinyRows.filter(entry => entry.family === 'edge').every(entry => entry.row.certainty === 'modeled'));
tiny.construction.dispose(); assert.equal(tiny.construction.stats.liveLogicalBytes, 0);

const peaks = [];
for (const statements of [16, 32, 64]) {
  const tree = createNativeFlowTree({ statements }), operation = create(tree);
  const first = operation.iterator.next(); assert.equal(first.value.row.kind, 'evidence');
  assert.equal(operation.construction.stats.constructedRows, 1); assert.equal(tree.reads.named, 0);
  assert.equal(operation.construction.stats.livePreparedRows, 1, 'one current prepared entry is held at a paused yield');
  const rows = [first.value, ...operation.iterator];
  const comparison = create(createNativeFlowTree({ statements }), { maxBytes: 65536 });
  assert.deepEqual(rows, [...comparison.iterator], 'logical output is independent of larger admitted construction capacity');
  comparison.construction.dispose(); assert.equal(comparison.construction.stats.liveLogicalBytes, 0);
  assert.equal(rows.filter(entry => entry.family === 'node' && entry.row.kind === 'block').length, statements + 3);
  assert.equal(operation.construction.stats.peakPreparedRows, 1);
  assert.equal(operation.construction.stats.liveFrames, 0);
  peaks.push(operation.construction.stats.peakLogicalBytes);
  operation.construction.dispose(); assert.equal(operation.construction.stats.liveLogicalBytes, 0);
}
assert.equal(new Set(peaks).size, 1, 'flat width does not retain a file-wide derived row array');
const shaped = createNativeFlowTree({ statements: 0 }), node = shaped.node;
const loopCondition = node('identifier'), branchCondition = node('identifier');
const breakNode = node('break_statement'), continueNode = node('continue_statement');
const consequence = node('block', [breakNode]), alternative = node('else_clause', [continueNode]);
const branch = node('if_statement', [branchCondition, consequence, alternative], { condition: branchCondition, consequence, alternative });
const loopBody = node('block', [branch]), loop = node('while_statement', [loopCondition, loopBody], { condition: loopCondition, body: loopBody });
const returned = node('identifier'), returning = node('return_statement', [returned], { result: returned }), dead = node('identifier');
const body = node('block', [loop, returning, dead]), owner = node('function_definition', [body], { body });
shaped.collector.owners = [owner];
shaped.collector.anchors = new Map(shaped.nodes.map(value => [value.id, { partitionId: 'sy1:' + 'a'.repeat(64), localId: value.id }]));
const structured = create(shaped), structuredRows = [...structured.iterator];
const edges = structuredRows.filter(entry => entry.family === 'edge').map(entry => entry.row);
const blockFor = value => edges.find(edge => edge.kind === 'evidenceInput' && edge.to.partitionId !== partitionId && edge.to.localId === value.id).from.localId;
assert.ok(edges.some(edge => edge.kind === 'controlNext' && edge.from.localId === blockFor(breakNode) && edge.to.localId === blockFor(returning)));
assert.ok(edges.some(edge => edge.kind === 'controlNext' && edge.from.localId === blockFor(continueNode) && edge.to.localId === blockFor(loopCondition)));
assert.ok(edges.some(edge => edge.kind === 'returns' && edge.from.partitionId !== partitionId && edge.from.localId === returned.id));
assert.ok(edges.some(edge => edge.kind === 'controlTrue') && edges.some(edge => edge.kind === 'controlFalse'));
const reached = new Set(), pending = [blockFor(owner)];
while (pending.length) {
  const id = pending.pop(); if (reached.has(id)) continue; reached.add(id);
  for (const edge of edges) if (edge.from.partitionId === partitionId && edge.from.localId === id
    && ['controlNext', 'controlTrue', 'controlFalse', 'exceptional'].includes(edge.kind)) pending.push(edge.to.localId);
}
assert.equal(reached.has(blockFor(dead)), false, 'return does not fall through to the already emitted dead block');
structured.construction.dispose(); assert.equal(structured.construction.stats.liveLogicalBytes, 0);
for (const functions of [1, 2, 4]) {
  const operation = create(createNativeFlowTree({ statements: 8, functions }));
  const rows = [...operation.iterator];
  assert.equal(rows.filter(entry => entry.family === 'node' && entry.row.data.blockKind === 'entry').length, functions);
  assert.ok(operation.construction.stats.peakFrames <= 2); assert.equal(operation.construction.stats.peakPreparedRows, 1);
  operation.construction.dispose(); assert.equal(operation.construction.stats.liveLogicalBytes, 0);
}
for (const options of [{ maxBytes: 384 }, { maxWork: 4 }]) {
  const operation = create(createNativeFlowTree(), options);
  assert.throws(() => [...operation.iterator], error => operation.construction.isStop(error));
  operation.construction.dispose(); assert.equal(operation.construction.stats.liveLogicalBytes, 0);
  assert.equal(operation.construction.stats.livePreparedRows, 0); assert.equal(operation.construction.stats.liveFrames, 0);
}
const controller = new AbortController(), cancelled = create(createNativeFlowTree(), { signal: controller.signal });
cancelled.iterator.next(); controller.abort();
assert.throws(() => cancelled.iterator.next(), { name: 'AbortError' });
cancelled.construction.dispose(); assert.equal(cancelled.construction.stats.liveLogicalBytes, 0);
const prepared = prepareSemanticBatchEntry({ family: 'coverage', row: { value: 'λ😀' } });
assert.equal(prepareSemanticBatchEntry(prepared, { maxBytes: semanticBatchEntryBytes(prepared) }), prepared);
assert.throws(() => prepareSemanticBatchEntry(prepared, { maxBytes: semanticBatchEntryBytes(prepared) - 1 }), { code: 'ERR_SEMANTIC_JSON_BUDGET' });
console.log('Native flow pull construction preserves tiny IDs/edges and constant live output width; low limits and abort release owned frames.');
