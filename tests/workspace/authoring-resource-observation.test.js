import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { planWorkspaceAuthoring, applyWorkspaceAuthoring } from '../../tools/workspace/author.js';
import { getContainedFileSession } from '../../src/shared/contained-file-resource.js';

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'poc-workspace-authoring-resource-'));
const workspacePath = path.join(root, 'workspace.jsonc');
const repo = path.join(root, 'selected-project');
const lstat = fs.lstatSync, open = fs.openSync, read = fs.readSync, close = fs.closeSync;
const disposal = new Set();
const samePath = (left, right) => typeof left === 'string' && (process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right));
try {
  await fsp.mkdir(repo);
  const initial = '{ "schemaVersion": 1, "repos": [{ "root": "./selected-project" }] }';
  await fsp.writeFile(workspacePath, initial);
  {
    let ready = false, failure;
    const original = Object.freeze(Object.assign(new Error('original config metadata still pending'), { code: 'ENOENT',
      cacheOwnershipReleased() { assert.equal(this, original); return ready; } }));
    fs.lstatSync = (file, ...args) => { if (samePath(file, workspacePath)) throw original; return lstat(file, ...args); };
    assert.throws(() => planWorkspaceAuthoring({ workspacePath, roots: [repo] }),
      error => { failure = error; return error.cacheOwnershipPending === true; });
    assert.equal(failure.cacheOwnershipReleased(), false, 'pending ENOENT cannot create a new-workspace approval');
    ready = true;
    assert.equal(failure.cacheOwnershipReleased(), true);
    fs.lstatSync = lstat;
  }
  const second = path.join(root, 'second-project');
  await fsp.mkdir(second);
  const approved = planWorkspaceAuthoring({ workspacePath, operation: 'add', roots: [second] });
  let ready = false, selectedFd = null, closes = 0, failure;
  const original = Object.freeze(Object.assign(new Error('original authoring JSON read still pending'), {
    cacheOwnershipReleased() { assert.equal(this, original); return ready; }
  }));
  fs.openSync = (file, ...args) => {
    const fd = open(file, ...args);
    if (samePath(file, workspacePath)) { selectedFd = fd; disposal.add(fd); }
    return fd;
  };
  fs.readSync = (fd, ...args) => { if (fd === selectedFd) throw original; return read(fd, ...args); };
  fs.closeSync = fd => { if (fd === selectedFd) closes += 1; const result = close(fd); disposal.delete(fd); return result; };
  await assert.rejects(applyWorkspaceAuthoring(approved), error => { failure = error; return error.cacheOwnershipPending === true; });
  assert.equal(closes, 0);
  const session = getContainedFileSession(failure);
  assert.ok(session, 'the exact original text reader owns descriptor recovery');
  assert.throws(() => session.releaseAfterCloseSync(), error => error.cacheOwnershipPending === true);
  ready = true;
  session.releaseAfterCloseSync();
  assert.equal(closes, 1);
  assert.equal(failure.cacheOwnershipReleased(), true);
  fs.openSync = open; fs.readSync = read; fs.closeSync = close;
  assert.equal(await fsp.readFile(workspacePath, 'utf8'), initial);
  await assert.rejects(fsp.stat(`${workspacePath}.authoring-lock`), { code: 'ENOENT' });
} finally {
  fs.lstatSync = lstat; fs.openSync = open; fs.readSync = read; fs.closeSync = close;
  for (const fd of disposal) { try { close(fd); } catch {} }
  await fsp.rm(root, { recursive: true, force: true });
}
console.log('Workspace authoring preserves original metadata and descriptor observations without mutation.');
