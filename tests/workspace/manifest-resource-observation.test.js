import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { generateWorkspaceManifest, readWorkspaceManifest } from '../../src/workspace/manifest.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { getContainedFileSession } from '../../src/shared/contained-file-resource.js';
import { createCompatibilityIndex } from '../helpers/index-compatibility-fixture.js';
import { applyTestEnv } from '../helpers/test-env.js';

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'poc-workspace-manifest-resource-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
const repo = path.join(root, 'member');
const workspacePath = path.join(root, 'workspace.jsonc');
const open = fsp.open, stat = fsp.stat, statSync = fs.statSync;
const samePath = (left, right) => typeof left === 'string' && (process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right));
try {
  await fsp.mkdir(repo);
  await fsp.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: './member' }] }));
  const workspace = loadWorkspaceConfig(workspacePath);
  const cache = getRepoCacheRoot(repo);
  const build = path.join(cache, 'builds', 'current-fixture');
  await createCompatibilityIndex(build, { mode: 'code', compatibilityKey: 'fixture-resource' });
  const pointer = path.join(cache, 'builds', 'current.json');
  await fsp.writeFile(pointer, JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'current-fixture', buildRoot: build, modes: ['code'] }));
  const saved = path.join(root, 'saved-manifest.json');
  await fsp.writeFile(saved, '{}');
  for (const [target, action] of [[pointer, () => generateWorkspaceManifest(workspace, { write: false, allowPartial: true })],
    [saved, () => readWorkspaceManifest(saved)]]) {
    let ready = false, closes = 0, failure;
    const original = Object.freeze(Object.assign(new Error('original JSON descriptor read is still pending'), {
      cacheOwnershipReleased() { assert.equal(this, original); return ready; }
    }));
    fsp.open = async (file, ...args) => {
      const handle = await open(file, ...args);
      if (!samePath(file, target)) return handle;
      return { fd: handle.fd, stat: handle.stat.bind(handle), read: async () => { throw original; },
        close: async () => { closes += 1; return handle.close(); } };
    };
    await assert.rejects(action(), error => { failure = error; return error.cacheOwnershipPending === true; });
    assert.equal(closes, 0, 'a pending native JSON read cannot close its borrowed descriptor');
    assert.equal(failure.cacheOwnershipReleased(), false);
    const session = getContainedFileSession(failure);
    assert.ok(session, 'the original JSON descriptor recovery remains reachable through the workspace boundary');
    ready = true;
    await session.releaseAfterClose();
    assert.equal(closes, 1);
    assert.equal(failure.cacheOwnershipReleased(), true);
    fsp.open = open;
  }
  // Even ENOENT is not an absence witness when the actual stat producer still
  // owns work. Neither async path probes nor sync artifact probes may erase it.
  for (const sync of [false, true]) {
    let ready = false, failure;
    const original = Object.freeze(Object.assign(new Error('pending stat is not missing data'), { code: 'ENOENT',
      cacheOwnershipReleased() { assert.equal(this, original); return ready; } }));
    const target = sync ? path.join(build, 'index-code', 'chunk_meta.json') : pointer;
    if (sync) fs.statSync = (file, ...args) => { if (samePath(file, target)) throw original; return statSync(file, ...args); };
    else fsp.stat = async (file, ...args) => { if (samePath(file, target)) throw original; return stat(file, ...args); };
    await assert.rejects(generateWorkspaceManifest(workspace, { write: false, allowPartial: true }),
      error => { failure = error; return error.cacheOwnershipPending === true; });
    assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true;
    assert.equal(failure.cacheOwnershipReleased(), true);
    fs.statSync = statSync; fsp.stat = stat;
  }
  await fsp.writeFile(saved, '{ invalid JSON');
  await assert.rejects(readWorkspaceManifest(saved), error => {
    assert.equal(error.workspaceManifestPath, saved);
    assert.match(error.workspaceManifestDiagnostic, /Failed to read workspace manifest/);
    return true;
  });
} finally { fsp.open = open; fsp.stat = stat; fs.statSync = statSync; await fsp.rm(root, { recursive: true, force: true }); }
console.log('Workspace manifest readers retain original JSON and stat resource observations.');
