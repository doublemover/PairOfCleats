#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { INDEX_SIGNATURE_TTL_MS, buildIndexSignature, createIndexCache, loadIndexWithCache } from '../../../src/retrieval/index-cache.js';
import { getIndexSignature } from '../../../src/retrieval/cli-index.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const observeCacheLookups = (cache, count) => {
  const reached = deferred();
  const get = cache.get.bind(cache);
  let calls = 0;
  cache.get = (key) => {
    if (++calls === count) reached.resolve(key);
    return get(key);
  };
  return reached.promise;
};

const cases = [
  {
    name: 'managed caches share concurrent cold materialization and retry failed loads',
    async run() {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-index-single-flight-'));
      try {
        await fs.writeFile(path.join(dir, 'index_state.json'), JSON.stringify({ buildId: 'shared', mode: 'code' }));
        const cache = createIndexCache({ maxEntries: 4, ttlMs: 0 });
        const value = { loaded: 'shared' };
        let loads = 0;
        const gate = deferred();
        const entered = deferred();
        const lookedUp = observeCacheLookups(cache, 2);
        const loader = async () => { loads += 1; entered.resolve(); await gate.promise; return value; };
        const results = Promise.all([
          loadIndexWithCache(cache, dir, {}, loader),
          loadIndexWithCache(cache, dir, {}, loader)
        ]);
        try {
          await lookedUp;
          await entered.promise;
          assert.equal(loads, 1, 'concurrent cold requests must materialize one shared index');
        } finally {
          gate.resolve();
        }
        assert.deepEqual(await results, [value, value]);
        assert.strictEqual(await loadIndexWithCache(cache, dir, {}, loader), value);
        assert.equal(loads, 1);

        cache.clear();
        const failure = new Error('shared load failure');
        const failureGate = deferred();
        const failureEntered = deferred();
        const failuresLookedUp = observeCacheLookups(cache, 2);
        const failingLoader = async () => { loads += 1; failureEntered.resolve(); await failureGate.promise; throw failure; };
        const failures = Promise.allSettled([
          loadIndexWithCache(cache, dir, {}, failingLoader),
          loadIndexWithCache(cache, dir, {}, failingLoader)
        ]);
        try {
          await failuresLookedUp;
          await failureEntered.promise;
          assert.equal(loads, 2, 'one failed attempt should be shared by its current waiters');
        } finally {
          failureGate.resolve();
        }
        for (const result of await failures) {
          assert.equal(result.status, 'rejected');
          assert.strictEqual(result.reason, failure);
        }
        assert.strictEqual(await loadIndexWithCache(cache, dir, {}, loader), value);
        assert.equal(loads, 3, 'failure must not poison the next load');
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'pending loads respect invalidation, replacement and generation boundaries',
    async run() {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-index-pending-generation-'));
      try {
        const statePath = path.join(dir, 'index_state.json');
        for (const invalidation of ['clear', 'delete', 'set', 'state']) {
          await fs.writeFile(statePath, JSON.stringify({ buildId: 'original', mode: 'code' }));
          const cache = createIndexCache({ maxEntries: 4, ttlMs: 0 });
          const originalEntered = deferred();
          const originalGate = deferred();
          const originalKey = observeCacheLookups(cache, 1);
          const originalValue = { generation: 'original' };
          const replacementValue = { generation: 'replacement' };
          const original = loadIndexWithCache(cache, dir, {}, async () => {
            originalEntered.resolve();
            await originalGate.promise;
            return originalValue;
          });
          try {
            await originalEntered.promise;
            if (invalidation === 'clear') cache.clear();
            if (invalidation === 'delete') cache.delete(await originalKey);
            if (invalidation === 'set') {
              cache.set(await originalKey, { signature: await buildIndexSignature(dir), value: replacementValue });
            }
            if (invalidation === 'state') {
              await fs.writeFile(statePath, JSON.stringify({ buildId: 'replacement', mode: 'code' }));
            }
            const replacement = await loadIndexWithCache(cache, dir, {}, () => replacementValue);
            assert.strictEqual(replacement, replacementValue);
            originalGate.resolve();
            assert.strictEqual(await original, originalValue, 'existing waiters retain their own result');
            assert.strictEqual(await loadIndexWithCache(cache, dir, {}, () => {
              throw new Error('replacement should remain warm');
            }), replacementValue, `${invalidation} must prevent late original publication`);
          } finally {
            originalGate.resolve();
            await original;
          }
        }

        for (const optionPair of [
          [{ includeDense: false }, { includeDense: true }],
          [{ generationTag: { buildId: 'a' } }, { generationTag: { buildId: 'b' } }]
        ]) {
          const cache = createIndexCache({ maxEntries: 4, ttlMs: 0 });
          const gate = deferred();
          const bothEntered = deferred();
          let loads = 0;
          const loader = async (_dir, options) => {
            if (++loads === 2) bothEntered.resolve();
            await gate.promise;
            return options;
          };
          const results = Promise.all(optionPair.map((options) => loadIndexWithCache(cache, dir, options, loader)));
          try {
            await bothEntered.promise;
            assert.equal(loads, 2, 'different options or generations must not share pending materialization');
          } finally {
            gate.resolve();
          }
          assert.deepEqual(await results, optionPair);
        }

        const replacingCache = createIndexCache({ maxEntries: 4, ttlMs: 0 });
        const oldEntered = deferred();
        const oldGate = deferred();
        const newEntered = deferred();
        const newGate = deferred();
        const oldValue = { generation: 'retired' };
        const newValue = { generation: 'active' };
        const oldLoad = loadIndexWithCache(replacingCache, dir, {}, async () => {
          oldEntered.resolve();
          await oldGate.promise;
          return oldValue;
        });
        let replacement;
        try {
          await oldEntered.promise;
          replacingCache.clear();
          replacement = loadIndexWithCache(replacingCache, dir, {}, async () => {
            newEntered.resolve();
            await newGate.promise;
            return newValue;
          });
          await newEntered.promise;
          oldGate.resolve();
          assert.strictEqual(await oldLoad, oldValue);
          const joiningLookup = observeCacheLookups(replacingCache, 1);
          const joined = loadIndexWithCache(replacingCache, dir, {}, () => ({ unexpected: 'duplicate' }));
          await joiningLookup;
          newGate.resolve();
          assert.strictEqual(await replacement, newValue);
          assert.strictEqual(await joined, newValue, 'an old completion must not remove the still-pending replacement');
        } finally {
          oldGate.resolve();
          newGate.resolve();
          await Promise.allSettled([oldLoad, replacement]);
        }

        const probingCache = createIndexCache({ maxEntries: 4, ttlMs: 0 });
        const probeEntered = deferred();
        const probeGate = deferred();
        const originalRealpath = fs.realpath;
        let blockFirstProbe = true;
        fs.realpath = async (...args) => {
          if (blockFirstProbe && args[0] === dir) {
            blockFirstProbe = false;
            probeEntered.resolve();
            await probeGate.promise;
          }
          return originalRealpath(...args);
        };
        let probingLoad;
        try {
          probingLoad = loadIndexWithCache(probingCache, dir, {}, () => oldValue);
          await probeEntered.promise;
          probingCache.clear();
          assert.strictEqual(await loadIndexWithCache(probingCache, dir, {}, () => newValue), newValue);
          probeGate.resolve();
          assert.strictEqual(await probingLoad, oldValue);
          assert.strictEqual(await loadIndexWithCache(probingCache, dir, {}, () => {
            throw new Error('cleared pre-probe load must not replace the warm value');
          }), newValue);
        } finally {
          probeGate.resolve();
          fs.realpath = originalRealpath;
          await Promise.allSettled([probingLoad]);
        }
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'signal-bearing loads and externally owned caches remain independent',
    async run() {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-index-independent-loads-'));
      try {
        await fs.writeFile(path.join(dir, 'index_state.json'), JSON.stringify({ buildId: 'independent', mode: 'code' }));
        for (const cache of [new Map(), createIndexCache({ maxEntries: 0 })]) {
          const gate = deferred();
          const bothEntered = deferred();
          let loads = 0;
          const loader = async () => {
            if (++loads === 2) bothEntered.resolve();
            await gate.promise;
            return {};
          };
          const results = Promise.all([
            loadIndexWithCache(cache, dir, {}, loader), loadIndexWithCache(cache, dir, {}, loader)
          ]);
          try {
            await bothEntered.promise;
            assert.equal(loads, 2, 'raw and disabled caches preserve independent loading');
          } finally {
            gate.resolve();
          }
          await results;
        }

        const cache = createIndexCache({ maxEntries: 4, ttlMs: 0 });
        const controller = new AbortController();
        const gate = deferred();
        const bothEntered = deferred();
        const cancellation = new Error('this caller cancelled');
        const value = { loaded: 'uncancelled' };
        let loads = 0;
        const loader = async (_dir, options) => {
          if (++loads === 2) bothEntered.resolve();
          if (options.signal) {
            assert.strictEqual(options.signal, controller.signal);
            await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(cancellation), { once: true }));
          }
          await gate.promise;
          return value;
        };
        const results = Promise.allSettled([
          loadIndexWithCache(cache, dir, { signal: controller.signal }, loader),
          loadIndexWithCache(cache, dir, {}, loader)
        ]);
        try {
          await bothEntered.promise;
          assert.equal(loads, 2, 'caller-controlled cancellation must not govern shared loading');
        } finally {
          controller.abort();
          gate.resolve();
        }
        const [cancelled, succeeded] = await results;
        assert.equal(cancelled.status, 'rejected');
        assert.strictEqual(cancelled.reason, cancellation);
        assert.equal(succeeded.status, 'fulfilled');
        assert.strictEqual(succeeded.value, value);
        assert.strictEqual(await loadIndexWithCache(cache, dir, {}, loader), value);
        assert.equal(loads, 2, 'one cancelled caller cannot poison another caller or its warm result');
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'loadIndexWithCache reuses entries until signature or generation changes',
    async run() {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-index-cache-'));
      try {
        const indexDir = path.join(tempRoot, 'index');
        await fs.mkdir(indexDir, { recursive: true });
        const writeMeta = async (value) => {
          await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(value));
        };

        const cache = new Map();
        let loads = 0;
        const loader = () => ({ loaded: ++loads });

        await writeMeta([{ id: 1 }]);
        const first = await loadIndexWithCache(cache, indexDir, { modelIdDefault: 'm', fileChargramN: 3 }, loader);
        const second = await loadIndexWithCache(cache, indexDir, { modelIdDefault: 'm', fileChargramN: 3 }, loader);
        assert.equal(loads, 1);
        assert.equal(first.loaded, second.loaded);

        const chunkMetaModeCache = new Map();
        let chunkMetaModeLoads = 0;
        const chunkMetaModeLoader = () => ({ loaded: ++chunkMetaModeLoads });
        await loadIndexWithCache(
          chunkMetaModeCache,
          indexDir,
          { modelIdDefault: 'm', fileChargramN: 3, includeChunkMetaCold: false },
          chunkMetaModeLoader
        );
        await loadIndexWithCache(
          chunkMetaModeCache,
          indexDir,
          { modelIdDefault: 'm', fileChargramN: 3, includeChunkMetaCold: false },
          chunkMetaModeLoader
        );
        await loadIndexWithCache(
          chunkMetaModeCache,
          indexDir,
          { modelIdDefault: 'm', fileChargramN: 3, includeChunkMetaCold: true },
          chunkMetaModeLoader
        );
        assert.equal(chunkMetaModeLoads, 2);

        const generationScopedCache = new Map();
        let generationScopedLoads = 0;
        const generationScopedLoader = () => ({ loaded: ++generationScopedLoads });
        await loadIndexWithCache(
          generationScopedCache,
          indexDir,
          {
            modelIdDefault: 'm',
            fileChargramN: 3,
            generationTag: { mode: 'code', buildId: 'build-a', buildGenerationKey: 'gen-a' }
          },
          generationScopedLoader
        );
        await loadIndexWithCache(
          generationScopedCache,
          indexDir,
          {
            modelIdDefault: 'm',
            fileChargramN: 3,
            generationTag: { mode: 'code', buildId: 'build-a', buildGenerationKey: 'gen-a' }
          },
          generationScopedLoader
        );
        await loadIndexWithCache(
          generationScopedCache,
          indexDir,
          {
            modelIdDefault: 'm',
            fileChargramN: 3,
            generationTag: { mode: 'code', buildId: 'build-b', buildGenerationKey: 'gen-b' }
          },
          generationScopedLoader
        );
        assert.equal(generationScopedLoads, 2);

        await writeMeta([{ id: 2 }]);
        const originalNow = Date.now;
        let now = originalNow();
        try {
          Date.now = () => now;
          now += INDEX_SIGNATURE_TTL_MS + 1;
          const third = await loadIndexWithCache(cache, indexDir, { modelIdDefault: 'm', fileChargramN: 3 }, loader);
          assert.equal(loads, 2);
          assert.notEqual(third.loaded, first.loaded);
        } finally {
          Date.now = originalNow;
        }
      } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'same-build embedding state updates invalidate warm file-backed indexes',
    async run() {
      const indexDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-index-state-update-'));
      try {
        const statePath = path.join(indexDir, 'index_state.json');
        const state = {
          buildId: 'same-build',
          mode: 'code',
          artifactSurfaceVersion: '1',
          updatedAt: '2026-10-02T00:00:00.000Z',
          embeddings: { enabled: true, ready: false, pending: true }
        };
        const writeState = () => fs.writeFile(statePath, JSON.stringify(state));
        const cache = new Map();
        const options = { generationTag: { buildId: state.buildId } };
        let loads = 0;
        const loader = async () => ({
          loaded: ++loads,
          state: JSON.parse(await fs.readFile(statePath, 'utf8'))
        });

        await writeState();
        const pending = await loadIndexWithCache(cache, indexDir, options, loader);
        assert.strictEqual(await loadIndexWithCache(cache, indexDir, options, loader), pending);
        const pendingSignature = await buildIndexSignature(indexDir);

        // Standalone embedding completion updates state in the existing build.
        // Do not rely on a new build ID, directory, or signature-cache TTL.
        state.updatedAt = '2026-10-02T00:00:01.000Z';
        state.embeddings = { enabled: true, ready: true, pending: false };
        await writeState();
        const ready = await loadIndexWithCache(cache, indexDir, options, loader);
        assert.equal(ready.state.embeddings.ready, true);
        assert.equal(loads, 2, 'embedding completion must reload a warm same-build index');
        assert.notEqual(await buildIndexSignature(indexDir), pendingSignature);

        // Distinct changes can share a timestamp. The full state, not just
        // updatedAt, must invalidate both loaded-index and search signatures.
        const readySignature = await buildIndexSignature(indexDir);
        state.embeddings.embeddingIdentityKey = 'replacement-model';
        await writeState();
        const replacement = await loadIndexWithCache(cache, indexDir, options, loader);
        assert.equal(replacement.state.embeddings.embeddingIdentityKey, 'replacement-model');
        assert.equal(loads, 3);
        assert.notEqual(await buildIndexSignature(indexDir), readySignature);

        // Rewriting identical state does not turn mtime-only changes into reloads.
        await writeState();
        assert.strictEqual(await loadIndexWithCache(cache, indexDir, options, loader), replacement);
        assert.equal(loads, 3);
      } finally {
        await fs.rm(indexDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'index signature cache evicts oldest entries beyond the 256-entry cap',
    async run() {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-index-signature-cache-'));
      const dirs = [];
      try {
        for (let index = 0; index < 257; index += 1) {
          const dir = path.join(root, `idx-${index}`);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(
            path.join(dir, 'index_state.json'),
            JSON.stringify({ buildId: `build-${index}`, mode: 'code', artifactSurfaceVersion: '1' }),
            'utf8'
          );
          dirs.push(dir);
        }

        for (const dir of dirs) {
          await buildIndexSignature(dir);
        }

        const originalReadFile = fs.readFile;
        let readCount = 0;
        fs.readFile = async (...args) => {
          readCount += 1;
          return originalReadFile(...args);
        };
        try {
          await buildIndexSignature(dirs[0]);
        } finally {
          fs.readFile = originalReadFile;
        }
        assert.ok(readCount > 0);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'cli index signatures include sharded chunk meta manifests and part hashes',
    async run() {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-chunk-meta-sig-'));
      try {
        const codeDir = path.join(rootDir, 'index-code');
        const partsDir = path.join(codeDir, 'chunk_meta.parts');
        await fs.mkdir(partsDir, { recursive: true });

        await fs.writeFile(
          path.join(partsDir, 'chunk_meta.part-0000.jsonl'),
          `${JSON.stringify({ id: 0, file: 'src/a.js', start: 0, end: 1 })}\n`
        );
        await fs.writeFile(path.join(codeDir, 'chunk_meta.meta.json'), JSON.stringify({
          schemaVersion: '0.0.1',
          artifact: 'chunk_meta',
          format: 'jsonl-sharded',
          generatedAt: new Date().toISOString(),
          compression: 'none',
          totalRecords: 1,
          totalBytes: 1,
          maxPartRecords: 1,
          maxPartBytes: 1,
          targetMaxBytes: 1,
          parts: [{ path: 'chunk_meta.parts/chunk_meta.part-0000.jsonl', records: 1, bytes: 1 }]
        }, null, 2));

        const signature = await getIndexSignature({
          useSqlite: false,
          backendLabel: 'memory',
          sqliteCodePath: null,
          sqliteProsePath: null,
          runRecords: false,
          runExtractedProse: false,
          includeExtractedProse: false,
          root: rootDir,
          userConfig: {}
        });

        assert.equal(signature.modes?.code?.includes('chunk_meta.meta.json:'), true);
        assert.equal(signature.modes?.code?.includes('|parts:'), true);
      } finally {
        await fs.rm(rootDir, { recursive: true, force: true });
      }
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('index cache contract matrix test passed');
