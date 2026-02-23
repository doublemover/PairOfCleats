#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { indexerPipelineInternals } from '../../../src/index/build/indexer/pipeline.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const {
  resolveModalitySparsityProfilePath,
  buildModalitySparsityEntryKey,
  readModalitySparsityProfile,
  writeModalitySparsityEntry,
  shouldElideModalityProcessingStage
} = indexerPipelineInternals;

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'modality-sparsity-profile');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const runtime = {
  root: path.join(root, 'tests', 'fixtures', 'baseline'),
  repoCacheRoot: tempRoot
};

const profilePath = resolveModalitySparsityProfilePath(runtime);
assert.equal(typeof profilePath, 'string', 'expected profile path');
assert.equal(
  profilePath.endsWith(path.join('.testCache', 'modality-sparsity-profile', 'modality-sparsity-profile.json')),
  true,
  'expected deterministic sparsity profile path'
);

const initial = await readModalitySparsityProfile(runtime);
assert.deepEqual(initial.profile.entries, {}, 'expected empty profile by default');

await writeModalitySparsityEntry({
  runtime,
  profilePath: initial.profilePath,
  profile: initial.profile,
  mode: 'code',
  cacheSignature: 'sig-a',
  fileCount: 0,
  chunkCount: 0,
  elided: true,
  source: 'discovery'
});

const afterFirst = await readModalitySparsityProfile(runtime);
const keyA = buildModalitySparsityEntryKey({ mode: 'code', cacheSignature: 'sig-a' });
assert.ok(afterFirst.profile.entries[keyA], 'expected persisted zero-modality entry');
assert.equal(afterFirst.profile.entries[keyA].fileCount, 0, 'expected fileCount=0');
assert.equal(afterFirst.profile.entries[keyA].chunkCount, 0, 'expected chunkCount=0');
assert.equal(afterFirst.profile.entries[keyA].elided, true, 'expected elided marker');
assert.equal(
  shouldElideModalityProcessingStage({
    fileCount: afterFirst.profile.entries[keyA].fileCount,
    chunkCount: afterFirst.profile.entries[keyA].chunkCount
  }),
  true,
  'expected zero-modality entry to trigger processing elision'
);

await writeModalitySparsityEntry({
  runtime,
  profilePath: afterFirst.profilePath,
  profile: afterFirst.profile,
  mode: 'code',
  cacheSignature: 'sig-b',
  fileCount: 12,
  chunkCount: 34,
  elided: false,
  source: 'observed'
});

const afterSecond = await readModalitySparsityProfile(runtime);
const keyB = buildModalitySparsityEntryKey({ mode: 'code', cacheSignature: 'sig-b' });
assert.ok(afterSecond.profile.entries[keyA], 'expected old signature entry retained');
assert.ok(afterSecond.profile.entries[keyB], 'expected new signature entry persisted');
assert.equal(afterSecond.profile.entries[keyB].fileCount, 12, 'expected fileCount persisted');
assert.equal(afterSecond.profile.entries[keyB].chunkCount, 34, 'expected chunkCount persisted');
assert.equal(
  shouldElideModalityProcessingStage({
    fileCount: afterSecond.profile.entries[keyB].fileCount,
    chunkCount: afterSecond.profile.entries[keyB].chunkCount
  }),
  false,
  'expected non-empty modality to bypass elision'
);

console.log('modality sparsity profile cache test passed');
