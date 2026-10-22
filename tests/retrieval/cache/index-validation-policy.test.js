import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createIndexCache } from '../../../src/retrieval/index-cache.js';
import { loadIndexCached } from '../../../src/retrieval/cli/index-loader.js';
import { createIndexBackendLoader } from '../../../src/retrieval/cli/load-indexes/backend.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-index-policy-'));
try {
  for (const indexCache of [new Map(), createIndexCache({ maxEntries: 8, ttlMs: 0 })]) {
    const calls = [];
    const loadIndex = async (_dir, options) => {
      calls.push(options.strict);
      return { policy: options.strict === false ? 'permissive' : 'strict' };
    };
    const load = (strict) => loadIndexCached({ indexCache, dir, strict, loadIndex });
    const permissive = await load(false);
    const strict = await load(true);
    assert.notStrictEqual(strict, permissive);
    assert.equal(strict.policy, 'strict');
    assert.strictEqual(await load(undefined), strict, 'default strict shares explicitly strict validation');
    assert.strictEqual(await load(true), strict);
    assert.strictEqual(await load(false), permissive);
    assert.deepEqual(calls, [false, true], 'equal policy and generation retain warm reuse');
  }

  const pendingCache = createIndexCache({ maxEntries: 8, ttlMs: 0 });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let lookups = 0;
  let bothLookedUp;
  const lookedUp = new Promise(resolve => { bothLookedUp = resolve; });
  const get = pendingCache.get.bind(pendingCache);
  pendingCache.get = key => {
    if (++lookups === 3) bothLookedUp();
    return get(key);
  };
  const pendingCalls = [];
  const pendingLoad = strict => loadIndexCached({
    indexCache: pendingCache, dir, strict,
    loadIndex: async (_dir, options) => {
      pendingCalls.push(options.strict);
      await gate;
      return { strict: options.strict };
    }
  });
  const flights = [pendingLoad(false), pendingLoad(true), pendingLoad(false)];
  try {
    await lookedUp;
    await Promise.resolve();
    assert.deepEqual(pendingCalls.sort(), [false, true], 'different policies cannot join a permissive pending load');
  } finally {
    release();
  }
  const [permissive, strict, joined] = await Promise.all(flights);
  assert.strictEqual(permissive, joined, 'same-policy flights still coalesce');
  assert.notStrictEqual(permissive, strict);

  await fs.writeFile(path.join(dir, 'chunk_meta.json'), JSON.stringify([
    { id: 0, file: 'src/fixture.js', tokens: ['needle'] }
  ]));
  const modeLoadOptions = {
    includeHnsw: false, includeDense: false, includeMinhash: false,
    includeFilterIndex: false, includeFileRelations: false, includeRepoMap: false,
    includeTokenIndex: true, includeChunkMetaCold: false
  };
  for (const indexCache of [new Map(), createIndexCache({ maxEntries: 8, ttlMs: 0 })]) {
    const backend = strict => createIndexBackendLoader({
      rootDir: dir, userConfig: {}, indexCache, strict,
      requiredArtifacts: new Set(), emitOutput: false
    });
    const load = loader => loader.loadModeIndex({ mode: 'code', run: true, dir, modeLoadOptions });
    const tolerated = await load(backend(false));
    assert.equal(tolerated.tokenIndex == null, true);
    assert.equal(tolerated.chunkMeta.length, 1);
    await assert.rejects(load(backend(true)), 'strict load must validate missing manifest/token artifacts after a permissive hit');
    await assert.rejects(load(backend(undefined)), 'default validation remains strict');
  }
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('index validation policy test passed');
