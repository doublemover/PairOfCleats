import assert from 'node:assert/strict';
import { runCrossFilePropagation } from '../../../../src/index/type-inference-crossfile/propagation.js';
import { resolveCrossFileFidelity } from '../../../../src/index/cross-file-fidelity.js';
const makeChunks = count => Array.from({ length: count }, (_, index) => ({
  file: 'src/file-' + String(index).padStart(4, '0') + '.js', chunkUid: 'caller-' + index,
  name: 'caller' + index, kind: 'function', docmeta: {},
  codeRelations: { callDetails: Array.from({ length: 60 }, (_, ordinal) => ({
    callee: 'unknown' + ordinal, args: [], start: ordinal * 10, end: ordinal * 10 + 8 })) }
}));
for (const [files, mode, expected] of [[2, 'bounded', 120], [500, 'bounded', 25000], [500, 'comprehensive', 30000]]) {
  const chunks = makeChunks(files);
  const stats = await runCrossFilePropagation({ rootDir: process.cwd(), chunks,
    fidelity: resolveCrossFileFidelity(mode), enableTypeInference: false, useTooling: false });
  const summaries = chunks.reduce((sum, row) => sum + (row.codeRelations.callSummaries?.length || 0), 0);
  assert.equal(stats.linkedCalls, 0, 'the original reproduction contains callDetails without calls');
  assert.equal(summaries, expected);
  assert.equal(stats.linkedCallSummaries, expected);
  assert.equal(stats.admission.callDetails.dropped, files * 60 - expected);
  assert.equal(chunks.reduce((sum, row) => sum + row.codeRelations.callDetails.length, 0), files * 60,
    'budget admission preserves every original raw call detail');
}
console.log('global call-summary admission across many actual propagation chunks passed');
