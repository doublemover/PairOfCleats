import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { listBuildRecoveryCandidates } from '../../../src/integrations/core/build-index/recovery-candidates.js';
import { getBuildsRoot, getRepoCacheRoot } from '../../../src/shared/dict-utils.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

applyTestEnv();
const root = await makeTempDir('poc-recovery-candidate-admission-');
try {
  const repo = path.join(root, 'repo'), userConfig = { cache: { root: path.join(root, 'cache') } };
  await fs.mkdir(repo); const repoCacheRoot = getRepoCacheRoot(repo, userConfig);
  await fs.mkdir(repoCacheRoot, { recursive: true });
  const input = { root: repo, userConfig, modes: ['code'] };
  const leases = async () => {
    const directory = repoAccessPaths(repoCacheRoot).leases;
    const entries = await Promise.all((await fs.readdir(directory)).map(async name =>
      JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'))));
    return entries.filter(entry => entry.resourceSettlementVersion === 1);
  };
  const fresh = await listBuildRecoveryCandidates(input);
  assert.deepEqual(fresh.candidates, []); assert.equal(fresh.reason, 'owned-build-directory-absent');
  assert.deepEqual(await leases(), [], 'absent inventory releases its uniquely identified reader');
  const builds = getBuildsRoot(repo, userConfig), old = path.join(builds, 'failed-fixture');
  await fs.mkdir(old, { recursive: true });
  await fs.writeFile(path.join(old, 'build_state.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId: 'failed-fixture', modes: ['code'], runtime: { latestAttemptId: 'attempt', attempts: [{ attemptId: 'attempt', lifecycle: 'failed' }] } }));
  const stale = await listBuildRecoveryCandidates(input);
  assert.deepEqual(stale.candidates, []); assert.equal(stale.examined, 1, 'unsealed old metadata cannot supply candidate authority');
  assert.deepEqual(await leases(), []);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(listBuildRecoveryCandidates({ ...input, signal: controller.signal }), { code: 'ABORT_ERR' });
  assert.deepEqual(await leases(), [], 'cancellation drains the original inventory before reader release');
  await assert.rejects(listBuildRecoveryCandidates({ ...input, modes: ['foreign'] }), { code: 'ERR_RECOVERY_MODES' });
  assert.deepEqual(await leases(), []);
} finally { await rmDirRecursive(root); }
console.log('fresh/stale recovery inventory and cancellation retain strict unique reader admission and exact lease cleanup');
