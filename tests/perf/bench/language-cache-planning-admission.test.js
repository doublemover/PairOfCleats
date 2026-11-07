import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveRepoCacheRoot } from '../../../tools/bench/language/repos.js';
import { inspectRepoCacheAccess, acquireRepoCacheAccessLease } from '../../../src/shared/cache/repo-access.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const temporary = await makeTempDir('bench-path-planning-');
try {
  const repoPath = path.join(temporary, 'repo'), cacheRoot = path.join(temporary, 'cache');
  await fs.mkdir(repoPath);
  const selected = resolveRepoCacheRoot({ repoPath, cacheRoot });
  assert.ok(selected.startsWith(path.join(cacheRoot, 'repos') + path.sep));
  assert.deepEqual(inspectRepoCacheAccess(selected), [], 'path planning does not claim process-lifetime reader admission');
  const reader = acquireRepoCacheAccessLease(selected);
  try { assert.equal(inspectRepoCacheAccess(selected).length, 1, 'actual resource readers still fence cleanup'); }
  finally { assert.equal(reader.release(), true); }
  assert.deepEqual(inspectRepoCacheAccess(selected), []);
} finally { await rmDirRecursive(temporary); }
console.log('Benchmark path-only planning does not retain a reader, while actual admission remains protected.');
