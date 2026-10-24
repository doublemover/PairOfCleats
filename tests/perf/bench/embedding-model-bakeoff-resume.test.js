#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';
import { resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const root = process.cwd();
const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'embedding-bakeoff-resume-'));
const checkpointPath = path.join(tempRoot, 'bakeoff.json');
const cacheRoot = path.join(tempRoot, 'cache');

const runBakeoff = () => runNode(
  [
    path.join(root, 'tools', 'bench', 'embeddings', 'model-bakeoff.js'),
    '--repo',
    root,
    '--models',
    'Xenova/bge-small-en-v1.5',
    '--skip-eval',
    '--skip-compare',
    '--no-build',
    '--cache-root',
    cacheRoot,
    '--checkpoint',
    checkpointPath,
    '--json'
  ],
  'embedding model bakeoff resume',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

const firstRun = runBakeoff();
if (firstRun.status !== 0) {
  console.error(firstRun.stderr || firstRun.stdout || '');
  throw new Error(`first bakeoff run failed (${firstRun.status})`);
}
const firstPayload = JSON.parse(String(firstRun.stdout || '{}'));
assert.equal(firstPayload.progress?.status, 'completed');
assert.equal(firstPayload.progress?.completedModels, 1);
assert.equal(firstPayload.progress?.resumedModels, 0);
assert.ok(fs.existsSync(checkpointPath), 'checkpoint file should exist after first run');

const secondRun = runBakeoff();
if (secondRun.status !== 0) {
  console.error(secondRun.stderr || secondRun.stdout || '');
  throw new Error(`second bakeoff run failed (${secondRun.status})`);
}
const secondPayload = JSON.parse(String(secondRun.stdout || '{}'));
assert.equal(secondPayload.progress?.status, 'completed');
assert.equal(secondPayload.progress?.completedModels, 1);
assert.equal(secondPayload.progress?.resumedModels, 0, 'an absent generation cannot authorize checkpoint reuse');
assert.equal(secondPayload.models[0].resumeIdentity.generation, null);

// Retain the positive resume assertion, now backed by an actual published
// fixture generation instead of a report with no indexed input authority.
const repoCacheRoot = path.join(resolveVersionedCacheRoot(firstPayload.models[0].cacheRoot), 'repos', firstPayload.repo.repoId);
const buildId = 'bakeoff-resume-fixture-generation';
const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
await seedPublishedArtifacts({ buildRoot, buildId });
await fsPromises.writeFile(path.join(buildRoot, 'index-code/index_state.json'), JSON.stringify({
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId, mode: 'code'
}));
await fsPromises.writeFile(path.join(repoCacheRoot, 'builds/current.json'), JSON.stringify({
  buildId, buildRoot: 'builds/' + buildId, buildRootsByMode: { code: 'builds/' + buildId },
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION
}));
const admittedRun = runBakeoff();
assert.equal(admittedRun.status, 0, admittedRun.stderr);
const admitted = JSON.parse(String(admittedRun.stdout));
assert.equal(admitted.progress.resumedModels, 0, 'a prior unknown-generation report cannot borrow new generation authority');
assert.match(admitted.models[0].resumeIdentity.generation, /^[a-f0-9]{64}$/);
const resumedRun = runBakeoff();
assert.equal(resumedRun.status, 0, resumedRun.stderr);
const resumed = JSON.parse(String(resumedRun.stdout));
assert.equal(resumed.progress.status, 'completed');
assert.equal(resumed.progress.completedModels, 1);
assert.equal(resumed.progress.resumedModels, 1);
assert.equal(resumed.models[0].resumeIdentity.generation, admitted.models[0].resumeIdentity.generation);

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('embedding model bakeoff resume test passed');
