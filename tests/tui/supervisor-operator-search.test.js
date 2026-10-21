import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { createCompatibilityIndex } from '../helpers/index-compatibility-fixture.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tui/supervisor-operator-search/')[1];
assert.ok(['query-source', 'pagination', 'source-authority', 'launch-authority'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`operator-search-${selected}`);
const repo = path.join(dir, 'selected repository');
await fs.mkdir(path.join(repo, 'src'), { recursive: true });
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', syncProcess: true,
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: selected === 'launch-authority' ? path.join(dir, 'missing-trusted.json') : null } });
const index = await createCompatibilityIndex(repo, { compatibilityKey: 'native-operator-search', profileId: 'default' });
const body = 'export function alpha() { return 42; }\n';
const rows = Array.from({ length: 3 }, (_, id) => ({ id, file: `src/item${id}.js`,
  kind: 'FunctionDeclaration', name: `alpha${id}`, tokens: ['alpha'],
  start: 0, end: Buffer.byteLength(body), startLine: 1, endLine: 1, chunkUid: `uid:alpha:${id}`,
  sourceHash: createHash('sha1').update(body).digest('hex') }));
for (const row of rows) await fs.writeFile(path.join(repo, row.file), body);
if (selected === 'source-authority') {
  rows[0].end = 70 * 1024;
  rows[2].file = '../outside-private.js';
  await fs.writeFile(path.join(dir, 'outside-private.js'), 'private-outside-source');
}
await fs.writeFile(path.join(index, 'chunk_meta.json'), JSON.stringify(rows));
const session = createSupervisorSession({ timeoutMs: 10000, reassembleEvents: true });
let sequence = 0;
const request = async (method, params) => {
  const jobId = `search-${++sequence}`;
  session.send({ op: 'search:run', jobId, method, params });
  return session.waitForEvent(event => event.event === 'job:end' && event.jobId === jobId, 10000);
};
const success = async (...args) => {
  const end = await request(...args);
  assert.equal(end.status, 'done', JSON.stringify(end));
  assert.equal(end.resultState, 'complete');
  return end.result.data;
};
const search = { backend: 'memory', mode: 'code', top: 5, type: 'FunctionDeclaration' };
try {
  const hello = await session.waitForEvent(event => event.event === 'hello');
  assert.equal(hello.capabilities.supportsSearch, true);
  if (selected === 'launch-authority') {
    const rejected = await request('query', { repoPath: repo, search });
    assert.equal(rejected.status, 'failed', 'an invalid explicit launch pin must retain its rejection');
    assert.equal(rejected.error.code, 'SUBPROCESS_FAILED');
    assert.equal(rejected.result, null);
  } else if (selected === 'query-source') {
    const page = await success('query', { repoPath: repo, search: { ...search, query: 'alpha' } });
    assert.equal(page.repoPath, await fs.realpath(repo));
    assert.equal(typeof page.scopeId, 'string');
    assert.equal(page.queryGeneration, 1);
    assert.ok(session.events.some(event => event.event === 'job:spawn'
      && event.jobId === 'search-1' && event.internal === true && Number.isSafeInteger(event.pid)));
    assert.ok(page.hits.some(hit => hit.file === 'src/item0.js'), JSON.stringify(page));
    assert.equal(page.hits[0].rank, 1);
    assert.equal(typeof page.hits[0].score, 'number');
    const source = await success('source', { resultId: page.resultId, hitId: page.hits[0].hitId });
    assert.equal(source.available, true);
    assert.match(source.excerpt, /return 42/);
    assert.equal(source.sourceIdentity.drift, 'unchanged');
    assert.match(source.fileUri, /^file:\/\//);
    const empty = await success('query', { repoPath: repo, search: { ...search, query: 'unfindable' } });
    assert.equal(empty.queryGeneration, 2);
    assert.notEqual(empty.scopeId, page.scopeId);
    assert.equal(empty.hits.length, 0);
    const old = await request('source', { resultId: page.resultId, hitId: page.hits[0].hitId });
    assert.equal(old.status, 'failed'); assert.equal(old.error.code, 'ERR_TUI_SEARCH_STALE');
    const invalid = await request('query', { repoPath: repo, search: { ...search, asOf: 'commit:a', snapshot: 'b' } });
    assert.equal(invalid.status, 'failed'); assert.equal(invalid.error.code, 'ERR_TUI_SEARCH_REQUEST');
  } else if (selected === 'pagination') {
    let page = await success('query', { repoPath: repo, search: { ...search, top: 1 } });
    const resultId = page.resultId, hits = [...page.hits];
    while (page.pagination?.nextCursor) {
      assert.ok(hits.length < 3, 'continuation must make progress');
      page = await success('continue', { resultId });
      assert.equal(page.resultId, resultId); hits.push(...page.hits);
    }
    assert.deepEqual(hits.map(hit => hit.rank), [1, 2, 3]);
    assert.deepEqual(hits.map(hit => hit.file), rows.map(row => row.file));
    assert.equal(new Set(hits.map(hit => hit.hitId)).size, 3);
    const end = await request('continue', { resultId });
    assert.equal(end.status, 'failed'); assert.equal(end.error.code, 'ERR_TUI_SEARCH_CURSOR');
  } else {
    const page = await success('query', { repoPath: repo, search });
    const escaped = page.hits.find(hit => hit.file.startsWith('../'));
    const denied = await request('source', { resultId: page.resultId, hitId: escaped.hitId });
    assert.equal(denied.status, 'failed'); assert.equal(denied.error.code, 'ERR_UNSAFE_FILE_PATH');
    assert.equal(JSON.stringify(session.events).includes('private-outside-source'), false);
    const hit = page.hits.find(hit => hit.file === rows[0].file);
    await fs.writeFile(path.join(repo, hit.file), 'changed current source\n' + 'x'.repeat(70 * 1024));
    const drifted = await success('source', { resultId: page.resultId, hitId: hit.hitId });
    assert.equal(drifted.sourceIdentity.drift, 'changed');
    assert.match(drifted.excerpt, /changed current source/);
    assert.equal(drifted.truncated, true);
    assert.ok(Buffer.byteLength(drifted.excerpt) <= 16 * 1024);
    await fs.unlink(path.join(repo, hit.file));
    const missing = await success('source', { resultId: page.resultId, hitId: hit.hitId });
    assert.equal(missing.available, false); assert.equal(missing.reason, 'ENOENT');
    await fs.writeFile(path.join(repo, hit.file), '');
    await fs.truncate(path.join(repo, hit.file), 64 * 1024 * 1024 + 1);
    try {
      const oversized = await success('source', { resultId: page.resultId, hitId: hit.hitId });
      assert.equal(oversized.available, false); assert.equal(oversized.reason, 'ERR_FILE_TOO_LARGE');
    } finally { await fs.unlink(path.join(repo, hit.file)); }
  }
  assert.equal(await session.shutdown(), 0);
} finally {
  if (session.child.exitCode === null) { session.forceKill(); await session.waitForExit(); }
}
console.log(`Canonical native search supervisor control passed: ${selected}`);
