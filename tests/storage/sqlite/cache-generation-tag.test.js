#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-sqlite-cache-generation-'));
const dbPath = path.join(tempRoot, 'index.db');
await fs.writeFile(dbPath, 'initial');

const cache = createSqliteDbCache();
let closedA = 0;
let closedB = 0;
const dbA = { close: () => { closedA += 1; } };
const dbB = { close: () => { closedB += 1; } };

cache.set(dbPath, dbA, {
  generationTag: { mode: 'code', buildId: 'build-a', buildGenerationKey: 'gen-a' }
});

assert.equal(
  cache.get(dbPath, { generationTag: { mode: 'code', buildId: 'build-a', buildGenerationKey: 'gen-a' } }),
  dbA,
  'expected matching generation tag to hit sqlite cache'
);
assert.equal(
  cache.get(dbPath, { generationTag: { mode: 'code', buildId: 'build-a', buildGenerationKey: 'gen-b' } }),
  null,
  'expected build-generation mismatch to miss sqlite cache'
);
assert.equal(
  cache.get(dbPath, { generationTag: { mode: 'code', buildId: 'build-b', buildGenerationKey: 'gen-b' } }),
  null,
  'expected generation tag mismatch to miss sqlite cache'
);

cache.set(dbPath, dbB, {
  generationTag: { mode: 'code', buildId: 'build-b', buildGenerationKey: 'gen-b' }
});

assert.equal(closedA, 1, 'expected prior generation handle to close when replaced');
assert.equal(
  cache.get(dbPath, { generationTag: { mode: 'code', buildId: 'build-a', buildGenerationKey: 'gen-a' } }),
  null,
  'expected prior generation to be evicted'
);
assert.equal(
  cache.get(dbPath, { generationTag: { mode: 'code', buildId: 'build-b', buildGenerationKey: 'gen-b' } }),
  dbB,
  'expected replacement generation to be cached'
);

cache.close(dbPath, { generationTag: { mode: 'code', buildId: 'build-b', buildGenerationKey: 'gen-b' } });
assert.equal(closedB, 1, 'expected closing a specific generation to close its handle');

console.log('sqlite cache generation-tag invalidation ok');
