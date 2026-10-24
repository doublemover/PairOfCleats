import assert from 'node:assert/strict';
import { filterRawRelationsWithLexicon } from '../../../src/index/build/file-processor/lexicon-relations-filter.js';
import { applyRelationInferenceBudget, applyFileUsageInferenceBudget, buildCallIndex } from '../../../src/index/build/file-processor/relations.js';
import { buildExternalDocs } from '../../../src/index/build/file-processor/meta.js';
import { buildCrossFileFingerprint } from '../../../src/index/type-inference-crossfile/cache.js';
import { classifyTokenBuckets, createTokenClassificationRuntime } from '../../../src/index/build/tokenization.js';
import { detectBoilerplateCommentBlocks } from '../../../src/index/boilerplate.js';

const callees = ['obj.default', 'obj::default', 'obj->default', 'obj#default', 'obj/default'];
const relations = { calls: [...callees, 'if'].map(callee => ['f', callee]),
  callDetails: [...callees, 'if'].map((callee, index) => ({ caller: 'f', callee, start: index, end: index + 1 })),
  callDetailsWithRange: [...callees, 'if'].map((callee, index) => ({ caller: 'f', callee, range: { start: index, end: index + 1 } })) };
const filtered = filterRawRelationsWithLexicon(relations, { languageId: 'javascript', config: { enabled: true,
  relations: { enabled: true, stableDedupe: true, drop: { keywords: true } } } });
assert.equal(filtered.calls.length, callees.length);
assert.equal(filtered.callDetails.length, callees.length);
assert.equal(filtered.callDetailsWithRange.length, callees.length);
assert.equal(buildCallIndex(filtered).callDetailsWithRange.length, callees.length);
const budgeted = { calls: [['a', 'b']], callDetails: [{ caller: 'a' }], usages: ['x'] };
applyRelationInferenceBudget({ relations: budgeted });
assert.equal(budgeted.calls.length, 1);
assert.equal(budgeted.callDetails.length, 1);
assert.equal(budgeted.usages.length, 1);
applyFileUsageInferenceBudget({ fileRelations: budgeted });
assert.equal(budgeted.usages.length, 1);
applyRelationInferenceBudget({ relations: budgeted, maxCalls: 0, maxCallDetails: 0, maxUsages: 0 });
assert.deepEqual(budgeted, { calls: [], callDetails: [], usages: [] });
const fingerprint = imports => buildCrossFileFingerprint({ chunks: [{ chunkUid: 'u', file: 'a.js', start: 0,
  end: 1, codeRelations: { imports } }], enableTypeInference: true, fileRelations: null });
assert.notEqual(fingerprint(['a']), fingerprint(['b']), 'all overwritten input relations own cache identity');
assert.deepEqual(buildExternalDocs('.js', ['node:fs', 'fs', 'fs/promises', '@scope/pkg', 'left-pad']),
  ['https://www.npmjs.com/package/@scope/pkg', 'https://www.npmjs.com/package/left-pad']);
assert.deepEqual(buildExternalDocs('.py', ['os', 'os.path', 'sys', 'urllib.parse', 'requests']), ['https://pypi.org/project/requests']);
const context = { treeSitter: { enabled: true }, tokenClassification: { treeSitterMaxChunksPerFile: 1 } };
context.tokenClassificationRuntime = createTokenClassificationRuntime({ context, fileBytes: 3 });
const before = { ...context.tokenClassificationRuntime };
classifyTokenBuckets({ text: 'foo', tokens: ['foo'], languageId: 'unknown-language', ext: '.unknown',
  dictWords: new Set(), dictConfig: {}, context });
assert.equal(context.tokenClassificationRuntime.remainingChunks, before.remainingChunks);
assert.equal(context.tokenClassificationRuntime.remainingBytes, before.remainingBytes);
const blocks = await detectBoilerplateCommentBlocks({ text: '// SPDX-License-Identifier: MIT\n// Copyright 2024 Bob\nconst x=1;' });
assert.ok(blocks[0].tags.includes('spdx:mit'));
assert.ok(!blocks[0].tags.some(tag => tag.startsWith('spdx:mit-copyright')));
console.log('relation metadata and cache identity test passed');
