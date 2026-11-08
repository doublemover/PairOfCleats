import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeSearchOptions } from '../../../src/retrieval/cli/normalize-options.js';
import { resolveBm25Defaults } from '../../../src/retrieval/cli/options.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
const { dir } = await prepareIsolatedTestCacheDir('bm25-input-and-metrics-policy');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off' });
const normalize = args => normalizeSearchOptions({ argv: { _: ['needle'], mode: 'code', ...args },
  rawArgs: [], rootDir: dir, userConfig: {}, metricsDir: dir, policy: {} });
const warnings = [], warn = console.warn;
console.warn = message => warnings.push(String(message));
try {
  for (const value of [-1, -0.1, NaN, Infinity, 'malformed']) assert.throws(() => normalize({ 'bm25-k1': value }), /BM25/);
  for (const value of [-1, 1.1, NaN, Infinity, 'malformed']) assert.throws(() => normalize({ 'bm25-b': value }), /BM25/);
  for (const b of [0, 1]) {
    const options = normalize({ 'bm25-k1': 0, 'bm25-b': b });
    assert.equal(options.bm25K1, 0); assert.equal(options.bm25B, b);
  }
  await fs.writeFile(path.join(dir, 'index-code.json'), JSON.stringify({ bm25: { k1: -1, b: 2 } }));
  assert.equal(resolveBm25Defaults(dir, { runCode: true }), null);
  assert.match(warnings.pop(), /Ignoring invalid stored BM25 recommendation/);
  await fs.writeFile(path.join(dir, 'index-code.json'), JSON.stringify({ bm25: { k1: 0, b: 0 } }));
  assert.deepEqual(resolveBm25Defaults(dir, { runCode: true }), { k1: 0, b: 0 });
  assert.deepEqual(warnings, []);
} finally { console.warn = warn; await fs.rm(dir, { recursive: true, force: true }); }
console.log('BM25 input admission and stored recommendations share one finite domain contract.');
