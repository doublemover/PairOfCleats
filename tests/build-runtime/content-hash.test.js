#!/usr/bin/env node
import { buildContentConfigHash, normalizeContentConfig } from '../../src/index/build/runtime/hash.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const config = {
  indexing: {
    concurrency: 12,
    importConcurrency: 4,
    workerPool: { enabled: true },
    debugCrash: true,
    shards: { enabled: true },
    fileListSampleSize: 123,
    maxFileBytes: 2048
  }
};

const normalized = normalizeContentConfig(config);
if (!normalized.indexing || normalized.indexing.maxFileBytes !== 2048) {
  fail('normalizeContentConfig should preserve relevant indexing fields.');
}
for (const key of ['concurrency', 'importConcurrency', 'workerPool', 'debugCrash', 'shards', 'fileListSampleSize']) {
  if (normalized.indexing[key] !== undefined) {
    fail(`normalizeContentConfig should remove indexing.${key}.`);
  }
}

const envA = { cacheRoot: '/tmp/a', stage: 'stage1' };
const envB = { cacheRoot: '/tmp/b', stage: 'stage1' };
const hashA = buildContentConfigHash(config, envA);
const hashB = buildContentConfigHash(config, envB);
if (hashA !== hashB) {
  fail('buildContentConfigHash should ignore cacheRoot differences.');
}

const configVariant = {
  indexing: {
    concurrency: 1,
    importConcurrency: 2,
    maxFileBytes: 2048
  }
};
const hashC = buildContentConfigHash(configVariant, envA);
if (hashA !== hashC) {
  fail('buildContentConfigHash should ignore concurrency-only changes.');
}

const envC = { cacheRoot: '/tmp/a', stage: 'stage2' };
const hashD = buildContentConfigHash(config, envC);
if (hashA === hashD) {
  fail('buildContentConfigHash should change when env fields change.');
}

const configDiff = {
  indexing: {
    maxFileBytes: 4096
  }
};
const hashE = buildContentConfigHash(configDiff, envA);
if (hashA === hashE) {
  fail('buildContentConfigHash should change when config fields change.');
}

console.log('build runtime content hash tests passed');
