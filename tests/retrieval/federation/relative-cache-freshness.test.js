import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { writeFederationRepoFixture } from './repo-fixture.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { search as coreSearch } from '../../../src/integrations/core/search.js';
import { parseFederatedCliRequest } from '../../../src/retrieval/federation/args.js';
import { findFederatedQueryCacheEntry } from '../../../src/retrieval/federation/query-cache.js';
import { bindRelativeModificationArgs } from '../../../src/retrieval/federation/time-filter.js';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-fed-relative-cache-')));
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
const RealDate = globalThis.Date;
let now = RealDate.parse('2026-10-01T00:00:00Z');
try {
  const repoRoot = path.join(root, 'repo');
  const descriptor = await writeFederationRepoFixture({ repoRoot, cacheRoot: path.join(root, 'cache') });
  const indexDir = await createCompatibilityIndex(descriptor.buildRoot, { compatibilityKey: 'compat-code' });
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([{
    id: 0, file: 'source.js', name: 'alpha', kind: 'FunctionDeclaration', start: 0, end: 1,
    chunkUid: 'alpha:0', tokens: ['alpha'], text: 'alpha', last_modified: '2026-09-30T12:00:00Z'
  }]));
  const workspacePath = path.join(root, 'workspace.json');
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: './repo' }] }));
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  const anchor = now;
  for (const after of ['2026-09-01T00:00:00Z', '2026-10-02T00:00:00Z']) {
    assert.deepEqual(bindRelativeModificationArgs(['--modified-after', after, '--modified-since=1', '--', '--modified-since=99'], anchor),
      ['--modified-after', new Date(Math.max(RealDate.parse(after), anchor - 86400000)).toISOString(), '--', '--modified-since=99'],
      'the stricter cutoff wins, and tokens after -- remain literal query input');
  }
  assert.deepEqual(bindRelativeModificationArgs(['--', '--modified-since=1'], anchor), ['--', '--modified-since=1']);
  for (const value of ['-1', 'NaN', 'Infinity', '1e99']) {
    assert.throws(() => bindRelativeModificationArgs(['--modified-since', value], anchor), { code: 'INVALID_REQUEST' });
  }
  for (const form of ['structured', 'cli']) {
    now = RealDate.parse('2026-10-01T00:00:00Z');
    const request = form === 'structured'
      ? { workspacePath, query: 'alpha', search: { mode: 'code', backend: 'memory', modifiedSince: 1 } }
      : parseFederatedCliRequest(['--workspace', workspacePath, '--mode', 'code', '--backend', 'memory', '--modified-since=1', 'alpha']);
    let calls = 0;
    const context = { searchPolicyId: 'fixture-query-policy@1', searchFn: async (...args) => { calls += 1; return coreSearch(...args); } };
    const cold = await runFederatedSearch(request, context);
    assert.equal(cold.code.length, 1, `${form}: recent indexed source must be retrieved before testing expiration`);
    const warm = await runFederatedSearch(request, context);
    assert.deepEqual(warm, cold);
    assert.equal(calls, 1, `${form}: an identical request time must exercise the outer cache hit`);
    now = RealDate.parse('2026-10-03T00:00:00Z');
    const later = await runFederatedSearch(request, context);
    assert.equal(later.meta.manifestHash, cold.meta.manifestHash, 'time passage must not depend on rebuilding indexes');
    assert.equal(later.code.length, 0, `${form}: the moving cutoff must exclude the stale indexed source`);
    assert.equal(calls, 2, `${form}: a changed effective cutoff must execute search`);
    assert.deepEqual(await runFederatedSearch(request, context), later);
    assert.equal(calls, 2);
  }
  now = RealDate.parse('2026-10-01T00:00:00Z');
  let calls = 0;
  const context = { federatedCachePolicy: { maxAgeDays: 1 },
    searchPolicyId: 'fixture-query-policy@1', searchFn: async (...args) => { calls += 1; return coreSearch(...args); } };
  const staticRequest = { workspacePath, query: 'alpha', search: { mode: 'code', backend: 'memory' } };
  const cold = await runFederatedSearch(staticRequest, context);
  assert.equal(cold.code.length, 1);
  now += 12 * 3600000;
  assert.deepEqual(await runFederatedSearch(staticRequest, context), cold);
  assert.equal(calls, 1, 'fresh static entries remain usable and refresh their idle age');
  now += 2 * 86400000;
  const refreshed = await runFederatedSearch(staticRequest, context);
  const expected = structuredClone(cold);
  // generateWorkspaceManifest owns these invocation timestamps; content and generation stay identical.
  expected.meta.manifestGeneratedAt = new Date(now).toISOString();
  for (const repo of expected.repos) repo.freshness.manifestGeneratedAt = new Date(now).toISOString();
  assert.deepEqual(refreshed, expected);
  assert.equal(calls, 2, 'expired static entries must execute search before a touch can revive them');
  const expired = { entries: { key: { manifestHash: 'manifest', lastUsedAt: '2026-09-01T00:00:00Z', result: cold } } };
  assert.equal(findFederatedQueryCacheEntry(expired, { keyHash: 'key', manifestHash: 'manifest', policy: { maxAgeDays: 1 } }), null);
} finally {
  globalThis.Date = RealDate;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Federated relative filters share a request cutoff, preserve cold/hit parity, and expire idle entries before touching.');
