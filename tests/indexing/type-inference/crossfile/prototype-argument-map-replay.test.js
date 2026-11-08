import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha1 } from '../../../../src/shared/hash.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-prototype-arg-map-'));
const params = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
const args = ['"abc"', '23', 'true', 'null'];
const texts = new Map([
  ['callee.js', `export function sinkFn(${params.join(',')}) { return null; }`],
  ['caller.js', `export function caller() { return sinkFn(${args.join(',')}); }`]
]);
const makeChunks = () => [...texts].map(([file, text], index) => {
  const name = index === 0 ? 'sinkFn' : 'caller', chunkUid = index === 0 ? 'uid:callee' : 'uid:caller';
  return { file, name, chunkUid, kind: 'function', start: 0, end: text.length,
    fileHash: sha1(text), fileHashAlgo: 'sha1',
    metaV2: { symbol: { symbolId: 'symbol:' + chunkUid, symbolKey: file + '::' + name, chunkUid } },
    codeRelations: index === 0 ? {} : { calls: [['caller', 'sinkFn']],
      callDetails: [{ caller: 'caller', callee: 'sinkFn', args: [...args] }] },
    docmeta: index === 0 ? { paramNames: [...params] } : {} };
});
const run = chunks => applyCrossFileInference({ rootDir: root, cacheRoot: path.join(root, 'cache'),
  chunks, enabled: true, enableTypeInference: true, enableRiskCorrelation: false, useTooling: false });
const check = chunks => {
  const callee = chunks.find(chunk => chunk.name === 'sinkFn'), caller = chunks.find(chunk => chunk.name === 'caller');
  const summary = caller.codeRelations.callSummaries[0];
  for (const [index, name] of params.entries()) {
    assert.ok(Object.hasOwn(summary.argMap, name), `${name}: argument survives as an own data field`);
    assert.equal(summary.argMap[name], args[index]);
    assert.ok(Object.hasOwn(callee.docmeta.inferredTypes.params, name));
    const expected = ['string', 'number', 'boolean', 'null'][index];
    assert.deepEqual(callee.docmeta.inferredTypes.params[name].map(entry => entry.type), [expected],
      `${name}: inherited object members cannot manufacture another literal type`);
  }
  const serialized = JSON.parse(JSON.stringify(summary));
  assert.ok(Object.hasOwn(serialized.argMap, '__proto__'));
  assert.equal(serialized.argMap.__proto__, '"abc"');
};
try {
  for (const [file, text] of texts) await fs.writeFile(path.join(root, file), text);
  const cold = makeChunks(), coldStats = await run(cold);
  assert.equal(coldStats.cacheHit, false);
  assert.equal(coldStats.sourceReadCoverage.status, 'qualified');
  check(cold);
  const warm = makeChunks(), warmStats = await run(warm);
  assert.equal(warmStats.cacheHit, true, 'source-qualified complete replay retains the own argument map');
  check(warm);
  assert.deepEqual(JSON.parse(JSON.stringify(warm)), JSON.parse(JSON.stringify(cold)));
  console.log('cross-file own argument names and source-qualified replay test passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
