import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runFederatedSearch, resolveFederatedUnavailableModes } from '../../../src/retrieval/federation/coordinator.js';
import { writeFederationRepoFixture } from './repo-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
const { dir } = await prepareIsolatedTestCacheDir('strict-missing-requested-mode');
const cacheRoot = path.join(dir, 'cache'); applyTestEnv({ cacheRoot });
await writeFederationRepoFixture({ repoRoot: path.join(dir, 'healthy'), cacheRoot, modes: ['code'] });
await writeFederationRepoFixture({ repoRoot: path.join(dir, 'unavailable'), cacheRoot, modes: ['prose'] });
const workspacePath = path.join(dir, 'workspace.jsonc');
await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [
  { root: './healthy', alias: 'healthy' }, { root: './unavailable', alias: 'unavailable' } ] }));
let searched = 0;
const context = { searchFn: async () => { searched++; return { backend: 'memory', code: [], prose: [], extractedProse: [], records: [] }; } };
const request = { workspacePath, query: 'strict requested scope', search: { mode: 'code', top: 2 } };
const degraded = await runFederatedSearch(request, context);
assert.equal(degraded.ok, true); assert.equal(degraded.partialSuccess, true);
assert.equal(searched, 1);
for (let attempt = 0; attempt < 2; attempt++) {
  searched = 0;
  await assert.rejects(runFederatedSearch({ ...request, strict: true }, context), { code: 'NO_INDEX' });
  assert.equal(searched, 0, 'strict admission rejects before fanout or warm-cache success');
}
await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: './unavailable' }] }));
await assert.rejects(runFederatedSearch({ ...request, strict: true }, context), { code: 'NO_INDEX' });
assert.deepEqual(resolveFederatedUnavailableModes({ repos: [{ repoId: 'healthy' }, { repoId: 'excluded' }, { repoId: 'disabled', enabled: false }],
  requestedModes: ['code'], eligibleModesByRepo: new Map([['healthy', new Set(['code'])]]),
  cohortExcluded: { code: [{ repoId: 'excluded', reason: 'cohort-excluded' }] } }), []);
await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: './healthy' }] }));
const empty = await runFederatedSearch({ ...request, strict: true }, context);
assert.equal(empty.ok, true); assert.equal(empty.partialSuccess, false, 'healthy zero hits are complete success');
console.log('strict federation rejects missing requested modes before cache and fanout');
