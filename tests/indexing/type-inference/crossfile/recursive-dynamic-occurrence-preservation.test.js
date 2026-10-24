import assert from 'node:assert/strict';
import { runCrossFilePropagation } from '../../../../src/index/type-inference-crossfile/propagation.js';
import { resolveCrossFileFidelity } from '../../../../src/index/cross-file-fidelity.js';

const declaration = (name, file, uid) => ({ name, file, chunkUid: uid, kind: 'function', start: 0, end: 100,
  metaV2: { symbol: { symbolId: 'symbol:' + uid, chunkUid: uid, symbolKey: 'key:' + uid, qualifiedName: name, kindGroup: 'function' } } });
const self = declaration('recur', 'src/recur.scala', 'recur');
self.codeRelations = { calls: [['recur', 'recur']], usages: ['recur'], callDetails: [
  { callee: 'recur', calleeRaw: 'recur', source: 'tree-sitter', coordinateSystem: 'utf16', start: 10, end: 16, args: [] },
  { callee: null, calleeRaw: 'object[index]', source: 'tree-sitter', coordinateSystem: 'utf16', start: 20, end: 35, args: [], reason: 'dynamic-call-target' },
  { callee: null, calleeRaw: 'object[index]', source: 'tree-sitter', coordinateSystem: 'utf16', start: 40, end: 55, args: [], reason: 'dynamic-call-target' },
  { callee: 'duplicate', source: 'tree-sitter', coordinateSystem: 'utf16', start: 60, end: 70, args: [] }
] };
const chunks = [self, declaration('duplicate', 'src/a.scala', 'candidate-a'), declaration('duplicate', 'src/b.scala', 'candidate-b')];
const input = structuredClone(self.codeRelations.callDetails);
const stats = await runCrossFilePropagation({ rootDir: process.cwd(), chunks, fidelity: resolveCrossFileFidelity('comprehensive'),
  useTooling: false, enableTypeInference: false, enableRiskCorrelation: false });
assert.equal(self.codeRelations.callLinks.length, 1);
assert.equal(self.codeRelations.callLinks[0].to.resolved.chunkUid, 'recur', 'recursion is retained adjacency, not an omitted self-pair');
assert.equal(self.codeRelations.usageLinks[0].to.resolved.chunkUid, 'recur');
assert.equal(self.codeRelations.callSummaries.length, 4, 'distinct dynamic occurrences survive with their own ranges');
assert.deepEqual(self.codeRelations.callSummaries.slice(1, 3).map(row => [row.start, row.end, row.resolution, row.reason]),
  [[20, 35, 'unresolved', 'dynamic-call-target'], [40, 55, 'unresolved', 'dynamic-call-target']]);
assert.equal(self.codeRelations.callSummaries[3].calleeRef.status, 'ambiguous');
assert.equal(self.codeRelations.callDetails[3].targetCandidates.length, 2);
assert.equal(self.codeRelations.callDetails[3].targetChunkUid, null, 'may-targets never become definite adjacency');
assert.equal(stats.admission.calls.self, 1);
assert.equal(stats.admission.callDetails.dynamic, 2);
assert.equal(stats.admission.callDetails.unresolved, 2);
assert.equal(stats.admission.callDetails.ambiguous, 1);
assert.equal(stats.admission.callDetails.unsupported, 0);
assert.deepEqual(self.codeRelations.callDetails.map(row => [row.start, row.end, row.calleeRaw]), input.map(row => [row.start, row.end, row.calleeRaw]));
console.log('recursive, dynamic and ambiguous call occurrence preservation test passed');
