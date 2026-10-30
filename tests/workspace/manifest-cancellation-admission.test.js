// Actual manifest, diagnostic CLI and build-refresh consumers; authored UNRUN.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { runWorkspaceStatusCli } from '../../tools/workspace/status.js';
import { runWorkspaceCatalogCli } from '../../tools/workspace/catalog.js';
import { runWorkspaceManifestCli } from '../../tools/workspace/manifest.js';
import { runWorkspaceBuildCli } from '../../tools/workspace/build.js';
import { runWorkspaceCliLifecycle } from '../../tools/workspace/cli-lifecycle.js';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { getContainedFileSession } from '../../src/shared/contained-file-resource.js';
import { createCompatibilityIndex } from '../helpers/index-compatibility-fixture.js';
import { applyTestEnv } from '../helpers/test-env.js';

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'poc-workspace-manifest-cancel-'));
const workspacePath = path.join(root, 'workspace.jsonc'), output = path.join(root, 'retained-manifest.json');
const stat = fsp.stat, open = fsp.open, statSync = fs.statSync, log = console.log, errorLog = console.error, exitCode = process.exitCode;
const disposable = new Set();
const samePath = (left, right) => typeof left === 'string' && (process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right));
const reset = () => { fsp.stat = stat; fsp.open = open; fs.statSync = statSync; console.log = log; console.error = errorLog; process.exitCode = exitCode; };
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
try {
  for (const member of ['first', 'second']) await fsp.mkdir(path.join(root, member));
  await fsp.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: './first' }, { root: './second' }] }));
  const workspace = loadWorkspaceConfig(workspacePath);
  const cache = getRepoCacheRoot(workspace.repos[0].repoRootCanonical), build = path.join(cache, 'builds', 'fixture');
  const pointer = path.join(cache, 'builds', 'current.json');
  await createCompatibilityIndex(build, { mode: 'code', compatibilityKey: 'cancel-fixture' });
  await fsp.writeFile(pointer, JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'fixture', buildRoot: build, modes: ['code'] }));
  await fsp.writeFile(output, 'previous reviewed manifest');
  const before = await fsp.readFile(output);

  for (const boundary of ['stat', 'reader-close']) {
    const controller = new AbortController(); let readsAfterCancellation = 0, exercised = false;
    fsp.stat = async (file, ...args) => {
      if (controller.signal.aborted) readsAfterCancellation += 1;
      const result = await stat(file, ...args);
      if (boundary === 'stat' && samePath(file, pointer)) { exercised = true; controller.abort(); }
      return result;
    };
    fsp.open = async (file, ...args) => {
      if (controller.signal.aborted) readsAfterCancellation += 1;
      const handle = await open(file, ...args);
      if (boundary !== 'reader-close' || !samePath(file, pointer)) return handle;
      return { fd: handle.fd, stat: handle.stat.bind(handle), read: handle.read.bind(handle),
        close: async () => { const result = await handle.close(); exercised = true; controller.abort(); return result; } };
    };
    await assert.rejects(generateWorkspaceManifest(workspace, { write: true, allowPartial: true, manifestPath: output, signal: controller.signal }), { name: 'AbortError' });
    assert.equal(exercised, true); assert.equal(readsAfterCancellation, 0,
      'cancellation is not a partial-member diagnostic and never admits another mode/member/publication');
    assert.deepEqual(await fsp.readFile(output), before);
    reset();
  }

  const controller = new AbortController(); let ready = false, closes = 0, retained;
  const original = Object.freeze(Object.assign(new Error('cancelled original pointer reader remains borrowed'), {
    code: 'ENOENT', cacheOwnershipReleased() { assert.equal(this, original); return ready; }
  }));
  fsp.open = async (file, ...args) => {
    const handle = await open(file, ...args);
    if (!samePath(file, pointer)) return handle;
    disposable.add(handle);
    return { fd: handle.fd, stat: handle.stat.bind(handle), read: async () => { controller.abort(); throw original; },
      close: async () => { closes += 1; const result = await handle.close(); disposable.delete(handle); return result; } };
  };
  await assert.rejects(generateWorkspaceManifest(workspace, { write: false, allowPartial: true, signal: controller.signal }),
    error => { retained = error; return error.cacheOwnershipPending === true; });
  assert.equal(closes, 0); assert.equal(retained.cacheOwnershipReleased(), false);
  ready = true; await getContainedFileSession(retained).releaseAfterClose();
  assert.equal(closes, 1); assert.equal(retained.cacheOwnershipReleased(), true);
  reset();

  for (const [action, main] of [['status', runWorkspaceStatusCli], ['catalog', runWorkspaceCatalogCli], ['manifest', runWorkspaceManifestCli]]) {
    const outputRows = [], stderr = [];
    const interrupts = process.listenerCount('SIGINT'), terminations = process.listenerCount('SIGTERM');
    fsp.stat = async (file, ...args) => {
      const result = await stat(file, ...args);
      if (samePath(file, pointer)) process.emit('SIGINT');
      return result;
    };
    console.log = value => outputRows.push(value); console.error = value => stderr.push(value);
    const result = await runWorkspaceCliLifecycle(main, { action, rawArgs: ['--workspace', workspacePath, '--json'] });
    assert.equal(result.state, 'cancelled'); assert.equal(result.ok, false); assert.equal(process.exitCode, 130);
    assert.equal(outputRows.length, 1); assert.deepEqual(JSON.parse(outputRows[0]), result); assert.deepEqual(stderr, []);
    assert.equal(process.listenerCount('SIGINT'), interrupts); assert.equal(process.listenerCount('SIGTERM'), terminations);
    reset();
  }
  const outputRows = [], interrupts = process.listenerCount('SIGINT'), terminations = process.listenerCount('SIGTERM');
  console.log = value => outputRows.push(value);
  const result = await runWorkspaceBuildCli(['--workspace', workspacePath, '--json'], {
    runBuild: async () => ({ status: 'passed', exitCode: 0, signal: null, durationMs: 0 }),
    refreshManifest: async (_workspace, options) => {
      assert.equal(options.write, true); assert.equal(options.signal.aborted, false);
      process.emit('SIGINT'); options.signal.throwIfAborted();
      assert.fail('the active refresh must retain the command signal lifetime');
    }
  });
  assert.equal(result.ok, false); assert.equal(result.state, 'cancelled'); assert.equal(result.diagnostics.outcome, 'passed');
  assert.equal(result.manifestRefresh, 'not-completed-cancelled'); assert.equal(process.exitCode, 130);
  assert.equal(outputRows.length, 1); assert.deepEqual(JSON.parse(outputRows[0]), result);
  assert.equal(process.listenerCount('SIGINT'), interrupts); assert.equal(process.listenerCount('SIGTERM'), terminations);
  assert.deepEqual(await fsp.readFile(output), before);
} finally {
  reset(); for (const handle of disposable) await handle.close();
  await fsp.rm(root, { recursive: true, force: true });
}
console.log('Workspace manifest, diagnostic CLI and build-refresh cancellation retain actual read and publication boundaries.');
