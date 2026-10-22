import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTuiSettingsSession } from '../../tools/tui/operator/settings.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { parseJsoncText } from '../../src/shared/jsonc.js';
import { acquireFileLock } from '../../src/shared/locks/file-lock.js';
import { initGitRepo } from '../helpers/git-fixture.js';

const root = process.cwd();
const { dir } = await prepareIsolatedTestCacheDir('tui-settings');
const repoA = path.join(dir, 'repository A'), repoB = path.join(dir, 'repository B');
await fs.mkdir(repoA); await fs.mkdir(repoB);
initGitRepo(repoA); initGitRepo(repoB);
const fileA = path.join(repoA, '.pairofcleats.json');
const secret = 'fixture-private-value-must-not-enter-a-result';
const source = `{
  // Keep this unrelated comment and the provider's private configuration.
  "quality": "fast",
  "threads": 2,
  "search": { "annDefault": false, "hyperlinks": "off" },
  "tooling": { "lsp": { "servers": [{ "id": "private-fixture", "cmd": "never-run",
    "args": ["-Djavax.net.ssl.keyStorePassword=${secret}"], "env": { "API_TOKEN": "${secret}" } }] } }
}\n`;
await fs.writeFile(fileA, source);
await fs.writeFile(path.join(repoB, '.pairofcleats.json'), '{"threads":1}\n');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off',
  syncProcess: false, extraEnv: { PAIROFCLEATS_TRUSTED_REPOS: '[]' } });
const session = createTuiSettingsSession({ toolRoot: root, env });
const selected = await session.selectScope({ kind: 'repo', target: repoA });
const inspected = await session.inspectConfig({ scopeId: selected.id });
assert.equal(inspected.validation.ok, true, JSON.stringify(inspected.validation));
assert.deepEqual(inspected.diagnostics, []);
assert.ok(inspected.fields.length > 300, 'the catalog comes from the complete canonical schema');
assert.ok(inspected.effective.configSources, 'the actual canonical dump retains config provenance');
assert.equal(inspected.effective.userConfig.threads, 2);
assert.equal(JSON.stringify(inspected).includes(secret), false, 'requested and effective field projections are redacted');
assert.equal(inspected.fields.find(field => field.path.join('.') === 'tooling.lsp.servers').editable, false);
const edit = (info, value = 1) => ({ scopeId: info.scope.id, operation: 'edit', path: ['threads'],
  value, revision: info.revision, schemaRevision: info.schemaRevision });
const invalid = await session.preview(edit(inspected, 'invalid'));
assert.equal(invalid.ok, false);
assert.ok(invalid.validation.errors.length);
assert.equal(invalid.previewId, undefined);
assert.equal(await fs.readFile(fileA, 'utf8'), source);
await assert.rejects(session.preview({ ...edit(inspected), path: ['constructor', 'prototype'] }),
  { code: 'ERR_TUI_SETTINGS_FIELD' });
await assert.rejects(session.preview({ ...edit(inspected), path: ['cache', 'root'], value: dir }),
  { code: 'ERR_TUI_SETTINGS_AUTHORITY' });
const prepared = await session.preview(edit(inspected));
assert.equal(prepared.ok, true);
assert.deepEqual(prepared.diff, [{ path: ['threads'], before: 2, after: 1, beforePresent: true, afterPresent: true }]);
assert.equal(JSON.stringify(prepared).includes(secret), false);
await assert.rejects(session.commit({ scopeId: selected.id, previewId: prepared.previewId }),
  { code: 'ERR_TUI_SETTINGS_CONFIRMATION' });
assert.equal(await fs.readFile(fileA, 'utf8'), source);
await session.commit({ scopeId: selected.id, previewId: prepared.previewId, confirmed: true });
const changed = await fs.readFile(fileA, 'utf8');
assert.ok(changed.includes('// Keep this unrelated comment'));
assert.equal(parseJsoncText(changed).tooling.lsp.servers[0].env.API_TOKEN, secret);
assert.deepEqual(parseJsoncText(changed).search, { annDefault: false, hyperlinks: 'off' });
const after = await session.inspectConfig({ scopeId: selected.id });
assert.equal(after.effective.userConfig.threads, 1, 'the next real canonical child consumes the saved value');
assert.equal(JSON.stringify(after).includes(secret), false);
await assert.rejects(session.commit({ scopeId: selected.id, previewId: prepared.previewId, confirmed: true }),
  { code: 'ERR_TUI_SETTINGS_PREVIEW' });

const cancelled = await session.preview(edit(after, 3));
assert.deepEqual(session.cancel({ scopeId: selected.id, previewId: cancelled.previewId }), { cancelled: true });
await assert.rejects(session.commit({ scopeId: selected.id, previewId: cancelled.previewId, confirmed: true }),
  { code: 'ERR_TUI_SETTINGS_PREVIEW' });
assert.equal(await fs.readFile(fileA, 'utf8'), changed);

const waiting = await session.preview(edit(after, 3));
const lease = await acquireFileLock({ lockPath: `${fileA}.edit.lock`, waitMs: 0 });
assert.ok(lease);
const committing = session.commit({ scopeId: selected.id, previewId: waiting.previewId, confirmed: true });
committing.catch(() => {});
session.cancel({ scopeId: selected.id, previewId: waiting.previewId });
await lease.release();
await assert.rejects(committing, { code: 'ERR_TUI_SETTINGS_PREVIEW' });
assert.equal(await fs.readFile(fileA, 'utf8'), changed, 'cancelling a queued save cannot publish after its lease opens');

const stale = await session.preview(edit(after, 3));
const stat = await fs.stat(fileA);
const external = changed.replace(/"threads"\s*:\s*1/u, '"threads": 9');
assert.notEqual(external, changed);
await fs.writeFile(fileA, external); await fs.utimes(fileA, stat.atime, stat.mtime);
await assert.rejects(session.commit({ scopeId: selected.id, previewId: stale.previewId, confirmed: true }),
  { code: 'ERR_TUI_SETTINGS_STALE' });
assert.equal(await fs.readFile(fileA, 'utf8'), external);

const frozen = session.captureScope(selected.id);
assert.ok(Object.isFrozen(frozen));
const second = await session.selectScope({ kind: 'repo', target: repoB });
assert.equal(frozen.configRoot, repoA, 'captured job scope never follows a later selection');
assert.equal(second.configRoot, repoB);
await assert.rejects(session.inspectConfig({ scopeId: selected.id }), { code: 'ERR_TUI_SCOPE_CHANGED' });

const workspacePath = path.join(dir, 'workspace.jsonc');
const workspace = { schemaVersion: 1, name: 'settings fixture', repos: [{ root: repoA }, { root: repoB }] };
await fs.writeFile(workspacePath, JSON.stringify(workspace));
const workspaceScope = await session.selectScope({ kind: 'workspace', target: workspacePath });
assert.equal(workspaceScope.repoCount, 2);
assert.equal(workspaceScope.target, await fs.realpath(workspacePath));
await fs.writeFile(workspacePath, JSON.stringify({ ...workspace, repos: [{ root: repoB }] }));
assert.throws(() => session.captureScope(workspaceScope.id), { code: 'ERR_TUI_SCOPE_CHANGED' });

const resetScope = await session.selectScope({ kind: 'repo', target: repoA });
const beforeReset = await session.inspectConfig({ scopeId: resetScope.id });
const reset = await session.preview({ scopeId: resetScope.id, operation: 'reset',
  revision: beforeReset.revision, schemaRevision: beforeReset.schemaRevision });
assert.ok(reset.diff.some(change => change.path?.join('.') === 'threads' && !change.afterPresent));
assert.equal(JSON.stringify(reset).includes(secret), false);
await assert.rejects(session.commit({ scopeId: resetScope.id, previewId: reset.previewId, confirmed: true }),
  { code: 'ERR_TUI_SETTINGS_CONFIRMATION' });
await session.commit({ scopeId: resetScope.id, previewId: reset.previewId, confirmed: true, resetConfirmation: 'RESET' });
assert.equal(await fs.readFile(`${fileA}.bak`, 'utf8'), external);
assert.deepEqual(parseJsoncText(await fs.readFile(fileA, 'utf8')), { quality: 'auto' });
await assert.rejects(fs.stat(`${fileA}.edit.lock`), { code: 'ENOENT' });
session.dispose();
await assert.rejects(session.selectScope({ kind: 'repo', target: repoA }), { code: 'ERR_TUI_SESSION_CLOSED' });
console.log('TUI settings schema, real canonical preview/persistence, scope, cancellation and stale/reset contracts passed');
