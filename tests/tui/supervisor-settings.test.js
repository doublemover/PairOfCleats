import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { initGitRepo } from '../helpers/git-fixture.js';
import { parseJsoncText } from '../../src/shared/jsonc.js';

const { dir } = await prepareIsolatedTestCacheDir('supervisor-settings');
const repo = path.join(dir, 'repository'), other = path.join(dir, 'other');
await fs.mkdir(repo); await fs.mkdir(other); initGitRepo(repo); initGitRepo(other);
const file = path.join(repo, '.pairofcleats.json');
const privateValue = 'supervisor-raw-private-value';
await fs.writeFile(file, JSON.stringify({ threads: 2, tooling: { lsp: { servers: [
  { id: 'private', cmd: 'never-run', args: [`-Djavax.net.ssl.keyStorePassword=${privateValue}`] }
] } } }));
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', syncProcess: true });
const session = createSupervisorSession({ reassembleEvents: true });
let index = 0;
const request = async (method, params, extra = {}) => {
  const jobId = `settings-${++index}`;
  session.send({ op: 'settings:run', jobId, method, params, ...extra });
  return session.waitForEvent(event => event.event === 'job:end' && event.jobId === jobId, 12000);
};
const success = async (...args) => {
  const end = await request(...args);
  assert.equal(end.status, 'done', JSON.stringify(end));
  assert.equal(end.resultState, 'complete'); assert.equal(end.internal, true);
  return end.result.data;
};
try {
  const hello = await session.waitForEvent(event => event.event === 'hello');
  assert.equal(hello.capabilities.supportsSettings, true);
  const scope = await success('select', { kind: 'repo', target: repo });
  const inspected = await success('inspect', { scopeId: scope.id });
  assert.equal(inspected.effective.userConfig.threads, 2);
  assert.ok(inspected.effective.configSources);
  const edit = { scopeId: scope.id, revision: inspected.revision, schemaRevision: inspected.schemaRevision,
    operation: 'edit', path: ['threads'], value: 1 };
  const invalid = await success('preview', { ...edit, value: 'invalid' });
  assert.equal(invalid.ok, false); assert.equal(invalid.previewId, undefined);
  const preview = await success('preview', edit);
  assert.equal(parseJsoncText(await fs.readFile(file, 'utf8')).threads, 2, 'preview never writes');
  const denied = await request('commit', { scopeId: scope.id, previewId: preview.previewId });
  assert.equal(denied.status, 'failed'); assert.equal(denied.error.code, 'ERR_TUI_SETTINGS_CONFIRMATION');
  await success('commit', { scopeId: scope.id, previewId: preview.previewId, confirmed: true });
  assert.equal(parseJsoncText(await fs.readFile(file, 'utf8')).threads, 1);
  assert.ok((await fs.readFile(file, 'utf8')).includes(privateValue));
  const refreshed = await success('inspect', { scopeId: scope.id });
  assert.equal(refreshed.effective.userConfig.threads, 1, 'next canonical config invocation observes the saved value');
  const reset = await success('preview', { ...edit, revision: refreshed.revision, operation: 'reset', path: undefined, value: undefined });
  const resetDenied = await request('commit', { scopeId: scope.id, previewId: reset.previewId, confirmed: true });
  assert.equal(resetDenied.status, 'failed');
  await success('cancel', { scopeId: scope.id, previewId: reset.previewId });
  assert.equal((await request('commit', { scopeId: scope.id, previewId: reset.previewId, confirmed: true,
    resetConfirmation: 'RESET' })).status, 'failed');
  await success('select', { kind: 'repo', target: other });
  assert.equal((await request('inspect', { scopeId: scope.id })).error.code, 'ERR_TUI_SCOPE_CHANGED');
  assert.equal((await request('select', { kind: 'repo', target: repo }, { configPath: file })).error.code,
    'ERR_TUI_SETTINGS_REQUEST');
  assert.equal(JSON.stringify(session.events).includes(privateValue), false);
  assert.equal(session.events.some(event => event.type === 'malformed-json-line'), false);
  assert.equal(await session.shutdown(), 0);
} finally { session.forceKill(); }
console.log('Real supervisor settings transactions retain canonical validation, confirmation, scope and privacy');
