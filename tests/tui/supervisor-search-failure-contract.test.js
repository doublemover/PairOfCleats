import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import { createCompatibilityIndex } from '../helpers/index-compatibility-fixture.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tui/supervisor-search-failure-contract/')[1];
const reasons = { 'invalid-repository': 'invalid-repository', 'invalid-request': 'invalid-request',
  'missing-index': 'missing-index', 'missing-capability': 'missing-capability', 'unsupported-format': 'unsupported-format' };
assert.ok(Object.hasOwn(reasons, selected) || ['empty-success', 'results-success'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`search-failure-contract-${selected}`);
const repo = path.join(dir, 'repository'); await fs.mkdir(repo);
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), syncProcess: true, embeddings: 'off',
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null, GIT_CEILING_DIRECTORIES: dir } });
const index = await createCompatibilityIndex(repo, { compatibilityKey: 'safe-search-failures', profileId: 'default' });
if (selected === 'missing-index') await fs.unlink(path.join(index, 'chunk_meta.json'));
if (selected === 'unsupported-format') {
  const statePath = path.join(index, 'index_state.json');
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  await fs.writeFile(statePath, JSON.stringify({ ...state, artifactSurfaceVersion: 'obsolete-fixture-format' }));
}
const repoPath = selected === 'invalid-repository' ? path.join(index, 'index_state.json') : repo;
const search = { query: selected === 'empty-success' ? 'zzzneverpresentzzz' : 'alpha', mode: 'code', backend: 'memory', ann: false,
  ...(selected === 'invalid-request' ? { backend: 'PRIVATE_SECRET_TOKEN' } : {}),
  ...(selected === 'missing-capability' ? { branch: 'explicitly-unavailable-branch' } : {}) };
const session = createSupervisorSession({ timeoutMs: 10000, reassembleEvents: true });
try {
  await session.waitForEvent(event => event.event === 'hello');
  session.send({ op: 'search:run', jobId: 'failure-contract', method: 'query', params: { repoPath, search } });
  const end = await session.waitForEvent(event => event.event === 'job:end' && event.jobId === 'failure-contract');
  if (Object.hasOwn(reasons, selected)) {
    assert.equal(end.status, 'failed', JSON.stringify(end)); assert.equal(end.result, null);
    assert.equal(end.error.failure.reason, reasons[selected], JSON.stringify(end));
    assert.match(end.error.failure.diagnosticId, /^tui-[0-9a-f-]{36}$/);
    assert.equal(JSON.stringify(end.error).includes(repo), false);
    assert.equal(JSON.stringify(session.events).includes('PRIVATE_SECRET_TOKEN'), false);
    assert.ok(Buffer.byteLength(JSON.stringify(end.error)) < 2048);
  } else {
    assert.equal(end.status, 'done', JSON.stringify(end)); assert.equal(end.resultState, 'complete');
    assert.equal(end.error, undefined);
    if (selected === 'empty-success') assert.deepEqual(end.result.data.hits, []);
    else assert.ok(end.result.data.hits.some(hit => hit.file === 'src/code.js'));
  }
  assert.equal(await session.shutdown(), 0);
} finally {
  if (session.child.exitCode === null) { session.forceKill(); await session.waitForExit(); }
}
console.log(`Actual supervisor and CLI search failure contract: ${selected}`);
