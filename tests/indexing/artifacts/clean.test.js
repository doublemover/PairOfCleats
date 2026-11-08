#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const baseDir = resolveTestCachePath(root, 'clean-artifacts');
const repoRoot = path.join(baseDir, 'repo');
const cacheRoot = path.join(baseDir, 'cache');

await fsPromises.rm(baseDir, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.writeFile(path.join(cacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));

const env = applyTestEnv({ cacheRoot });

const repoCacheRoot = resolveRepoCacheRootPath(repoRoot, { cache: { root: cacheRoot } });
await fsPromises.mkdir(path.join(repoCacheRoot, 'index-code'), { recursive: true });
await fsPromises.mkdir(path.join(repoCacheRoot, 'index-prose'), { recursive: true });
await fsPromises.mkdir(path.join(repoCacheRoot, 'metrics'), { recursive: true });
await fsPromises.writeFile(path.join(repoCacheRoot, 'index-code', 'chunk_meta.json'), '[]');
await fsPromises.writeFile(path.join(repoCacheRoot, 'index-prose', 'chunk_meta.json'), '[]');
await fsPromises.writeFile(path.join(repoCacheRoot, 'metrics', 'metrics.json'), '{}');

const cacheSqliteDir = path.join(repoCacheRoot, 'index-sqlite');
await fsPromises.mkdir(cacheSqliteDir, { recursive: true });
await fsPromises.writeFile(path.join(cacheSqliteDir, 'index-code.db'), 'code');
await fsPromises.writeFile(path.join(cacheSqliteDir, 'index-prose.db'), 'prose');
await fsPromises.writeFile(path.join(cacheSqliteDir, 'index.db'), 'legacy');
await fsPromises.writeFile(path.join(cacheSqliteDir, 'index-code.db.bak'), 'code-bak');
await fsPromises.writeFile(path.join(cacheSqliteDir, 'index.db.bak'), 'legacy-bak');

const legacySqliteDir = path.join(repoRoot, 'index-sqlite');
await fsPromises.mkdir(legacySqliteDir, { recursive: true });
await fsPromises.writeFile(path.join(legacySqliteDir, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
await fsPromises.writeFile(path.join(legacySqliteDir, 'index-code.db'), 'legacy-code');
await fsPromises.writeFile(path.join(legacySqliteDir, 'index-prose.db'), 'legacy-prose');
await fsPromises.writeFile(path.join(legacySqliteDir, 'index.db'), 'legacy-index');
await fsPromises.writeFile(path.join(legacySqliteDir, 'index.db.bak'), 'legacy-index-bak');

const modelsDir = path.join(cacheRoot, 'models');
const dictDir = path.join(cacheRoot, 'dictionaries');
const extensionsDir = path.join(cacheRoot, 'extensions');
await fsPromises.mkdir(modelsDir, { recursive: true });
await fsPromises.mkdir(dictDir, { recursive: true });
await fsPromises.mkdir(extensionsDir, { recursive: true });
await fsPromises.writeFile(path.join(modelsDir, 'model.bin'), 'model');
await fsPromises.writeFile(path.join(dictDir, 'en.txt'), 'word');
await fsPromises.writeFile(path.join(extensionsDir, 'ext.bin'), 'ext');

const result = runNode(
  [path.join(root, 'tools', 'index', 'clean-artifacts.js'), '--repo', repoRoot],
  'clean-artifacts',
  repoRoot,
  env,
  { stdio: 'inherit', allowFailure: true }
);

assert.equal(result.status, 1, 'mixed indexes, retained metrics and legacy databases require their category owners');
assert.equal(await fsPromises.readFile(path.join(repoCacheRoot, 'metrics', 'metrics.json'), 'utf8'), '{}');
assert.equal(await fsPromises.readFile(path.join(cacheSqliteDir, 'index-code.db.bak'), 'utf8'), 'code-bak');
assert.equal(await fsPromises.readFile(path.join(legacySqliteDir, 'index.db.bak'), 'utf8'), 'legacy-index-bak');

// Prepare the independent deletion positive using only this disposable fixture's
// registered derived-cache payload. The CLI itself must preserve the mixed roots.
for (const directory of [repoCacheRoot, legacySqliteDir]) {
  const relative = path.relative(baseDir, directory);
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  await fsPromises.rm(directory, { recursive: true, force: true });
}
const seedDerived = async () => {
  await fsPromises.mkdir(repoCacheRoot, { recursive: true });
  await fsPromises.writeFile(path.join(repoCacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  await fsPromises.writeFile(path.join(repoCacheRoot, 'tree-sitter-chunk_lk1_' + 'a'.repeat(40) + '.json'),
    JSON.stringify(withGeneratedCacheMetadata({ chunks: [] }, 'tree-sitter-chunks')));
};
await seedDerived();
const removed = runNode([path.join(root, 'tools', 'index', 'clean-artifacts.js'), '--repo', repoRoot],
  'clean-artifacts qualified cache', repoRoot, env, { stdio: 'inherit', allowFailure: true });
assert.equal(removed.status, 0, 'a fully qualified derived cache is removable');

const failures = [];
if (fs.existsSync(repoCacheRoot)) failures.push(`repo cache root still exists: ${repoCacheRoot}`);
if (fs.existsSync(path.join(cacheSqliteDir, 'index-code.db.bak'))) {
  failures.push('sqlite .bak file still exists after clean-artifacts.');
}
if (!fs.existsSync(modelsDir)) failures.push('models dir missing after clean-artifacts.');
if (!fs.existsSync(dictDir)) failures.push('dictionaries dir missing after clean-artifacts.');
if (!fs.existsSync(extensionsDir)) failures.push('extensions dir missing after clean-artifacts.');

await seedDerived();

const resultAll = runNode(
  [path.join(root, 'tools', 'index', 'clean-artifacts.js'), '--repo', repoRoot, '--all'],
  'clean-artifacts --all',
  repoRoot,
  env,
  { stdio: 'inherit', allowFailure: true }
);

if (resultAll.status !== 0) {
  console.error('clean-artifacts --all test failed: script exited with non-zero status.');
  process.exit(resultAll.status ?? 1);
}

if (fs.existsSync(repoCacheRoot)) {
  failures.push(`qualified repo cache still exists after --all: ${repoCacheRoot}`);
}
if (!fs.existsSync(modelsDir)) failures.push('models dir missing after clean-artifacts --all.');
if (!fs.existsSync(dictDir)) failures.push('dictionaries dir missing after clean-artifacts --all.');
if (!fs.existsSync(extensionsDir)) failures.push('extensions dir missing after clean-artifacts --all.');

if (failures.length) {
  failures.forEach((msg) => console.error(msg));
  process.exit(1);
}

console.log('clean-artifacts test passed');

