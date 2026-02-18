#!/usr/bin/env node
import { applyTestEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getRepoCacheRoot } from '../../src/shared/dict-utils.js';
import {
  createPointerSnapshot,
  listSnapshots,
  pruneSnapshots,
  removeSnapshot,
  showSnapshot
} from '../../src/index/snapshots/create.js';
import { loadSnapshot, loadSnapshotsManifest } from '../../src/index/snapshots/registry.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'snapshot-create-service');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const userConfig = { cache: { root: cacheRoot } };

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const writeBuildState = async ({
  repoCacheRoot,
  buildId,
  validationOk = true,
  includeValidation = true
}) => {
  const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
  const payload = {
    schemaVersion: 1,
    buildId,
    configHash: `cfg-${buildId}`,
    tool: { version: '1.0.0' },
    repo: { provider: 'git', branch: 'main', commit: 'abc123', dirty: false }
  };
  if (includeValidation) {
    payload.validation = { ok: validationOk, issueCount: 0, warningCount: 0, issues: [] };
  }
  await writeJson(path.join(buildRoot, 'build_state.json'), payload);
  return buildRoot;
};

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const buildsRoot = path.join(repoCacheRoot, 'builds');
await fs.mkdir(buildsRoot, { recursive: true });

const buildCodeRoot = await writeBuildState({
  repoCacheRoot,
  buildId: 'build-code',
  validationOk: true
});
const buildProseRoot = await writeBuildState({
  repoCacheRoot,
  buildId: 'build-prose',
  validationOk: true
});
await writeJson(path.join(buildsRoot, 'current.json'), {
  buildId: 'build-code',
  buildRoot: 'builds/build-code',
  buildRoots: {
    code: 'builds/build-code',
    prose: 'builds/build-prose'
  }
});

const firstSnapshot = await createPointerSnapshot({
  repoRoot,
  userConfig,
  modes: ['code'],
  tags: ['release'],
  snapshotId: 'snap-20260212000000-aa0001'
});
assert.equal(firstSnapshot.snapshotId, 'snap-20260212000000-aa0001');
assert.deepEqual(firstSnapshot.modes, ['code']);

const manifestAfterFirst = loadSnapshotsManifest(repoCacheRoot);
assert.ok(manifestAfterFirst.snapshots[firstSnapshot.snapshotId], 'snapshot entry should be in manifest');
const firstSnapshotJson = loadSnapshot(repoCacheRoot, firstSnapshot.snapshotId);
assert.deepEqual(Object.keys(firstSnapshotJson.pointer.buildRootsByMode), ['code']);
assert.equal(firstSnapshotJson.pointer.buildRootsByMode.code, 'builds/build-code');

const badBuildRoot = await writeBuildState({
  repoCacheRoot,
  buildId: 'build-invalid',
  validationOk: false
});
await writeJson(path.join(buildsRoot, 'current.json'), {
  buildId: 'build-invalid',
  buildRoot: 'builds/build-invalid',
  buildRoots: { code: 'builds/build-invalid' }
});
assert.ok(badBuildRoot);
await assert.rejects(
  () => createPointerSnapshot({
    repoRoot,
    userConfig,
    modes: ['code'],
    snapshotId: 'snap-20260212000000-aa0002'
  }),
  /validation\.ok === true/,
  'snapshot create should fail when validation.ok is false'
);

const missingValidationRoot = await writeBuildState({
  repoCacheRoot,
  buildId: 'build-missing-validation',
  includeValidation: false
});
await writeJson(path.join(buildsRoot, 'current.json'), {
  buildId: 'build-missing-validation',
  buildRoot: 'builds/build-missing-validation',
  buildRoots: { code: 'builds/build-missing-validation' }
});
assert.ok(missingValidationRoot);
await assert.rejects(
  () => createPointerSnapshot({
    repoRoot,
    userConfig,
    modes: ['code'],
    snapshotId: 'snap-20260212000000-aa0003'
  }),
  /validation\.ok === true/,
  'snapshot create should fail when validation block is missing'
);

await writeJson(path.join(buildsRoot, 'current.json'), {
  buildId: 'build-code',
  buildRoot: 'builds/build-code',
  buildRoots: { code: 'builds/build-code' }
});
const retentionIds = [
  'snap-20260212000000-aa0004',
  'snap-20260212000000-aa0005',
  'snap-20260212000000-aa0006'
];
for (const snapshotId of retentionIds) {
  await createPointerSnapshot({
    repoRoot,
    userConfig,
    modes: ['code'],
    snapshotId,
    maxPointerSnapshots: 2
  });
}

const manifestAfterRetention = loadSnapshotsManifest(repoCacheRoot);
const allEntries = Object.values(manifestAfterRetention.snapshots || {});
const untaggedPointers = allEntries.filter((entry) => (
  entry.kind === 'pointer' && (!Array.isArray(entry.tags) || entry.tags.length === 0)
));
assert.equal(untaggedPointers.length, 2, 'retention should keep only two untagged pointer snapshots');
assert.ok(
  manifestAfterRetention.snapshots['snap-20260212000000-aa0001'],
  'retention should keep tagged snapshots'
);
assert.ok(
  !manifestAfterRetention.snapshots['snap-20260212000000-aa0004'],
  'retention should prune oldest untagged snapshot'
);
await assert.rejects(
  () => fs.stat(path.join(repoCacheRoot, 'snapshots', 'snap-20260212000000-aa0004')),
  'pruned snapshot directory should be deleted'
);
const listedSnapshots = listSnapshots({ repoRoot, userConfig });
assert.ok(listedSnapshots.length >= 3, 'list should include retained snapshots');
const shownSnapshot = showSnapshot({
  repoRoot,
  userConfig,
  snapshotId: 'snap-20260212000000-aa0001'
});
assert.ok(shownSnapshot?.entry, 'show should return manifest entry');

const dryRunPrune = await pruneSnapshots({
  repoRoot,
  userConfig,
  maxPointerSnapshots: 1,
  dryRun: true
});
assert.ok(Array.isArray(dryRunPrune.removed), 'prune should return removed ids');

const removableId = untaggedPointers.find((entry) => entry.snapshotId)?.snapshotId;
assert.ok(removableId, 'expected at least one removable untagged snapshot');
await removeSnapshot({
  repoRoot,
  userConfig,
  snapshotId: removableId,
  force: true
});
const afterRemoveManifest = loadSnapshotsManifest(repoCacheRoot);
assert.ok(!afterRemoveManifest.snapshots[removableId], 'rm should remove snapshot from manifest');

assert.ok(buildCodeRoot);
assert.ok(buildProseRoot);

console.log('snapshot create service test passed');
