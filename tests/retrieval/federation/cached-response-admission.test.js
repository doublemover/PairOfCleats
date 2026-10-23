import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { loadWorkspaceConfig } from '../../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../../src/workspace/manifest.js';
import { writeFederationRepoFixture } from './repo-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-fed-cached-response-admission-'));
const cacheRoot = path.join(root, 'cache');
applyTestEnv({ cacheRoot });
try {
  const repoRoot = path.join(root, 'repo');
  await writeFederationRepoFixture({ repoRoot, cacheRoot });
  const workspacePath = path.join(root, 'workspace.json');
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: './repo' }] }));
  const request = { workspacePath, query: 'cached-envelope', strict: true, search: { mode: 'code', top: 1 } };
  const marker = 'federation-warm-owned-payload-'.repeat(4096);
  let calls = 0;
  const context = { searchFn: async () => {
    calls++;
    return { backend: 'memory', code: [{ id: 'original', file: 'source.js', score: 1,
      payload: { marker, rendering: { note: 'original' } } }], prose: [], extractedProse: [], records: [] };
  } };
  const cold = await runFederatedSearch(request, context);
  assert.equal(cold.code.length, 1);
  const originalStringify = JSON.stringify;
  let payloadSerializations = 0;
  let warm;
  try {
    JSON.stringify = function (...args) {
      const result = originalStringify.apply(this, args);
      if (result?.includes(marker)) payloadSerializations++;
      return result;
    };
    warm = await runFederatedSearch(request, context);
    assert.deepEqual(warm, cold);
    assert.equal(payloadSerializations, 0, 'warm response ownership and recency publication require no payload JSON encoding');
  } finally { JSON.stringify = originalStringify; }
  warm.code[0].payload.rendering.note = 'caller-owned-change';
  assert.deepEqual(await runFederatedSearch(request, context), cold, 'response mutation cannot change a later qualified cache hit');
  assert.equal(calls, 1, 'the valid warm envelope exercises actual coordinator cache reuse');
  const config = loadWorkspaceConfig(workspacePath);
  const { manifest } = await generateWorkspaceManifest(config, { write: false });
  const cachePath = path.join(manifest.federationCacheRoot, 'federation', config.repoSetId, 'queryCache.json');
  const canonical = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  const key = Object.keys(canonical.entries)[0];
  const corruptions = [
    entry => { entry.result = 'not-a-response'; },
    entry => { entry.result.ok = false; },
    entry => { entry.result.code = null; },
    entry => { entry.result.code = [null]; },
    entry => { entry.result.meta.manifestHash = 'other-generation'; },
    entry => { entry.result.meta.selection.selectedRepoIds = []; },
    entry => { entry.result.repos = []; },
    entry => { entry.result.code[0].repoId = 'outside-request'; },
    entry => { entry.result.prose = [{ ...entry.result.code[0] }]; },
    entry => { entry.result.code.push({ ...entry.result.code[0], id: 'exceeds-top' }); },
    entry => { entry.result.status = 'degraded'; entry.result.partialSuccess = true; }
  ];
  for (let index = 0; index < corruptions.length; index++) {
    const invalid = structuredClone(canonical);
    corruptions[index](invalid.entries[key]);
    await fs.writeFile(cachePath, JSON.stringify(invalid));
    const changed = new Date(Date.now() + (index + 1) * 1000);
    await fs.utimes(cachePath, changed, changed);
    const previousCalls = calls;
    const repaired = await runFederatedSearch(request, context);
    assert.equal(calls, previousCalls + 1, 'malformed persisted data must miss before it is touched or returned');
    assert.equal(repaired.status, 'complete');
    assert.equal(repaired.code[0].id, 'original');
    assert.deepEqual(await runFederatedSearch(request, context), repaired);
    assert.equal(calls, previousCalls + 1, 'the repaired canonical response remains reusable');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Actual federation cache reuse admits only bounded successful envelopes with matching generation, selection, policy, and hit provenance.');
