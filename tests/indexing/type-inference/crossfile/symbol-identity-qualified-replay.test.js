import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { sha1 } from '../../../../src/shared/hash.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';
import { buildCrossFileFingerprint } from '../../../../src/index/type-inference-crossfile/cache.js';

applyTestEnv({ testing: '1' });
const sources = {
  'factory.js': 'function factory() { return input; }',
  'caller.js': 'function caller() { return factory(); }'
};
const symbol = (name, chunkUid) => ({ scheme: 'poc', qualifiedName: name,
  symbolId: `symbol:${chunkUid}`, symbolKey: `key:${name}`, signatureKey: `${name}()`,
  kindGroup: 'function', chunkUid });
const makeChunks = () => Object.entries(sources).map(([file, text], index) => ({
  file, fileHash: sha1(text), fileHashAlgo: 'sha1', chunkUid: index ? 'caller' : 'factory',
  name: index ? 'caller' : 'factory', kind: 'function', start: 0, end: text.length,
  metaV2: { symbol: symbol(index ? 'caller' : 'factory', index ? 'caller' : 'factory') },
  docmeta: index ? {} : { returnType: 'Widget' },
  codeRelations: index ? { calls: [['caller', 'factory']], callDetails: [{ callee: 'factory', args: [] }] } : {}
}));
const fingerprint = chunks => buildCrossFileFingerprint({ chunks, enableTypeInference: true,
  enableRiskCorrelation: false, useTooling: false });
const baseline = fingerprint(makeChunks());
for (const [key, value] of Object.entries({ symbolId: 'changed-symbol', symbolKey: 'changed-key',
  signatureKey: 'changed-signature', kindGroup: 'changed-kind', qualifiedName: 'otherTarget', chunkUid: 'other-uid' })) {
  const changed = makeChunks();
  changed[0].metaV2.symbol[key] = value;
  assert.notEqual(fingerprint(changed), baseline, `canonical symbol ${key} must own replay identity`);
}
const missing = makeChunks();
delete missing[0].metaV2.symbol;
assert.notEqual(fingerprint(missing), baseline, 'symbol availability affects resolver candidates');
const reordered = makeChunks();
reordered[0].metaV2.symbol = Object.fromEntries(Object.entries(reordered[0].metaV2.symbol).reverse());
assert.equal(fingerprint(reordered), baseline, 'object insertion order is not symbol meaning');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-crossfile-symbol-'));
const run = chunks => applyCrossFileInference({ rootDir: root, buildRoot: root,
  cacheRoot: path.join(root, 'cache'), chunks, enabled: true, cacheEnabled: true,
  useTooling: false, enableTypeInference: true, enableRiskCorrelation: false, log: () => {} });
try {
  for (const [file, source] of Object.entries(sources)) await fs.writeFile(path.join(root, file), source);
  const cold = makeChunks();
  assert.equal((await run(cold)).cacheHit, false);
  assert.equal(cold[1].codeRelations.callSummaries[0].calleeRef.resolved.symbolId, 'symbol:factory');
  const warm = makeChunks();
  assert.equal((await run(warm)).cacheHit, true);
  assert.deepEqual(JSON.parse(JSON.stringify(warm)), JSON.parse(JSON.stringify(cold)));

  const current = makeChunks();
  current[0].metaV2.symbol.symbolId = 'symbol:replacement';
  assert.equal((await run(current)).cacheHit, false, 'same source/chunk identity cannot replay an obsolete symbol ID');
  assert.equal(current[1].codeRelations.callSummaries[0].calleeRef.resolved.symbolId, 'symbol:replacement');
  const currentWarm = makeChunks();
  currentWarm[0].metaV2.symbol.symbolId = 'symbol:replacement';
  assert.equal((await run(currentWarm)).cacheHit, true);
  assert.deepEqual(JSON.parse(JSON.stringify(currentWarm)), JSON.parse(JSON.stringify(current)));

  const renamed = makeChunks();
  renamed[0].metaV2.symbol.qualifiedName = 'otherTarget';
  const renamedStats = await run(renamed);
  assert.equal(renamedStats.cacheHit, false, 'changed qualified identity must rebuild the name index');
  assert.equal(renamed[1].codeRelations.callSummaries[0].calleeRef.status, 'unresolved');
  assert.equal(renamed[1].docmeta.inferredTypes?.returns?.some(row => row.type === 'Widget') ?? false, false,
    'a removed resolver candidate cannot survive through a stale cached return fact');
  const renamedWarm = makeChunks();
  renamedWarm[0].metaV2.symbol.qualifiedName = 'otherTarget';
  assert.equal((await run(renamedWarm)).cacheHit, true);
  assert.deepEqual(JSON.parse(JSON.stringify(renamedWarm)), JSON.parse(JSON.stringify(renamed)));
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('cross-file canonical symbol input identity and qualified replay controls passed');
