import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { writeFederationRepoFixture } from './repo-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-fed-coordinator-heads-'));
const cacheRoot = path.join(root, 'cache');
applyTestEnv({ cacheRoot });
try {
  const modes = ['code', 'prose', 'extracted-prose', 'records'];
  const keys = ['code', 'prose', 'extractedProse', 'records'];
  for (const name of ['r0', 'r1', 'r2', 'r3']) {
    await writeFederationRepoFixture({ repoRoot: path.join(root, name), cacheRoot, modes });
  }
  const workspacePath = path.join(root, 'workspace.json');
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache',
    repos: [0, 1, 2, 3].map(index => ({ root: `./r${index}`, alias: `r${index}`, priority: index })) }));
  let calls = 0;
  let payloadReads = 0;
  let identityReads = 0;
  let abortOnPayload = null;
  const sourceHits = [];
  const searchFn = async repo => {
    calls++;
    const name = path.basename(repo);
    return Object.fromEntries(keys.map(mode => [mode, Array.from({ length: 20 }, (_, rank) => {
      const hit = Object.freeze({
        get id() { identityReads++; return String(20 - rank).padStart(3, '0'); },
        chunkUid: `${name}:${mode}:${rank}`, file: 'duplicate.js', start: rank, score: rank,
        scoreType: 'source',
        get payload() { payloadReads++; abortOnPayload?.abort(); return { name, mode, rank }; }
      });
      sourceHits.push(hit);
      return hit;
    })]));
  };
  const request = { workspacePath, query: 'coordinator-heads', strict: true,
    search: { mode: 'all', top: 3 }, limits: { perRepoTop: 20, concurrency: 2 } };
  const cold = await runFederatedSearch(request, { searchFn });
  assert.equal(calls, 4);
  assert.equal(payloadReads, 12, 'the actual coordinator materializes three retained rows once per admitted mode');
  assert.ok(identityReads < 320, 'strict-RRF preflight must not read every source hit identity');
  for (const key of keys) {
    assert.deepEqual(cold[key].map(hit => hit.payload.name), ['r3', 'r2', 'r1']);
    assert.ok(cold[key].every(hit => hit.payload.rank === 0));
    assert.ok(cold[key].every(hit => hit.sourceScore === 0 && hit.sourceScoreType === 'source'));
    assert.ok(cold[key].every(hit => hit.score === Number((1 / 61).toFixed(12))));
  }
  assert.deepEqual(await runFederatedSearch(request, { searchFn }), cold);
  assert.equal(calls, 4, 'the warm coordinator response reuses its qualified outer cache entry');
  assert.equal(payloadReads, 12);
  assert.ok(sourceHits.every(Object.isFrozen), 'merge does not mutate the original shared payload rows');

  payloadReads = 0;
  identityReads = 0;
  const zero = await runFederatedSearch({ ...request, query: 'zero-heads', search: { mode: 'all', top: 0 } }, { searchFn });
  assert.ok(keys.every(key => zero[key].length === 0));
  assert.equal(payloadReads, 0);
  assert.equal(identityReads, 0);

  payloadReads = 0;
  const limited = await runFederatedSearch({ ...request, query: 'per-repository-admission-cap',
    limits: { ...request.limits, perRepoTop: 1 } }, { searchFn });
  assert.equal(payloadReads, 12);
  assert.ok(limited.repos.every(repo => Object.values(repo.modes.hitCounts).every(count => count === 1)),
    'coordinator result pools and diagnostics retain only each mode\'s admitted per-repository rows');
  const noCandidates = await runFederatedSearch({ ...request, query: 'zero-per-repository-cap',
    limits: { ...request.limits, perRepoTop: 0 } }, { searchFn });
  assert.ok(keys.every(key => noCandidates[key].length === 0));
  assert.ok(noCandidates.repos.every(repo => Object.values(repo.modes.hitCounts).every(count => count === 0)));
  assert.equal(payloadReads, 12, 'zero per-repository admission does not materialize any source payload');

  payloadReads = 0;
  const tied = await runFederatedSearch({ ...request, query: 'rounded-heads', search: { mode: 'all', top: 2 },
    merge: { rrfK: Number.MAX_VALUE } }, { searchFn });
  assert.equal(payloadReads, 8, 'the bounded fallback materializes only retained rows across all four actual mode calls');
  for (const key of keys) {
    assert.deepEqual(tied[key].map(hit => hit.payload.name), ['r3', 'r3']);
    assert.deepEqual(tied[key].map(hit => hit.id), ['001', '002']);
    assert.deepEqual(tied[key].map(hit => hit.sourceScore), [19, 18]);
  }

  payloadReads = 0;
  const controller = new AbortController();
  abortOnPayload = controller;
  const cancelled = { ...request, query: 'cancelled-materialization' };
  await assert.rejects(runFederatedSearch(cancelled, { searchFn, signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(payloadReads, 1, 'merge stops materialization when its admitted request is cancelled');
  abortOnPayload = null;
  const beforeRetry = calls;
  const recovered = await runFederatedSearch(cancelled, { searchFn });
  assert.equal(calls - beforeRetry, 4, 'cancelled materialization cannot publish a warm partial cache entry');
  assert.equal(recovered.code.length, 3);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Actual ranked federation merges each admitted mode once, bounds payload materialization, preserves ties, and fences cancellation/cache publication.');
