import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { getBuildsRoot, getRepoCacheRoot } from '../../../src/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';

const { dir: root } = await prepareIsolatedTestCacheDir('promotion-unreadable-pointer');
applyTestEnv({ cacheRoot: root });
const repoRoot = path.join(root, 'repo');
await fs.mkdir(repoRoot);
try {
  const buildsRoot = getBuildsRoot(repoRoot, {}), cache = getRepoCacheRoot(repoRoot, {});
  const [code, prose, next] = ['code-old', 'prose-old', 'code-new'].map(name => path.join(buildsRoot, name));
  await seedPublishedArtifacts({ buildRoot: code, mode: 'code' });
  await seedPublishedArtifacts({ buildRoot: prose, mode: 'prose' });
  await seedPublishedArtifacts({ buildRoot: next, mode: 'code' });
  const pointer = path.join(buildsRoot, 'current.json');
  const prior = JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId: 'code-old', buildRoot: path.relative(cache, code),
    buildRootsByMode: { code: path.relative(cache, code), prose: path.relative(cache, prose) } });
  const input = { repoRoot, userConfig: {}, buildId: 'code-new', buildRoot: next, modes: ['code'] };
  for (const bytes of ['{malformed', ' '.repeat(512 * 1024 + 1), 'null', '[]']) {
    await fs.writeFile(pointer, bytes);
    await assert.rejects(promoteBuild(input), { code: 'ERR_CURRENT_POINTER_UNREADABLE' });
    assert.equal(await fs.readFile(pointer, 'utf8'), bytes, 'unknown prior authority remains byte-for-byte intact');
  }
  await fs.writeFile(pointer, prior);
  const originalOpen = fs.open;
  const failure = Object.assign(new Error('controlled pointer read failure'), { code: 'EIO' });
  fs.open = async (target, ...args) => {
    if (String(target).toLowerCase() === pointer.toLowerCase()) throw failure;
    return originalOpen(target, ...args);
  };
  try { await assert.rejects(promoteBuild(input), error => error.code === 'ERR_CURRENT_POINTER_UNREADABLE' && error.cause === failure); }
  finally { fs.open = originalOpen; }
  assert.equal(await fs.readFile(pointer, 'utf8'), prior);
  await promoteBuild(input);
  const published = JSON.parse(await fs.readFile(pointer, 'utf8'));
  assert.equal(published.buildRootsByMode.code, path.relative(cache, next).replaceAll('\\', '/'));
  assert.equal(published.buildRootsByMode.prose, path.relative(cache, prose).replaceAll('\\', '/'));
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Partial promotion preserves readable mode authority and refuses parse, size and read failures before mutation.');
