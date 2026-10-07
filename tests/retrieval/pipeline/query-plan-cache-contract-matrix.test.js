#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createQueryPlanCache,
  createQueryPlanDiskCache,
  createQueryPlanEntry
} from '../../../src/retrieval/query-plan-cache.js';
import { validateQueryPlan } from '../../../src/retrieval/query-plan-schema.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  buildPlanCacheKey,
  buildPlanConfigSignature,
  buildPlanIndexSignature,
  buildTestPlan,
  createPlanInputs
} from './query-plan-helpers.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const buildEntryContext = (overrides = {}) => {
  const inputs = createPlanInputs(overrides);
  const plan = buildTestPlan(inputs);
  const configSignature = buildPlanConfigSignature(inputs);
  const indexSignature = buildPlanIndexSignature(overrides.indexSignatureValue ?? null);
  const keyInfo = buildPlanCacheKey({
    query: inputs.query,
    configSignature,
    indexSignature
  });
  return { inputs, plan, configSignature, indexSignature, keyInfo };
};

const cases = [
  {
    name: 'cache keys stay stable and change with query/config/index inputs',
    run() {
      const { inputs, configSignature, indexSignature, keyInfo } = buildEntryContext();

      const sameKeyInfo = buildPlanCacheKey({
        query: inputs.query,
        configSignature,
        indexSignature
      });
      assert.equal(keyInfo.key, sameKeyInfo.key);

      const differentQueryKey = buildPlanCacheKey({
        query: `${inputs.query} extra`,
        configSignature,
        indexSignature
      });
      assert.notEqual(keyInfo.key, differentQueryKey.key);

      const differentConfigKey = buildPlanCacheKey({
        query: inputs.query,
        configSignature: `${configSignature}-alt`,
        indexSignature
      });
      assert.notEqual(keyInfo.key, differentConfigKey.key);

      const differentIndexKey = buildPlanCacheKey({
        query: inputs.query,
        configSignature,
        indexSignature: buildPlanIndexSignature({ backend: 'memory', code: 'sig-alt' })
      });
      assert.notEqual(keyInfo.key, differentIndexKey.key);
    }
  },
  {
    name: 'query plans satisfy runtime schema requirements',
    run() {
      const { plan } = buildEntryContext({ query: 'alpha "beta gamma"' });
      assert.ok(validateQueryPlan(plan));
      assert.ok(Array.isArray(plan.queryTokens));
      assert.ok(plan.highlightRegex instanceof RegExp);
      assert.ok(plan.phraseNgramSet instanceof Set || plan.phraseNgramSet === null);
      assert.ok(plan.requiredArtifacts instanceof Set);
    }
  },
  {
    name: 'in-memory cache returns hits for matching config and index signatures',
    run() {
      const cache = createQueryPlanCache({ maxEntries: 5, ttlMs: 60_000 });
      const { plan, configSignature, indexSignature, keyInfo } = buildEntryContext();

      cache.set(keyInfo.key, createQueryPlanEntry({
        plan,
        configSignature,
        indexSignature,
        keyPayload: keyInfo.payload
      }));

      const cached = cache.get(keyInfo.key, { configSignature, indexSignature });
      assert.ok(cached);
      assert.equal(cached.plan, plan);
    }
  },
  {
    name: 'in-memory cache invalidates on schema version mismatch',
    run() {
      const cache = createQueryPlanCache({ maxEntries: 5, ttlMs: 60_000 });
      const { plan, configSignature, indexSignature, keyInfo } = buildEntryContext();
      const entry = createQueryPlanEntry({
        plan,
        configSignature,
        indexSignature,
        keyPayload: keyInfo.payload
      });
      entry.schemaVersion = 0;
      cache.set(keyInfo.key, entry);
      assert.equal(cache.get(keyInfo.key, { configSignature, indexSignature }), null);
    }
  },
  {
    name: 'in-memory cache invalidates on index signature changes',
    run() {
      const cache = createQueryPlanCache({ maxEntries: 5, ttlMs: 60_000 });
      const { plan, configSignature, indexSignature, keyInfo } = buildEntryContext({
        indexSignatureValue: { backend: 'memory', code: 'sig-a' }
      });
      cache.set(keyInfo.key, createQueryPlanEntry({
        plan,
        configSignature,
        indexSignature,
        keyPayload: keyInfo.payload
      }));
      const differentIndexSignature = buildPlanIndexSignature({ backend: 'memory', code: 'sig-b' });
      assert.equal(cache.get(keyInfo.key, {
        configSignature,
        indexSignature: differentIndexSignature
      }), null);
    }
  },
  {
    name: 'in-memory cache invalidates on config changes',
    run() {
      const cache = createQueryPlanCache({ maxEntries: 5, ttlMs: 60_000 });
      const { plan, configSignature, indexSignature, keyInfo } = buildEntryContext();
      cache.resetIfConfigChanged(configSignature);
      cache.set(keyInfo.key, createQueryPlanEntry({
        plan,
        configSignature,
        indexSignature,
        keyPayload: keyInfo.payload
      }));
      cache.resetIfConfigChanged(`${configSignature}-changed`);
      assert.equal(cache.get(keyInfo.key, { configSignature, indexSignature }), null);
    }
  },
  {
    name: 'in-memory cache evicts oldest entries when max size is exceeded',
    run() {
      const cache = createQueryPlanCache({ maxEntries: 1, ttlMs: 60_000 });

      const entryA = buildEntryContext({
        query: 'alpha',
        indexSignatureValue: { backend: 'memory', code: 'sig-a' }
      });
      cache.set(entryA.keyInfo.key, createQueryPlanEntry({
        plan: entryA.plan,
        configSignature: entryA.configSignature,
        indexSignature: entryA.indexSignature,
        keyPayload: entryA.keyInfo.payload
      }));

      const entryB = buildEntryContext({
        query: 'beta',
        indexSignatureValue: { backend: 'memory', code: 'sig-b' }
      });
      cache.set(entryB.keyInfo.key, createQueryPlanEntry({
        plan: entryB.plan,
        configSignature: entryB.configSignature,
        indexSignature: entryB.indexSignature,
        keyPayload: entryB.keyInfo.payload
      }));

      assert.equal(
        cache.get(entryA.keyInfo.key, {
          configSignature: entryA.configSignature,
          indexSignature: entryA.indexSignature
        }),
        null
      );
      assert.ok(
        cache.get(entryB.keyInfo.key, {
          configSignature: entryB.configSignature,
          indexSignature: entryB.indexSignature
        })
      );
    }
  },
  {
    name: 'in-memory cache size never exceeds configured max entries',
    run() {
      const cache = createQueryPlanCache({ maxEntries: 2, ttlMs: 1_000 });

      const makeEntry = (query) => {
        const ctx = buildEntryContext({
          query,
          indexSignatureValue: { code: `sig:${query}` }
        });
        return {
          key: ctx.keyInfo.key,
          configSignature: ctx.configSignature,
          indexSignature: ctx.indexSignature,
          entry: createQueryPlanEntry({
            plan: ctx.plan,
            configSignature: ctx.configSignature,
            indexSignature: ctx.indexSignature,
            keyPayload: ctx.keyInfo.payload
          })
        };
      };

      const a = makeEntry('alpha');
      const b = makeEntry('beta');
      const c = makeEntry('gamma');

      cache.set(a.key, a.entry);
      cache.set(b.key, b.entry);
      cache.set(c.key, c.entry);

      assert.ok(cache.size() <= 2);
      assert.equal(cache.get(a.key, { configSignature: a.configSignature, indexSignature: a.indexSignature }), null);
      assert.ok(cache.get(b.key, { configSignature: b.configSignature, indexSignature: b.indexSignature }));
      assert.ok(cache.get(c.key, { configSignature: c.configSignature, indexSignature: c.indexSignature }));
    }
  },
  {
    name: 'disk cache persists and rehydrates query plans',
    async run() {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-query-plan-'));
      const cachePath = path.join(tempDir, 'queryPlanCache.json');
      const cache = createQueryPlanDiskCache({
        path: cachePath,
        maxEntries: 5,
        ttlMs: 60_000,
        maxBytes: 1024 * 1024
      });
      const { plan, configSignature, indexSignature, keyInfo } = buildEntryContext({ query: 'alpha beta' });

      cache.load();
      cache.set(keyInfo.key, createQueryPlanEntry({
        plan,
        configSignature,
        indexSignature,
        keyPayload: keyInfo.payload
      }));
      await cache.persist();

      assert.ok(fs.existsSync(cachePath));

      const freshCache = createQueryPlanDiskCache({
        path: cachePath,
        maxEntries: 5,
        ttlMs: 60_000,
        maxBytes: 1024 * 1024
      });
      freshCache.load();
      const cached = freshCache.get(keyInfo.key, { configSignature, indexSignature });
      assert.ok(cached);
      assert.ok(Array.isArray(cached.plan.queryTokens));
      assert.ok(cached.plan.highlightRegex instanceof RegExp);
      assert.ok(cached.plan.phraseNgramSet == null || cached.plan.phraseNgramSet instanceof Set);
    }
  },
  {
    name: 'corrupt disk cache files are evicted on load',
    run() {
      const root = process.cwd();
      const tempRoot = resolveTestCachePath(root, 'query-plan-cache-contract-matrix-corrupt');
      fs.rmSync(tempRoot, { recursive: true, force: true });
      fs.mkdirSync(tempRoot, { recursive: true });
      const cachePath = path.join(tempRoot, 'queryPlanCache.json');
      fs.writeFileSync(cachePath, '{not-json', 'utf8');

      const cache = createQueryPlanDiskCache({
        path: cachePath,
        maxEntries: 8,
        ttlMs: 60_000,
        maxBytes: 1024 * 1024
      });

      assert.equal(cache.load(), 0);
      assert.equal(fs.existsSync(cachePath), false);
    }
  },
  {
    name: 'disk cache respects max byte caps',
    async run() {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-query-plan-size-'));
      const cachePath = path.join(tempDir, 'queryPlanCache.json');
      const maxBytes = 1500;
      const cache = createQueryPlanDiskCache({
        path: cachePath,
        maxEntries: 10,
        ttlMs: 60_000,
        maxBytes
      });

      cache.load();
      for (let index = 0; index < 8; index += 1) {
        const { plan, configSignature, indexSignature, keyInfo } = buildEntryContext({
          query: `alpha beta ${'x'.repeat(index * 40)}`
        });
        cache.set(keyInfo.key, createQueryPlanEntry({
          plan,
          configSignature,
          indexSignature,
          keyPayload: keyInfo.payload
        }));
      }

      await cache.persist();
      const stats = fs.statSync(cachePath);
      assert.ok(stats.size <= maxBytes, `expected cache size <= ${maxBytes}, got ${stats.size}`);

      const payload = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      assert.ok(Array.isArray(payload.entries));
      assert.ok(payload.entries.length <= 8);
    }
  },
  {
    name: 'oversize newest entries are skipped so smaller older entries survive',
    async run() {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-query-plan-size-oversize-head-'));
      const cachePath = path.join(tempDir, 'queryPlanCache.json');
      const cache = createQueryPlanDiskCache({
        path: cachePath,
        maxEntries: 10,
        ttlMs: 60_000,
        maxBytes: 10_000
      });

      const makeEntry = (query, ts) => {
        const { plan, configSignature, indexSignature, keyInfo } = buildEntryContext({ query });
        const entry = createQueryPlanEntry({
          plan,
          configSignature,
          indexSignature,
          keyPayload: keyInfo.payload
        });
        entry.ts = ts;
        return { key: keyInfo.key, entry };
      };

      const now = Date.now();
      const small = makeEntry('small query', now - 1000);
      const huge = makeEntry(`huge query ${'x'.repeat(16_000)}`, now);

      cache.set(small.key, small.entry);
      cache.set(huge.key, huge.entry);
      await cache.persist();

      const payload = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const persistedKeys = new Set((payload.entries || []).map((entry) => entry?.key));

      assert.equal(persistedKeys.has(small.key), true);
      assert.equal(persistedKeys.has(huge.key), false);
    }
  }
];

for (const entry of cases) {
  await entry.run();
}

console.log('query plan cache contract matrix test passed');
