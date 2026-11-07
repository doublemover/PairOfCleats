import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { status } from '../../../src/integrations/core/status.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';
const { dir } = await prepareIsolatedTestCacheDir('status-overload-options');
const repo = path.join(dir, 'repo'), cacheRoot = path.join(dir, 'cache');
await fs.mkdir(repo); await fs.mkdir(path.join(cacheRoot, 'repos', 'known'), { recursive: true });
await fs.writeFile(path.join(cacheRoot, 'repos', 'known', 'marker'), 'known');
applyTestEnv({ cacheRoot, embeddings: 'off', testConfig: { cache: { root: cacheRoot } } });
try {
  const plain = await status(repo);
  assert.equal(plain.allRepos, undefined);
  const stringForm = await status(repo, { includeAll: true, repoRoot: path.join(dir, 'wrong') });
  const objectForm = await status({ repoRoot: repo, includeAll: true });
  assert.equal(stringForm.repo.root, toRealPathSync(repo));
  assert.equal(objectForm.repo.root, stringForm.repo.root);
  assert.deepEqual(stringForm.allRepos, objectForm.allRepos);
  assert.ok(stringForm.allRepos.repos.some(row => row.id === 'known'));
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Both documented status overloads honor includeAll and explicit repository identity.');
