import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { sha1 } from '../../../../src/shared/hash.js';
import { buildCrossFileFingerprint } from '../../../../src/index/type-inference-crossfile/cache.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

applyTestEnv({ testing: '1' });
const text = 'function creator() { return new Widget(); }';
const makeChunks = () => [{ file: 'source.js', fileHash: sha1(text), fileHashAlgo: 'sha1',
  chunkUid: 'creator', name: 'creator', kind: 'function', start: 0, end: text.length,
  docmeta: {}, codeRelations: {} }];
const fingerprint = fileRelations => buildCrossFileFingerprint({ chunks: makeChunks(), fileRelations,
  enableTypeInference: true, enableRiskCorrelation: false, useTooling: false });
assert.equal(fingerprint(null), fingerprint(undefined));
for (const invalid of [false, 0, '', 'relations', [], () => {}]) {
  assert.throws(() => fingerprint(invalid), TypeError, 'malformed supplied relations are not omitted relations');
}
const getterFailure = new Error('relation getter failed');
const throwingRecord = Object.defineProperty({}, 'source.js', { enumerable: true,
  get() { throw getterFailure; } });
assert.throws(() => fingerprint(throwingRecord), error => error === getterFailure,
  'identity failure must preserve the exact original error');
const iterationFailure = new Error('relation iterator failed');
const throwingMap = new Map();
throwingMap.entries = function* () { yield ['source.js', { imports: ['./changed.js'] }]; throw iterationFailure; };
assert.throws(() => fingerprint(throwingMap), error => error === iterationFailure);
const payloadFailure = new Error('relation payload failed');
const throwingPayload = { get importBindings() { throw payloadFailure; } };
assert.throws(() => fingerprint(new Map([['source.js', throwingPayload]])), error => error === payloadFailure);
assert.throws(() => fingerprint(new Map([['source.js', { unsupported: 1n }]])), TypeError,
  'a payload outside the current canonical encoder cannot borrow the null relation identity');
const a = new Map([['b.js', { imports: ['b'] }], ['a.js', { imports: ['a'] }]]);
const b = { 'a.js': { imports: ['a'] }, 'b.js': { imports: ['b'] } };
assert.equal(fingerprint(a), fingerprint(b), 'valid Map and record ordering keep their existing stable identity');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-relation-identity-'));
const run = (chunks, fileRelations = null, onProgress = null) => applyCrossFileInference({ rootDir: root,
  buildRoot: root, cacheRoot: path.join(root, 'cache'), chunks, fileRelations, onProgress,
  enabled: true, cacheEnabled: true, useTooling: false, enableTypeInference: true,
  enableRiskCorrelation: false, log: () => {} });
try {
  await fs.writeFile(path.join(root, 'source.js'), text);
  const cold = makeChunks();
  assert.equal((await run(cold)).cacheHit, false);
  assert.ok(cold[0].docmeta.inferredTypes.returns.some(row => row.type === 'Widget'));
  const warm = makeChunks();
  assert.equal((await run(warm)).cacheHit, true);
  assert.deepEqual(warm, cold);
  for (const [relations, failure] of [[throwingRecord, getterFailure], [throwingMap, iterationFailure],
    [new Map([['source.js', throwingPayload]]), payloadFailure]]) {
    const chunks = makeChunks(), before = structuredClone(chunks), progress = [];
    await assert.rejects(run(chunks, relations, event => { progress.push(event); }), error => error === failure,
      'a warm absent-relations result cannot authorize a failed supplied relation identity');
    assert.deepEqual(chunks, before, 'identity failure precedes cache restoration and mutable propagation');
    assert.deepEqual(progress, [], 'an unestablished fingerprint cannot manufacture a required start receipt');
  }
  assert.equal((await run(makeChunks())).cacheHit, true, 'failed input identity does not replace the valid cache');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('cross-file relation identity failures remain failures before warm replay controls passed');
