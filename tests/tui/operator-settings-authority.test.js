import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTuiSettingsSession } from '../../tools/tui/operator/settings.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { initGitRepo } from '../helpers/git-fixture.js';

// Requires actual file symlinks. The strict Windows authority cohort supplies
// a capable launch; junctions, a skipped assertion or a retry cannot qualify it.
const root = process.cwd();
const { dir } = await prepareIsolatedTestCacheDir('tui-settings-authority');
const repo = path.join(dir, 'repository'), outside = path.join(dir, 'outside');
await fs.mkdir(repo); await fs.mkdir(outside); initGitRepo(repo);
const file = path.join(repo, '.pairofcleats.json'), external = path.join(outside, 'protected.json');
const original = '{"quality":"fast","threads":2}\n', sentinel = '{"quality":"max","threads":99}\n';
await fs.writeFile(file, original); await fs.writeFile(external, sentinel);
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, 'cache'), embeddings: 'off' });
const session = createTuiSettingsSession({ toolRoot: root, env });
const scope = await session.selectScope({ kind: 'repo', target: repo });
const inspected = await session.inspectConfig({ scopeId: scope.id });
const request = (info, value) => ({ scopeId: scope.id, operation: 'edit', path: ['threads'], value,
  revision: info.revision, schemaRevision: info.schemaRevision });
const candidate = await session.preview(request(inspected, 1));
try {
  await fs.unlink(file);
  await fs.symlink(external, file, 'file');
  assert.equal((await fs.lstat(file)).isSymbolicLink(), true, 'the actual attack is a file symlink');
  await assert.rejects(session.inspectConfig({ scopeId: scope.id }), { code: 'ERR_UNSAFE_FILE_PATH' });
  await assert.rejects(session.commit({ scopeId: scope.id, previewId: candidate.previewId, confirmed: true }),
    { code: 'ERR_UNSAFE_FILE_PATH' });
  assert.equal(await fs.readFile(external, 'utf8'), sentinel);
  await fs.unlink(file); await fs.writeFile(file, original);
  await session.commit({ scopeId: scope.id, previewId: candidate.previewId, confirmed: true });
  const after = await session.inspectConfig({ scopeId: scope.id });
  const saved = await fs.readFile(file, 'utf8');
  const reset = await session.preview({ scopeId: scope.id, operation: 'reset',
    revision: after.revision, schemaRevision: after.schemaRevision });
  await fs.symlink(external, `${file}.bak`, 'file');
  await assert.rejects(session.commit({ scopeId: scope.id, previewId: reset.previewId,
    confirmed: true, resetConfirmation: 'RESET' }), { code: 'ERR_UNSAFE_FILE_PATH' });
  assert.equal(await fs.readFile(file, 'utf8'), saved);
  assert.equal(await fs.readFile(external, 'utf8'), sentinel);
  await fs.unlink(`${file}.bak`);
  const edit = await session.preview(request(after, 2));
  await fs.symlink(external, `${file}.edit.lock`, 'file');
  await assert.rejects(session.commit({ scopeId: scope.id, previewId: edit.previewId, confirmed: true }),
    { code: 'ERR_UNSAFE_FILE_PATH' });
  assert.equal(await fs.readFile(file, 'utf8'), saved);
  assert.equal(await fs.readFile(external, 'utf8'), sentinel);
  await fs.unlink(`${file}.edit.lock`);
} finally { session.dispose(); }
console.log('Actual file symlinks cannot redirect settings reads, saves, reset backups or edit locks');
