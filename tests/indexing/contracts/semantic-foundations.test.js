#!/usr/bin/env node
import assert from 'node:assert/strict';
import { canonicalSemanticJson, createSourceUnitId, createSyntaxPartitionId,
  createAnalysisPartitionId, createSemanticTaskId } from '../../../src/index/semantic/identity.js';
import { validateSemanticRecord } from '../../../src/contracts/validators/semantic.js';
import { assertCurrentIndexFormat } from '../../../src/contracts/index-format.js';

assert.equal(canonicalSemanticJson({ z: 1, a: { b: 2, a: 3 } }), '{"a":{"a":3,"b":2},"z":1}');
assert.equal(canonicalSemanticJson({ 2: 'b', 10: 'a' }), '{"10":"a","2":"b"}');
for (const invalid of [undefined, NaN, Infinity, { missing: undefined }, [, 1], new Date(), 1n]) {
  assert.throws(() => canonicalSemanticJson(invalid), TypeError);
}
const cycle = {};
cycle.self = cycle;
assert.throws(() => canonicalSemanticJson(cycle), TypeError);
assert.notEqual(canonicalSemanticJson([1, 2]), canonicalSemanticJson([2, 1]));
const source = {
  repositoryNamespace: 'repo:fixture', path: 'src/Café.ts', byteHash: 'a'.repeat(64),
  decoding: 'utf8', language: 'typescript', dialect: null, mapping: null
};
const sourceId = createSourceUnitId(source);
assert.match(sourceId, /^su1:[a-f0-9]{64}$/);
assert.equal(sourceId, createSourceUnitId(Object.fromEntries(Object.entries(source).reverse())));
assert.notEqual(sourceId, createSourceUnitId({ ...source, path: 'src/café.ts' }));
assert.throws(() => createSourceUnitId({ ...source, path: '../escape.ts' }));
assert.throws(() => createSourceUnitId({ ...source, shardSize: 1 }));
const syntax = {
  sourceUnitId: sourceId, parser: { family: 'typescript', version: '5.9.3', options: {} },
  extractor: { schemaVersion: 1, version: 1 }, structuralPolicy: { structure: 'complete' }
};
const partitionId = createSyntaxPartitionId(syntax);
const ref = { partitionId, localId: 0 };
assert.equal(validateSemanticRecord('recordRef', ref).ok, true);
assert.equal(validateSemanticRecord('recordRef', { ...ref, localId: 2 ** 53 }).ok, false);
const analysis = {
  pass: 'bindings:1', inputPartitionHashes: ['b', 'a'], compilerContext: null,
  dependencySummaryHashes: ['d', 'c'], analysisPolicy: {}
};
assert.equal(createAnalysisPartitionId(analysis),
  createAnalysisPartitionId({ ...analysis, inputPartitionHashes: ['a', 'b'] }));
const task = { kind: 'bind', inputHashes: ['b', 'a'], policyHash: 'p', targetSetHash: 't' };
assert.equal(createSemanticTaskId(task), createSemanticTaskId({ ...task, inputHashes: ['a', 'b'] }));

const call = {
  id: 1, kind: 'expression', span: [3, 27], scope: null,
  data: { astKind: 'CallExpression', operation: null, invocationKind: 'call',
    syntacticArgumentCount: 7, flags: [] }
};
assert.equal(validateSemanticRecord('node', call, { sourceLength: 27 }).ok, true);
assert.equal(validateSemanticRecord('node', call, { sourceLength: 26 }).ok, false);
assert.equal(validateSemanticRecord('node', { ...call, args: [] }).ok, false);
assert.equal(validateSemanticRecord('node', { ...call, span: [27, 3] }).ok, false);
const operands = Array.from({ length: 7 }, (_, ordinal) => ({
  parent: ref, slot: 'argument', ordinal, child: { partitionId, localId: ordinal + 2 }, flags: []
}));
for (const operand of operands) assert.equal(validateSemanticRecord('operand', operand).ok, true);
assert.equal(validateSemanticRecord('operand', { ...operands[0], child: null }).ok, false);
assert.equal(validateSemanticRecord('operand', {
  ...operands[0], slot: 'element', child: null, flags: ['hole']
}).ok, true);
assert.equal(validateSemanticRecord('operand', {
  ...operands[0], slot: 'ast:CallExpression.arguments'
}).ok, false);
assert.equal(validateSemanticRecord('operand', {
  ...operands[0], slot: 'ast:CallExpression.arguments'
}, { structuralSlots: ['ast:CallExpression.arguments'] }).ok, true);
const coverage = {
  scope: ref, phase: 'bindings', state: 'deferred', reason: 'provider_startup_deferred',
  observedCount: null, completedCount: null, frontierRef: 'st1:fixture'
};
assert.equal(validateSemanticRecord('coverage', coverage).ok, true);
assert.equal(validateSemanticRecord('coverage', { ...coverage, state: 'complete' }).ok, false);
assert.equal(validateSemanticRecord('coverage', {
  ...coverage, completedCount: 2, observedCount: 1
}).ok, false);

for (const foundVersion of ['0.0.2', '0.1.1', '1.0.0', undefined, null, 1]) {
  assert.throws(() => assertCurrentIndexFormat({
    operation: 'read', component: 'pieces', foundVersion, expectedVersion: '0.1.0',
    repoRoot: '.', indexPath: './fixture-index'
  }), (error) => {
    assert.equal(error.code, 'ERR_INDEX_FORMAT_UNSUPPORTED');
    assert.equal(error.details.foundVersion, foundVersion ?? 'missing');
    assert.equal(error.details.expectedVersion, '0.1.0');
    assert.match(error.details.rebuildCommand, /pairofcleats index build --repo ".+" --mode all$/);
    assert.doesNotMatch(error.details.rebuildCommand, /incremental/);
    return true;
  });
}
assertCurrentIndexFormat({ foundVersion: '0.1.0', expectedVersion: '0.1.0' });
console.log('semantic foundation contracts passed');
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';

const original = '\uFEFFconst café = "😀";\r\nnext();\u2028last();';
const snapshot = createSemanticSourceSnapshot({
  bytes: Buffer.from(original, 'utf8'), repositoryNamespace: 'repo:test',
  path: 'src/non-ascii.js', language: 'javascript'
});
assert.equal(snapshot.text, original);
assert.equal(snapshot.manifest.textLength, original.length);
assert.equal(snapshot.manifest.byteLength, Buffer.byteLength(original));
assert.deepEqual(snapshot.manifest.lineStarts, [0, original.indexOf('next'), original.indexOf('last')]);
assert.equal(snapshot.text.slice(original.indexOf('😀'), original.indexOf('😀') + 2), '😀');
assert.throws(() => createSemanticSourceSnapshot({
  bytes: Uint8Array.of(0xff), repositoryNamespace: 'repo:test', path: 'bad.js', language: 'javascript'
}));

import { buildCrossFileInferenceBudgetPlan, applyCrossFileInferenceBudgetPlan }
  from '../../../src/index/build/indexer/steps/relations/cross-file-budget.js';
import { mergeCrossFileInferenceView }
  from '../../../src/index/build/indexer/steps/relations/cross-file-view.js';
const rawCalls = Array.from({ length: 300 }, (_, i) => ['caller', 'target' + i]);
const rawDetails = rawCalls.map(([, callee], i) => ({ callee, args: [String(i)], start: i, end: i + 1 }));
const rawUsages = rawCalls.map(([, callee]) => callee);
const canonicalChunks = [{
  file: 'src/test.js', chunkUid: 'chunk:test',
  codeRelations: { calls: rawCalls, callDetails: rawDetails, usages: rawUsages }
}];
const fileRelations = new Map([['src/test.js', { usages: [...rawUsages] }]]);
const plan = buildCrossFileInferenceBudgetPlan({ chunks: canonicalChunks, fileRelations, inferenceLiteEnabled: true });
const view = applyCrossFileInferenceBudgetPlan({ chunks: canonicalChunks, fileRelations, plan });
assert.ok(view.chunks[0].codeRelations.callDetails.length < rawDetails.length);
assert.equal(canonicalChunks[0].codeRelations.callDetails.length, 300);
assert.equal(fileRelations.get('src/test.js').usages.length, 300);
assert.ok(view.fileRelations.get('src/test.js').usages.length < 300);
view.chunks[0].codeRelations.callDetails[0].resolvedCalleeChunkUid = 'chunk:target';
view.chunks[0].codeRelations.callLinks = [{ targetChunkUid: 'chunk:target' }];
view.chunks[0].docmeta = { inferred: true };
mergeCrossFileInferenceView(canonicalChunks, view.chunks);
assert.equal(canonicalChunks[0].codeRelations.calls, rawCalls);
assert.equal(canonicalChunks[0].codeRelations.callDetails, rawDetails);
assert.equal(canonicalChunks[0].codeRelations.usages, rawUsages);
assert.equal(canonicalChunks[0].codeRelations.callDetails[299].callee, 'target299');
assert.equal(canonicalChunks[0].codeRelations.callDetails[0].resolvedCalleeChunkUid, 'chunk:target');
assert.equal(canonicalChunks[0].codeRelations.callLinks.length, 1);
assert.equal(canonicalChunks[0].docmeta.inferred, true);

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCrossFileInference }
  from '../../../src/index/build/indexer/steps/relations/cross-file-runner.js';
const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-semantic-view-'));
try {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const allDetails = Array.from({ length: 300 }, (_, i) => ({
      callee: 'target' + i, args: [String(i)], start: i, end: i + 1
    }));
    const state = {
      chunks: [{
        file: 'src/test.js', chunkUid: 'chunk:test', name: 'caller', kind: 'FunctionDeclaration',
        codeRelations: {
          calls: allDetails.map((detail) => ['caller', detail.callee]),
          callDetails: allDetails, usages: allDetails.map((detail) => detail.callee)
        }
      }],
      fileRelations: new Map([['src/test.js', { usages: allDetails.map((detail) => detail.callee) }]])
    };
    const files = state.fileRelations;
    await runCrossFileInference({
      runtime: {
        root: fixtureRoot, buildRoot: fixtureRoot, repoCacheRoot: fixtureRoot,
        typeInferenceEnabled: true, typeInferenceCrossFileEnabled: true,
        riskAnalysisEnabled: false, riskAnalysisCrossFileEnabled: false,
        riskInterproceduralEnabled: false, toolingEnabled: false
      },
      mode: 'code', state, crashLogger: { updatePhase() {} }, featureMetrics: null
    });
    assert.equal(state.fileRelations, files, 'runner must not install the budgeted file view');
    assert.equal(state.chunks[0].codeRelations.callDetails.length, 300);
    assert.equal(state.chunks[0].codeRelations.callDetails[299].callee, 'target299');
    assert.ok(state.crossFileInferenceBudgetStats.dropped.callDetailSignals > 0);
  }
} finally {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
console.log('semantic production inference preservation passed (fresh and warm cache)');

import { buildCrossFileFingerprint } from '../../../src/index/type-inference-crossfile/cache.js';
const fingerprintInput = {
  chunks: [{ chunkUid: 'stable-chunk', codeRelations: {
    callDetails: [{ callee: 'same', args: ['x'], start: 1, end: 8 }]
  } }], fileRelations: null
};
const initialFingerprint = buildCrossFileFingerprint(fingerprintInput);
fingerprintInput.chunks[0].codeRelations.callDetails[0].start = 2;
assert.notEqual(buildCrossFileFingerprint(fingerprintInput), initialFingerprint,
  'a stable chunk identity must not attach cached bindings to a moved call occurrence');
