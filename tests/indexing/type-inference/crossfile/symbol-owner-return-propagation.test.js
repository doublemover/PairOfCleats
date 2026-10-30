import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { sha1 } from '../../../../src/shared/hash.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

applyTestEnv({ testing: '1' });
const sources = [
  ['factory', 'Widget', 'function factory() { return input; }'],
  ['unrelated', 'Noise', 'function unrelated() { return input; }'],
  ['caller', null, 'function caller() { return factory(); }']
];
const makeChunks = mode => sources.map(([name, returnType, source]) => {
  const symbol = { scheme: 'poc', qualifiedName: name, symbolId: `symbol:${name}`,
    symbolKey: `key:${name}`, chunkUid: name, kindGroup: 'function' };
  if (name === 'factory' && mode === 'mismatched') symbol.chunkUid = 'unrelated';
  if (name === 'factory' && mode === 'legacy') delete symbol.chunkUid;
  return { file: `${name}.js`, fileHash: sha1(source), fileHashAlgo: 'sha1', chunkUid: name,
    name, kind: 'function', start: 0, end: source.length, metaV2: { symbol },
    docmeta: returnType ? { returnType } : {}, codeRelations: name === 'caller'
      ? { calls: [['caller', 'factory']], callDetails: [{ callee: 'factory', args: [] }] } : {} };
});
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-symbol-owner-'));
const run = chunks => applyCrossFileInference({ rootDir: root, buildRoot: root,
  cacheRoot: path.join(root, 'cache'), chunks, enabled: true, cacheEnabled: true,
  useTooling: false, enableTypeInference: true, enableRiskCorrelation: false, log: () => {} });
try {
  for (const [name, , source] of sources) await fs.writeFile(path.join(root, `${name}.js`), source);
  for (const mode of ['consistent', 'mismatched', 'legacy']) {
    const cold = makeChunks(mode), stats = await run(cold);
    assert.equal(stats.cacheHit, false, 'changed supplied canonical symbol identity must recompute');
    assert.equal(stats.sourceReadCoverage.status, 'qualified');
    const caller = cold.find(chunk => chunk.name === 'caller');
    const summary = caller.codeRelations.callSummaries[0];
    const returns = (caller.docmeta.inferredTypes?.returns || []).map(entry => entry.type);
    if (mode === 'mismatched') {
      assert.equal(summary.calleeRef.status, 'unresolved');
      assert.equal(summary.targetChunkUid, undefined);
      assert.deepEqual(returns, [], 'a symbol hosted by factory cannot redirect return propagation to unrelated Noise');
      assert.equal(caller.codeRelations.callDetails[0].targetChunkUid, null);
    } else {
      assert.equal(summary.calleeRef.status, 'resolved');
      assert.equal(summary.targetChunkUid, 'factory');
      assert.deepEqual(returns, ['Widget']);
    }
    assert.equal(cold[0].metaV2.symbol.chunkUid, mode === 'mismatched' ? 'unrelated' : mode === 'legacy' ? undefined : 'factory',
      'rejected source identity remains inspectable; it is not silently repaired or reassigned');
    const warm = makeChunks(mode);
    assert.equal((await run(warm)).cacheHit, true);
    assert.deepEqual(JSON.parse(JSON.stringify(warm)), JSON.parse(JSON.stringify(cold)), 'qualified replay preserves admitted and rejected ownership');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('cross-file symbol host agreement, return propagation and qualified replay controls passed');
