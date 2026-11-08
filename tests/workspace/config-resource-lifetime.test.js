import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readJsoncFile } from '../../src/shared/jsonc.js';
import { loadWorkspaceConfig, WORKSPACE_ERROR_CODES } from '../../src/workspace/config.js';
import { getContainedFileSession } from '../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';

// UNVALIDATED: real JSONC/workspace borrowers with original numeric FD boundaries.
const root = await makeTempDir('poc-workspace-config-resource-'), repo = path.join(root, 'repo');
await fsp.mkdir(repo);
const target = path.join(root, 'workspace.jsonc');
const valid = '{ // comments remain accepted\n "schemaVersion": 1, "repos": [{"root": "./repo",}], }';
await fsp.writeFile(target, valid);
const open = fs.openSync, read = fs.readSync, close = fs.closeSync, disposal = new Set();
const rejected = action => {
  let failed = false, failure;
  try { action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
const contains = (failure, expected) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    const cause = Object.getOwnPropertyDescriptor(current, 'cause'), errors = Object.getOwnPropertyDescriptor(current, 'errors');
    if (cause && 'value' in cause) queue.push(cause.value);
    if (Array.isArray(errors?.value)) queue.push(...errors.value);
  }
  return false;
};
const restore = () => { fs.openSync = open; fs.readSync = read; fs.closeSync = close; };
const dispose = () => { for (const fd of disposal) { try { close(fd); } catch {} disposal.delete(fd); } };
const intercept = ({ readFailure, closeFailure, nonvoid = false } = {}) => {
  const state = { reads: 0, closes: 0, opens: 0, allowRead: readFailure === undefined, allowClose: closeFailure === undefined && !nonvoid };
  fs.openSync = (name, ...args) => {
    const fd = open(name, ...args); if (name === target) { state.opens += 1; disposal.add(fd); } return fd;
  };
  fs.readSync = (fd, ...args) => {
    if (disposal.has(fd)) { state.reads += 1; if (!state.allowRead) throw readFailure; } return read(fd, ...args);
  };
  fs.closeSync = fd => {
    if (disposal.has(fd)) {
      state.closes += 1;
      if (!state.allowClose) { if (nonvoid) return false; throw closeFailure; }
      const result = close(fd); disposal.delete(fd); return result;
    }
    return close(fd);
  };
  return state;
};
try {
  assert.deepEqual(readJsoncFile(target), { schemaVersion: 1, repos: [{ root: './repo' }] });
  assert.equal(loadWorkspaceConfig(target).repos.length, 1);
  for (const action of [() => readJsoncFile(target), () => loadWorkspaceConfig(target)]) {
    for (const nonvoid of [false, true]) {
      const primary = Object.freeze(new Error('original JSONC descriptor close failed'));
      const state = intercept({ closeFailure: primary, nonvoid });
      const failure = rejected(action), session = getContainedFileSession(failure);
      assert.ok(session); assert.equal(state.closes, 1); assert.equal(state.reads, 1);
      assert.equal(failure.code === WORKSPACE_ERROR_CODES.PARSE_FAILED, false);
      assert.equal(failure.cacheOwnershipReleased(), false);
      if (!nonvoid) assert.equal(contains(failure, primary), true);
      state.allowClose = true; rejected(() => session.releaseAfterCloseSync());
      assert.equal(state.closes, 1, 'attempted numeric close cannot be retried from a pathname or fd');
      assert.equal(state.reads, 1); assert.equal(state.opens, 1);
      dispose(); assert.equal(session.isSettled(), false, 'fixture disposal supplies no generation proof'); restore();
    }
  }
  for (const marker of [undefined, false, true]) {
    let ready = false;
    const primary = new Error('JSONC read still owns original native work');
    if (marker !== undefined) primary.cacheOwnershipPending = marker;
    primary.cacheOwnershipReleased = function () { assert.equal(this, primary); return ready; };
    const state = intercept({ readFailure: primary });
    const failure = rejected(() => loadWorkspaceConfig(target)), session = getContainedFileSession(failure);
    assert.ok(session); assert.equal(contains(failure, primary), true); assert.equal(state.closes, 0);
    primary.cacheOwnershipReleased = () => true;
    fs.closeSync = () => assert.fail('replacement close cannot authorize original descriptor settlement');
    rejected(() => session.releaseAfterCloseSync()); assert.equal(state.closes, 0);
    ready = true; session.releaseAfterCloseSync();
    assert.equal(state.closes, 1); assert.equal(state.reads, 1); assert.equal(state.opens, 1); restore();
  }
  // A completed native error keeps the ordinary workspace issue, with its exact
  // cause. Diagnostic projection reads once and never coerces arbitrary objects.
  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('settled open failure'))]) {
    fs.openSync = (name, ...args) => { if (name === target) throw primary; return open(name, ...args); };
    const failure = rejected(() => loadWorkspaceConfig(target));
    assert.equal(failure.code, WORKSPACE_ERROR_CODES.PARSE_FAILED); assert.equal(failure.cause, primary); restore();
  }
  for (const secondary of [undefined, null, false, 0, '', Object.freeze(new Error('diagnostic getter failure'))]) {
    let inspected = 0;
    const primary = Object.create(null);
    Object.defineProperty(primary, 'message', { get() { inspected += 1; throw secondary; } });
    fs.openSync = (name, ...args) => { if (name === target) throw primary; return open(name, ...args); };
    const failure = rejected(() => loadWorkspaceConfig(target));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.ok(inspected >= 1); restore();
  }
  {
    let ready = true, messages = 0;
    const primary = {
      cacheOwnershipReleased() { assert.equal(this, primary); return ready; },
      get message() { messages += 1; ready = false; this.cacheOwnershipReleased = () => true; return 'diagnostic mutates original work'; }
    };
    fs.openSync = (name, ...args) => { if (name === target) throw primary; return open(name, ...args); };
    const failure = rejected(() => loadWorkspaceConfig(target));
    assert.equal(failure.code === WORKSPACE_ERROR_CODES.PARSE_FAILED, false);
    assert.equal(failure.cacheOwnershipReleased(), false); assert.ok(messages >= 1);
    ready = true; assert.equal(failure.cacheOwnershipReleased(), true); restore();
  }
  await fsp.writeFile(target, '{broken');
  const invalid = rejected(() => loadWorkspaceConfig(target));
  assert.equal(invalid.code, WORKSPACE_ERROR_CODES.PARSE_FAILED); assert.match(invalid.cause.message, /Failed to parse/);
  assert.equal(getContainedFileSession(invalid), null);
  assert.equal(rejected(() => loadWorkspaceConfig(path.join(root, 'missing.jsonc'))).code, WORKSPACE_ERROR_CODES.FILE_NOT_FOUND);
} finally { restore(); dispose(); await rmDirRecursive(root); }
