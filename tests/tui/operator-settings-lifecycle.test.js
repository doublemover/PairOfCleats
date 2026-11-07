import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTuiSettingsSession } from '../../tools/tui/operator/settings.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { initGitRepo } from '../helpers/git-fixture.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';

const root = process.cwd();
const { dir } = await prepareIsolatedTestCacheDir('tui-settings-lifecycle');
const repo = path.join(dir, 'repository'), alternate = path.join(dir, 'alternate');
await fs.mkdir(repo); await fs.mkdir(alternate);
initGitRepo(repo); initGitRepo(alternate);
const file = path.join(repo, '.pairofcleats.json');
const storedSecret = 'fixture-existing-private-arguments';
const initialSource = `${JSON.stringify({ quality: 'fast', threads: 1,
  tooling: { lsp: { servers: [{ id: 'private-existing', cmd: 'never-run',
    args: [`-Djavax.net.ssl.keyStorePassword=${storedSecret}`], env: { API_TOKEN: storedSecret } }] } } })}\n`;
await fs.writeFile(file, initialSource);
await fs.writeFile(path.join(alternate, '.pairofcleats.json'), '{}\n');
const schemaPath = path.join(dir, 'schema.json');
await fs.copyFile(path.join(root, 'docs/config/schema.json'), schemaPath);
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, 'cache'), embeddings: 'off',
  extraEnv: { PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo]) } });
let clock = 0;
const session = createTuiSettingsSession({ toolRoot: root, schemaPath, env, now: () => clock });
const selected = await session.selectScope({ kind: 'repo', target: repo });
let info = await session.inspectConfig({ scopeId: selected.id });
assert.equal(info.validation.ok, true);
assert.equal(JSON.stringify(info).includes(storedSecret), false,
  'trusted existing raw arguments stay out of fields and the effective preview');
info.fields.find(field => field.path.join('.') === 'threads').schema.type = 'string';
info = await session.inspectConfig({ scopeId: selected.id });
assert.equal(info.fields.find(field => field.path.join('.') === 'threads').schema.type, 'number',
  'public field metadata cannot mutate the verified schema or its cached validator');
const request = value => ({ scopeId: selected.id, operation: 'edit', path: ['threads'], value,
  revision: info.revision, schemaRevision: info.schemaRevision });
const secret = 'fixture-new-private-token';
await assert.rejects(session.preview({ ...request(2), path: ['tooling', 'lsp', 'servers'],
  value: [{ id: 'private-arguments', args: [`-Djavax.net.ssl.keyStorePassword=${secret}`] }] }),
{ code: 'ERR_TUI_SETTINGS_SENSITIVE' }, 'tool-specific raw credential flags cannot enter a native preview');
await assert.rejects(session.preview({ ...request(2), path: ['tooling', 'lsp', 'servers'],
  value: [{ id: 'private-fixture', cmd: 'never-run', env: { API_TOKEN: secret } }] }),
{ code: 'ERR_TUI_SETTINGS_SENSITIVE' }, 'trusted scope still cannot put new credentials in previews');
const abort = new AbortController(); abort.abort();
await assert.rejects(session.preview(request(2), { signal: abort.signal }), { code: 'ABORT_ERR' });
const expired = await session.preview(request(2));
clock = 300001;
await assert.rejects(session.commit({ scopeId: selected.id, previewId: expired.previewId, confirmed: true }),
  { code: 'ERR_TUI_SETTINGS_PREVIEW' });
assert.equal(await fs.readFile(file, 'utf8'), initialSource);

const queued = [];
for (let index = 0; index < 17; index++) queued.push(await session.preview(request(index + 2)));
await assert.rejects(session.commit({ scopeId: selected.id, previewId: queued[0].previewId, confirmed: true }),
  { code: 'ERR_TUI_SETTINGS_PREVIEW' }, 'session candidate retention is bounded');
const schemaStale = queued.at(-1);
const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
await fs.writeFile(schemaPath, JSON.stringify({ ...schema, title: 'Changed fixture schema revision' }));
await assert.rejects(session.commit({ scopeId: selected.id, previewId: schemaStale.previewId, confirmed: true }),
  { code: 'ERR_TUI_SETTINGS_STALE' });
assert.equal(await fs.readFile(file, 'utf8'), initialSource);
info = await session.inspectConfig({ scopeId: selected.id });
const candidate = await session.preview(request(2));
const commits = await Promise.allSettled([0, 1].map(() => session.commit({ scopeId: selected.id,
  previewId: candidate.previewId, confirmed: true })));
assert.equal(commits.filter(result => result.status === 'fulfilled').length, 1);
assert.ok(commits.some(result => result.status === 'rejected'
  && ['ERR_TUI_SETTINGS_PREVIEW', 'ERR_TUI_SETTINGS_STALE'].includes(result.reason.code)));

await fs.writeFile(`${file}.bak`, 'previous snapshot');
const lateInfo = await session.inspectConfig({ scopeId: selected.id });
const lateReset = await session.preview({ scopeId: selected.id, operation: 'reset',
  revision: lateInfo.revision, schemaRevision: lateInfo.schemaRevision });
const originalOpen = fs.open;
const externalEdit = '{"quality":"max","threads":7}\n';
fs.open = async (target, ...args) => {
  const handle = await originalOpen(target, ...args);
  if (target === `${file}.bak`) {
    const close = handle.close.bind(handle);
    handle.close = async () => { await close(); await fs.writeFile(file, externalEdit); };
  }
  return handle;
};
try {
  await assert.rejects(session.commit({ scopeId: selected.id, previewId: lateReset.previewId,
    confirmed: true, resetConfirmation: 'RESET' }), { code: 'ERR_TUI_SETTINGS_STALE' },
  'an external edit during the final asynchronous backup read cannot be overwritten');
} finally { fs.open = originalOpen; }
assert.equal(await fs.readFile(file, 'utf8'), externalEdit);

await fs.writeFile(file, '{malformed');
const malformed = await session.inspectConfig({ scopeId: selected.id });
assert.equal(malformed.validation.ok, false);
assert.equal(malformed.effective, null, 'invalid source never becomes a fabricated effective config');
const reset = await session.preview({ scopeId: selected.id, operation: 'reset',
  revision: malformed.revision, schemaRevision: malformed.schemaRevision });
await fs.writeFile(`${file}.bak`, 'external backup');
await assert.rejects(session.commit({ scopeId: selected.id, previewId: reset.previewId,
  confirmed: true, resetConfirmation: 'RESET' }), { code: 'ERR_TUI_SETTINGS_STALE' });
assert.equal(await fs.readFile(file, 'utf8'), '{malformed');
assert.equal(await fs.readFile(`${file}.bak`, 'utf8'), 'external backup');

const originalBytes = Buffer.concat([Buffer.from('{"threads":1}\n// undecodable original byte: '), Buffer.from([255])]);
await fs.writeFile(file, originalBytes);
const encoded = await session.inspectConfig({ scopeId: selected.id });
const recover = await session.preview({ scopeId: selected.id, operation: 'reset',
  revision: encoded.revision, schemaRevision: encoded.schemaRevision });
await session.commit({ scopeId: selected.id, previewId: recover.previewId, confirmed: true, resetConfirmation: 'RESET' });
assert.deepEqual(await fs.readFile(`${file}.bak`), originalBytes,
  'reset preserves the exact original bytes even when they cannot be edited as UTF-8');

const originalRealpath = fs.realpath;
let release;
const held = new Promise(resolve => { release = resolve; });
fs.realpath = async target => { if (target === repo) await held; return originalRealpath(target); };
try {
  const first = session.selectScope({ kind: 'repo', target: repo });
  first.catch(() => {});
  const latest = await session.selectScope({ kind: 'repo', target: alternate });
  release();
  await assert.rejects(first, { code: 'ERR_TUI_SCOPE_CHANGED' });
  assert.equal(session.captureScope(latest.id).configRoot, alternate, 'an older delayed selection cannot replace a newer one');
} finally { release(); fs.realpath = originalRealpath; }
const pinned = await session.selectScope({ kind: 'repo', target: alternate });
const moved = path.join(dir, 'moved-alternate');
for (const target of [alternate, moved]) assert.ok(isPathWithinRoot(path.resolve(target), await fs.realpath(dir)));
await fs.rename(alternate, moved);
await fs.mkdir(alternate);
assert.throws(() => session.captureScope(pinned.id), { code: 'ERR_TUI_SCOPE_CHANGED' },
  'replacing a selected root cannot transfer authority to another directory');
session.dispose();
console.log('TUI settings retention, abort, schema/backup races, malformed recovery and scope lifecycle passed');
