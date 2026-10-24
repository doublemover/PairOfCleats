import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { publishFederatedShadow, captureFederatedShadow } from '../../../src/retrieval/federation/shadow-routing.js';
import { writeFederationRepoFixture } from './repo-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'federation-shadow-source-'));
const cacheRoot = path.join(root, 'cache'), workspacePath = path.join(root, 'workspace.jsonc');
applyTestEnv({ cacheRoot });
try {
  await writeFederationRepoFixture({ repoRoot: path.join(root, 'a'), cacheRoot });
  await writeFederationRepoFixture({ repoRoot: path.join(root, 'b'), cacheRoot });
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: './a' }, { root: './b' }] }));
  let searches = 0; const reports = [];
  const searchFn = async repo => {
    searches++;
    return { backend: 'memory', code: Array.from({ length: 4 }, (_, id) => ({ chunkUid: `${path.basename(repo)}:${id}`,
      file: `src/${id}.js`, start: 0, end: 1, score: 4 - id, sparseScore: 4 - id, annScore: 0.9 - id / 10 })),
    prose: [], extractedProse: [], records: [] };
  };
  const request = { workspacePath, query: 'why does this function fail', search: { mode: 'code', top: 4 } };
  const observed = await runFederatedSearch(request, { searchFn, shadowRouting: true, onShadowRouting: report => reports.push(report) });
  assert.equal(searches, 2, 'shadow capture reuses actual per-repository heads and issues no extra query');
  assert.equal(reports.length, 1); assert.equal(reports[0].extraRepositoryCalls, 0);
  assert.equal(reports[0].complete, true); assert.equal(reports[0].modes[0].allocation.authoritative, false);
  assert.equal(reports[0].modes[0].allocation.metrics.proposed.gradedGain, null, 'live unknown judgments never become quality zeros');
  assert.equal(Object.isFrozen(reports[0].modes[0].witnesses), true);
  const control = await runFederatedSearch(request, { searchFn });
  assert.equal(searches, 2); assert.equal(JSON.stringify(observed), JSON.stringify(control), 'normal cache reuse is byte-identical with the observational hook');
  const cached = await runFederatedSearch(request, { searchFn, shadowRouting: true, onShadowRouting: report => {
    reports.push(report); throw new Error('observational callback failed');
  } });
  assert.equal(JSON.stringify(cached), JSON.stringify(control)); assert.equal(searches, 2);
  assert.equal(reports[1].reason, 'cache-hit-original-pools-unavailable', 'cache hits never reconstruct or refetch missing original pools');
  const privateText = request.query;
  assert.equal(JSON.stringify(reports).includes(privateText), false);
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal(captureFederatedShadow({ signal: cancelled.signal }).reason, 'cancelled');
  assert.equal(captureFederatedShadow({ perRepoResults: null }).reason, 'cache-hit-original-pools-unavailable');
  const original = { value: [{ preserved: true }] };
  publishFederatedShadow({ shadowRouting: true, onShadowRouting: () => Promise.reject(new Error('late callback failure')) }, original);
  await Promise.resolve(); assert.equal(Object.isFrozen(original.value[0]), true);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Actual federation captures bounded pinned heads without additional searches, cache mutation or callback authority');
