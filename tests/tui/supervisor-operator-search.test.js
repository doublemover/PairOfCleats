import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { createCompatibilityIndex } from '../helpers/index-compatibility-fixture.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tui/supervisor-operator-search/')[1];
assert.ok(['query-source', 'pagination', 'source-authority', 'launch-authority', 'navigation', 'navigation-untrusted', 'navigation-cancel'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`operator-search-${selected}`);
const repo = path.join(dir, 'selected repository');
await fs.mkdir(path.join(repo, 'src'), { recursive: true });
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', syncProcess: true,
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null,
    PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify(selected === 'navigation-untrusted' ? [] : [repo]) } });
const index = await createCompatibilityIndex(repo, { compatibilityKey: 'native-operator-search', profileId: 'default', published: true });
const body = 'export function alpha() { return 42; }\n';
const rows = Array.from({ length: 3 }, (_, id) => ({ id, file: `src/item${id}.js`,
  kind: 'FunctionDeclaration', name: `alpha${id}`, tokens: ['alpha'],
  start: 0, end: Buffer.byteLength(body), startLine: 1, endLine: 1, chunkUid: `uid:alpha:${id}`,
  sourceHash: createHash('sha1').update(body).digest('hex') }));
if (selected.startsWith('navigation')) rows[0].file = 'src/source & %PAIROFCLEATS_TEST_ID% (quoted).js';
for (const row of rows) await fs.writeFile(path.join(repo, row.file), body);
if (selected === 'source-authority') {
  rows[0].end = 70 * 1024;
  rows[2].file = '../outside-private.js';
  await fs.writeFile(path.join(dir, 'outside-private.js'), 'private-outside-source');
}
await fs.writeFile(path.join(index, 'chunk_meta.json'), JSON.stringify(rows));
const editorMarker = path.join(dir, 'editor-invoked.json');
if (selected.startsWith('navigation')) {
  const bin = path.join(repo, 'explicit-editor'); await fs.mkdir(bin);
  const fixture = path.join(bin, 'record-editor.mjs');
  await fs.writeFile(fixture, `import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(editorMarker)}, JSON.stringify({args:process.argv.slice(2),pid:process.pid}));
${selected === 'navigation-cancel' ? 'setInterval(()=>{},1000);' : ''}\n`);
  const quote = value => `"${value.replace(/%/g, '%%')}"`;
  if (process.platform === 'win32') await fs.writeFile(path.join(bin, 'code.cmd'),
    `@echo off\r\nsetlocal DisableDelayedExpansion\r\n${quote(process.execPath)} ${quote(fixture)} %*\r\n`);
  else {
    const shellQuote = value => `'${value.replace(/'/g, `'\\''`)}'`;
    await fs.writeFile(path.join(bin, 'code'), `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fixture)} "$@"\n`, { mode: 0o755 });
  }
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH || ''}`;
}
if (selected === 'launch-authority') process.env.PAIROFCLEATS_TRUSTED_CONFIG = path.join(dir, 'missing-trusted.json');
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
    assert.equal(page.searchDiagnostics.backend.selected, 'memory');
    assert.equal(page.searchDiagnostics.state, 'recorded');
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
    assert.ok(empty.searchDiagnostics.reasons.some(reason => reason.code === 'query-with-filters'));
    assert.ok(empty.searchDiagnostics.reasons.some(reason => reason.code === 'coverage-check'));
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
  } else if (selected.startsWith('navigation')) {
    const page = await success('query', { repoPath: repo, search });
    const hit = page.hits.find(hit => hit.file === rows[0].file);
    const source = await success('source', { resultId: page.resultId, hitId: hit.hitId });
    const params = { resultId: page.resultId, hitId: hit.hitId, editor: 'code', confirmed: true,
      sourceHash: source.sourceIdentity.currentHash };
    if (selected === 'navigation-untrusted') {
      const end = await request('open', params);
      assert.equal(end.status, 'failed'); assert.equal(end.error.code, 'ERR_TUI_EDITOR_UNTRUSTED');
      await assert.rejects(fs.access(editorMarker), { code: 'ENOENT' });
    } else if (selected === 'navigation-cancel') {
      const launching = request('open', params), jobId = `search-${sequence}`;
      const deadline = Date.now() + 3000;
      while (!await fs.access(editorMarker).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) {
        assert.ok(Date.now() < deadline, 'explicit editor fixture did not start within 3s');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      const editor = JSON.parse(await fs.readFile(editorMarker, 'utf8'));
      assert.equal(isProcessAlive(editor.pid), true);
      session.send({ op: 'job:cancel', jobId });
      const end = await launching;
      assert.equal(end.status, 'cancelled'); assert.equal(isProcessAlive(editor.pid), false);
    } else {
      const noConfirmation = await request('open', { ...params, confirmed: false });
      assert.equal(noConfirmation.status, 'failed'); assert.equal(noConfirmation.error.code, 'ERR_TUI_SEARCH_REQUEST');
      await assert.rejects(fs.access(editorMarker), { code: 'ENOENT' });
      await fs.writeFile(path.join(repo, rows[0].file), 'changed after preview');
      const stale = await request('open', params);
      assert.equal(stale.status, 'failed'); assert.equal(stale.error.code, 'ERR_FILE_INTEGRITY');
      await assert.rejects(fs.access(editorMarker), { code: 'ENOENT' });
      await fs.writeFile(path.join(repo, rows[0].file), body);
      const opened = await success('open', params); assert.equal(opened.opened, true);
      const editor = JSON.parse(await fs.readFile(editorMarker, 'utf8'));
      assert.deepEqual(editor.args, ['--reuse-window', '--goto', `${path.join(repo, rows[0].file)}:1:1`]);
      assert.equal(isProcessAlive(editor.pid), false);
    }
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
