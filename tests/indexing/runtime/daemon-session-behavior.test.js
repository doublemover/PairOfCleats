#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  __testRuntimeDaemonSessions,
  acquireRuntimeDaemonSession,
  createRuntimeDaemonJobContext,
  addDaemonEmbeddingWarmKey,
  getDaemonDictionaryCache,
  getDaemonEmbeddingWarmSet,
  getDaemonTreeSitterCache,
  setDaemonDictionaryCacheEntry,
  setDaemonTreeSitterCacheEntry
} from '../../../src/index/build/runtime/daemon-session.js';

applyTestEnv();
__testRuntimeDaemonSessions.reset();

const session = acquireRuntimeDaemonSession({
  enabled: true,
  sessionKey: 'tests:daemon-session',
  cacheRoot: 'C:\\tmp\\poc-daemon-tests',
  profile: 'default',
  health: {
    maxJobsBeforeRecycle: 2,
    probeEveryJobs: 1,
    maxDictionaryEntries: 2,
    maxTreeSitterEntries: 2,
    maxEmbeddingWarmEntries: 2,
    maxHeapUsedMb: 8192,
    maxHeapGrowthMb: 8192,
    maxHeapGrowthRatio: 100
  }
});

assert.ok(session, 'expected daemon session to be created');
assert.equal(__testRuntimeDaemonSessions.getSize(), 1, 'expected exactly one tracked session');

setDaemonDictionaryCacheEntry(session, 'dict-a', { words: 1 });
setDaemonDictionaryCacheEntry(session, 'dict-b', { words: 2 });
setDaemonDictionaryCacheEntry(session, 'dict-c', { words: 3 });
assert.equal(getDaemonDictionaryCache(session).size, 2, 'dictionary cache should be LRU-bounded');

setDaemonTreeSitterCacheEntry(session, 'ts-a', 1);
setDaemonTreeSitterCacheEntry(session, 'ts-b', 2);
setDaemonTreeSitterCacheEntry(session, 'ts-c', 3);
assert.equal(getDaemonTreeSitterCache(session).size, 2, 'tree-sitter cache should be LRU-bounded');

addDaemonEmbeddingWarmKey(session, 'emb-a');
addDaemonEmbeddingWarmKey(session, 'emb-b');
addDaemonEmbeddingWarmKey(session, 'emb-c');
assert.equal(getDaemonEmbeddingWarmSet(session).size, 2, 'embedding warm set should be bounded');

const ctx1 = createRuntimeDaemonJobContext(session, { root: 'repo-a', buildId: 'b1' });
assert.equal(ctx1.jobNumber, 1, 'first job should start from 1');
assert.equal(ctx1.generation, 1, 'expected initial generation');
assert.equal(ctx1.recycledBeforeJob, false, 'first job should not recycle');

const ctx2 = createRuntimeDaemonJobContext(session, { root: 'repo-a', buildId: 'b2' });
assert.equal(ctx2.jobNumber, 2, 'second job should increment');
assert.equal(ctx2.generation, 1, 'generation should be unchanged before recycle');
assert.equal(ctx2.recycledBeforeJob, false, 'second job should not recycle');

setDaemonDictionaryCacheEntry(session, 'dict-d', { words: 4 });
setDaemonTreeSitterCacheEntry(session, 'ts-d', 4);
addDaemonEmbeddingWarmKey(session, 'emb-d');

const ctx3 = createRuntimeDaemonJobContext(session, { root: 'repo-a', buildId: 'b3' });
assert.equal(ctx3.jobNumber, 3, 'third job should retain monotonic global numbering');
assert.equal(ctx3.generation, 2, 'third job should execute under recycled generation');
assert.equal(ctx3.generationJobNumber, 1, 'generation-local counter should reset after recycle');
assert.equal(ctx3.recycledBeforeJob, true, 'third job should trigger recycle by job threshold');
assert.equal(session.recycleCount, 1, 'recycle counter should increment once');
assert.equal(getDaemonDictionaryCache(session).size, 0, 'dictionary cache should reset on recycle');
assert.equal(getDaemonTreeSitterCache(session).size, 0, 'tree-sitter cache should reset on recycle');
assert.equal(getDaemonEmbeddingWarmSet(session).size, 0, 'embedding warm set should reset on recycle');

const sameSession = acquireRuntimeDaemonSession({
  enabled: true,
  sessionKey: 'tests:daemon-session',
  health: { maxJobsBeforeRecycle: 2 }
});
assert.equal(sameSession, session, 'acquire should return existing session for same key');

console.log('daemon session behavior test passed');
