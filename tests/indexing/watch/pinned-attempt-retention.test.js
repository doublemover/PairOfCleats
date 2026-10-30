import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createWatchAttemptManager } from '../../../src/index/build/watch/attempts.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createSettledWatchAttempt } from '../../helpers/watch-attempts.js';

const { dir: root } = await prepareIsolatedTestCacheDir('watch-pinned-attempt-retention');
applyTestEnv({ cacheRoot: root, extraEnv: { PAIROFCLEATS_HOME: path.join(root, 'home') } });
const repoRoot = path.join(root, 'repo');
await fs.mkdir(repoRoot);
try {
  const manager = createWatchAttemptManager({ repoRoot, userConfig: {}, log() {} });
  const create = async () => {
    const attempt = await createSettledWatchAttempt(manager, repoRoot);
    await fs.writeFile(path.join(attempt.buildRoot, 'sentinel'), attempt.attemptId);
    return attempt;
  };
  const code = await create(), prose = await create(), legacy = await create(), stage = await create(), discarded = await create();
  const stageRoot = path.join(stage.buildRoot, 'stage4'); await fs.mkdir(stageRoot);
  const cache = resolveRepoCacheRootPath(repoRoot, {}), pointer = path.join(cache, 'builds', 'current.json');
  await fs.writeFile(pointer, JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId: code.buildId, buildRoot: path.relative(cache, code.buildRoot), promotedAt: new Date().toISOString(),
    buildRoots: { records: path.relative(cache, legacy.buildRoot) },
    buildRootsByStage: { stage4: path.relative(cache, stageRoot) },
    buildRootsByMode: { code: path.relative(cache, code.buildRoot), prose: path.relative(cache, prose.buildRoot) } }));
  const record = attempt => manager.recordOutcome(attempt, false, { writersSettled: true });
  for (const attempt of [code, prose, legacy, stage, discarded]) await record(attempt);
  const next = await create();
  await record(next);
  for (const attempt of [code, prose, legacy, stage]) assert.equal(await fs.readFile(path.join(attempt.buildRoot, 'sentinel'), 'utf8'), attempt.attemptId);
  await assert.rejects(fs.stat(discarded.buildRoot), { code: 'ENOENT' });
  await fs.writeFile(pointer, '{invalid authority');
  const unknown = await create();
  await assert.rejects(record(unknown), /Cannot establish published roots/);
  for (const attempt of [code, prose, legacy, stage, next, unknown]) await fs.stat(attempt.buildRoot);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Watch retention protects every pinned mode and refuses pruning when pointer authority is unreadable.');
