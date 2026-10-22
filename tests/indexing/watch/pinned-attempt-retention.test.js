import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createWatchAttemptManager } from '../../../src/index/build/watch/attempts.js';
import { getRepoCacheRoot, getBuildsRoot } from '../../../src/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir: root } = await prepareIsolatedTestCacheDir('watch-pinned-attempt-retention');
applyTestEnv({ cacheRoot: root });
const repoRoot = path.join(root, 'repo');
await fs.mkdir(repoRoot);
try {
  const manager = createWatchAttemptManager({ repoRoot, userConfig: {}, log() {} });
  const create = async () => {
    const attempt = await manager.createAttempt();
    await fs.mkdir(attempt.buildRoot);
    await fs.writeFile(path.join(attempt.buildRoot, 'sentinel'), attempt.attemptId);
    return attempt;
  };
  const code = await create(), prose = await create(), discarded = await create();
  const cache = getRepoCacheRoot(repoRoot, {}), pointer = path.join(getBuildsRoot(repoRoot, {}), 'current.json');
  await fs.writeFile(pointer, JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId: code.buildId, buildRoot: path.relative(cache, code.buildRoot),
    buildRootsByMode: { code: path.relative(cache, code.buildRoot), prose: path.relative(cache, prose.buildRoot) } }));
  for (const attempt of [code, prose, discarded]) await manager.recordOutcome(attempt, false);
  const next = await create();
  await manager.recordOutcome(next, false);
  for (const attempt of [code, prose]) assert.equal(await fs.readFile(path.join(attempt.buildRoot, 'sentinel'), 'utf8'), attempt.attemptId);
  await assert.rejects(fs.stat(discarded.buildRoot), { code: 'ENOENT' });
  await fs.writeFile(pointer, '{invalid authority');
  const unknown = await create();
  await assert.rejects(manager.recordOutcome(unknown, false), /Cannot establish published roots/);
  for (const attempt of [code, prose, next, unknown]) await fs.stat(attempt.buildRoot);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Watch retention protects every pinned mode and refuses pruning when pointer authority is unreadable.');
