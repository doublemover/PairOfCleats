import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { writeFederationRepoFixture } from './repo-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-fed-result-admission-'));
const cacheRoot = path.join(root, 'cache');
applyTestEnv({ cacheRoot });
try {
  for (const name of ['a', 'b']) await writeFederationRepoFixture({ repoRoot: path.join(root, name), cacheRoot });
  const workspacePath = path.join(root, 'workspace.json');
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: './a' }, { root: './b' }] }));
  const malformed = [null, [], {}, { ok: false, code: 'ERR_RESULT', message: 'failed envelope' },
    { ok: false, code: ERROR_CODES.INVALID_REQUEST, message: 'canonical failed envelope' },
    { code: {} }, { code: [undefined] }, { code: [null] }, { code: [[]] }];
  for (const [index, result] of malformed.entries()) {
    const request = { workspacePath, query: `admit-${index}`, search: { mode: 'code' }, strict: true };
    await assert.rejects(runFederatedSearch(request, { searchPolicyId: 'fixture-query-policy@1', searchFn: async () => result }),
      { code: result?.code === ERROR_CODES.INVALID_REQUEST ? ERROR_CODES.INVALID_REQUEST : ERROR_CODES.INTERNAL });
    let calls = 0;
    const healthy = await runFederatedSearch(request, { searchPolicyId: 'fixture-query-policy@1', searchFn: async () => { calls++; return { code: [] }; } });
    assert.equal(calls, 2, 'a rejected mode payload must not become a cached empty success');
    assert.equal(healthy.status, 'empty');
    assert.equal(healthy.partialSuccess, false);
  }
  let calls = 0;
  const request = { workspacePath, query: 'non-strict-malformed', search: { mode: 'code' } };
  const context = { searchPolicyId: 'fixture-query-policy@1', searchFn: async repo => {
    calls++;
    return path.basename(repo) === 'a' ? { ok: false, code: 'ERR_REPO', message: 'failed' } : { code: [] };
  } };
  for (let attempt = 0; attempt < 2; attempt++) {
    const partial = await runFederatedSearch(request, context);
    assert.equal(partial.status, 'partial');
    assert.equal(partial.repos.filter(repo => repo.completeness === 'partial').length, 1);
  }
  assert.equal(calls, 4, 'non-strict failed responses are reattempted instead of cached as healthy emptiness');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Ranked federation requires fulfilled mode arrays and retains failed-envelope authority in strict and partial results.');
