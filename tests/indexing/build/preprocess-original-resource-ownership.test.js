#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { observePreprocessSource } from '../../../src/index/build/preprocess-snapshot.js';
import { writePreprocessStats } from '../../../src/index/build/preprocess.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-preprocess-owner-'));
const originalOpen = fs.open, originalMkdir = fs.mkdir;
let session = null, allowClose = false;
try {
  const source = path.join(directory, 'tiny.js');
  await fs.writeFile(source, 'export const value = 1;\n');
  let closeCalls = 0;
  fs.open = async function (filename, ...args) {
    const handle = await originalOpen.call(this, filename, ...args);
    if (path.relative(path.resolve(String(filename)), source) === '') {
      const originalClose = handle.close.bind(handle);
      handle.close = async () => {
        closeCalls++;
        if (!allowClose) throw new Error('injected original source descriptor close rejection');
        return originalClose();
      };
    }
    return handle;
  };
  let failure;
  await assert.rejects(observePreprocessSource({ root: directory, entry: { rel: 'tiny.js', abs: source, ext: '.js' },
    expectedHash: '0'.repeat(64) }), error => {
    failure = error;
    session = getContainedFileSession(error);
    return error.cacheOwnershipPending === true && Boolean(session);
  });
  assert.equal(closeCalls, 1);
  assert.equal(failure.cacheOwnershipReleased(), false);
  allowClose = true;
  await session.releaseAfterClose();
  assert.equal(closeCalls, 2);
  assert.equal(failure.cacheOwnershipReleased(), true);
  session = null;
  fs.open = originalOpen;

  let childSettled = false;
  const childFailure = Object.assign(new Error('statistics publication child remains pending'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => childSettled
  });
  fs.mkdir = async () => { throw childFailure; };
  await assert.rejects(writePreprocessStats(path.join(directory, 'cache'), { count: 1 }),
    error => error.cacheOwnershipPending === true, 'best-effort statistics cannot erase unconfirmed publication ownership');
  childSettled = true;
} finally {
  fs.open = originalOpen; fs.mkdir = originalMkdir;
  allowClose = true;
  if (session) await session.releaseAfterClose();
  await fs.rm(directory, { recursive: true, force: true });
}
console.log('preprocessing preserves original descriptor and best-effort publication ownership');
