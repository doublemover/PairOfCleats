#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  findLatestBuildRootWithIndexes,
  resolveCacheScopedBuildIdRoot,
  resolveCacheScopedBuildPointerRoot,
  resolveCurrentBuildRoots
} from '../../../src/shared/indexing/build-pointer.js';
import { normalizeIdentityPath } from '../../../src/workspace/identity.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const normalizePath = (value) => normalizeIdentityPath(path.resolve(value));

const root = process.cwd();
const { dir: tempRoot } = await prepareIsolatedTestCacheDir('build-pointer', { root });
const repoCacheRoot = path.join(tempRoot, 'repo-cache');
const buildsRoot = path.join(repoCacheRoot, 'builds');
const validRoot = path.join(buildsRoot, '20260211T000000Z-valid');
const missingRoot = path.join(buildsRoot, '20260211T010000Z-missing');
const rogueRoot = path.join(repoCacheRoot, '20260211T000000Z-valid');

await fs.mkdir(path.join(validRoot, 'index-code'), { recursive: true });
await fs.writeFile(path.join(validRoot, 'index-code', 'chunk_meta.jsonl.gz'), '', 'utf8');
await fs.mkdir(path.join(missingRoot, 'index-code'), { recursive: true });
await fs.mkdir(path.join(rogueRoot, 'index-code'), { recursive: true });
await fs.writeFile(path.join(rogueRoot, 'index-code', 'chunk_meta.jsonl.gz'), '', 'utf8');

assert.equal(
  resolveCacheScopedBuildPointerRoot(path.join(tempRoot, 'outside-build'), repoCacheRoot, buildsRoot),
  null,
  'expected external buildRoot pointers to be rejected'
);
assert.equal(
  resolveCacheScopedBuildIdRoot(path.relative(buildsRoot, path.join(tempRoot, 'outside-build')), repoCacheRoot, buildsRoot),
  null,
  'expected traversal buildIds to be rejected'
);
assert.equal(
  normalizePath(resolveCacheScopedBuildIdRoot('20260211T000000Z-valid', repoCacheRoot, buildsRoot)),
  normalizePath(validRoot),
  'expected buildId fallback to stay under builds/'
);
assert.equal(
  normalizePath(findLatestBuildRootWithIndexes(buildsRoot, 'code')),
  normalizePath(validRoot),
  'expected latest-build fallback to choose the indexed build root'
);

const resolved = resolveCurrentBuildRoots(
  {
    buildId: '20260211T010000Z-missing',
    buildRoot: missingRoot
  },
  {
    repoCacheRoot,
    buildsRoot,
    preferredMode: 'code'
  }
);
assert.equal(
  normalizePath(resolved.activeRoot),
  normalizePath(validRoot),
  'expected active root fallback to skip empty index dirs'
);

const buildIdOnly = resolveCurrentBuildRoots(
  {
    buildId: '20260211T000000Z-valid',
    modes: ['code']
  },
  {
    repoCacheRoot,
    buildsRoot,
    preferredMode: 'code'
  }
);
assert.equal(
  normalizePath(buildIdOnly.buildRoot),
  normalizePath(validRoot),
  'expected buildId fallback to prefer builds/<buildId>'
);
assert.notEqual(
  normalizePath(buildIdOnly.buildRoot),
  normalizePath(rogueRoot),
  'expected rogue repo-cache sibling root to be ignored'
);

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('shared build pointer test passed');
