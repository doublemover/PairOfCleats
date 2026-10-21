import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { createCompatibilityIndex } from '../helpers/index-compatibility-fixture.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';

// Requires actual file symlinks; the Windows authority owner needs a capable
// launch. An ordinary Windows EPERM cannot be replaced by a junction or a skip.
const { dir } = await prepareIsolatedTestCacheDir('operator-search-file-authority');
const repo = path.join(dir, 'repository'), bin = path.join(dir, 'outside-bin');
await fs.mkdir(repo); await fs.mkdir(bin);
const file = path.join(repo, 'answer.js'), external = path.join(dir, 'external.txt');
const body = 'export function answer() { return 42; }\n', sentinel = 'outside-source-must-never-be-returned';
await fs.writeFile(file, body); await fs.writeFile(external, sentinel);
const marker = path.join(dir, 'editor-invoked');
const command = path.join(repo, process.platform === 'win32' ? 'editor.cmd' : 'editor');
if (process.platform === 'win32') await fs.writeFile(command, `@echo off\r\necho invoked>"${marker}"\r\n`);
else await fs.writeFile(command, `#!/bin/sh\nprintf invoked > '${marker.replace(/'/g, `'\\''`)}'\n`, { mode: 0o755 });
await fs.symlink(command, path.join(bin, process.platform === 'win32' ? 'code.cmd' : 'code'), 'file');
applyTestEnv({ syncProcess: true, cacheRoot: path.join(dir, 'cache'), embeddings: 'off',
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_TRUSTED_REPOS: '[]',
    PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` } });
const index = await createCompatibilityIndex(repo, { compatibilityKey: 'native-file-authority', profileId: 'default' });
await fs.writeFile(path.join(index, 'chunk_meta.json'), JSON.stringify([{ id: 0, file: 'answer.js',
  kind: 'FunctionDeclaration', name: 'answer', start: 0, end: Buffer.byteLength(body), startLine: 1, endLine: 1,
  sourceHash: createHash('sha1').update(body).digest('hex'), chunkUid: 'authority:answer' }]));
const session = createSupervisorSession({ timeoutMs: 10000, reassembleEvents: true });
let sequence = 0;
const request = async (method, params) => {
  const jobId = `search-${++sequence}`;
  session.send({ op: 'search:run', jobId, method, params });
  return session.waitForEvent(event => event.event === 'job:end' && event.jobId === jobId, 10000);
};
const success = async (...args) => {
  const end = await request(...args); assert.equal(end.status, 'done', JSON.stringify(end));
  return end.result.data;
};
try {
  await session.waitForEvent(event => event.event === 'hello');
  const page = await success('query', { repoPath: repo, search: { mode: 'code', backend: 'memory', type: 'FunctionDeclaration' } });
  const hitId = page.hits[0].hitId, params = { resultId: page.resultId, hitId };
  const source = await success('source', params); assert.match(source.excerpt, /return 42/);
  const open = { ...params, editor: 'code', confirmed: true, sourceHash: source.sourceIdentity.currentHash };
  await fs.unlink(file); await fs.symlink(external, file, 'file');
  assert.equal((await fs.lstat(file)).isSymbolicLink(), true);
  for (const [method, input] of [['source', params], ['open', open]]) {
    const end = await request(method, input);
    assert.equal(end.status, 'failed'); assert.equal(end.error.code, 'ERR_UNSAFE_FILE_PATH');
  }
  assert.equal(await fs.readFile(external, 'utf8'), sentinel);
  assert.equal(JSON.stringify(session.events).includes(sentinel), false);
  await fs.unlink(file); await fs.writeFile(file, body);
  const restored = await success('source', params); assert.equal(restored.sourceIdentity.drift, 'unchanged');
  const denied = await request('open', open);
  assert.equal(denied.status, 'failed'); assert.equal(denied.error.code, 'ERR_TUI_EDITOR_UNTRUSTED',
    'an external PATH alias cannot grant authority to a launcher physically inside an untrusted repository');
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
  assert.equal(await session.shutdown(), 0);
} finally {
  if (session.child.exitCode === null) { session.forceKill(); await session.waitForExit(); }
}
console.log('Actual file symlinks cannot redirect native search source reads or grant editor execution authority');
