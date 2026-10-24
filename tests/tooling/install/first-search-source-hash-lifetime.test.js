import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFirstSearchPlan } from '../../../tools/setup/first-search-plan.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-first-search-source-hash-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
const repoRoot = path.join(root, 'project');
const packagePath = path.join(process.cwd(), 'package.json');
const lockPath = path.join(process.cwd(), 'package-lock.json');
const open = fs.open;
let activeHandle = null, ready = false, closes = 0, followingSourceReads = 0, failure;
const samePath = (left, right) => typeof left === 'string' && (process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right));
try {
  await fs.mkdir(repoRoot);
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), '{}');
  const original = Object.freeze(Object.assign(new Error('approval source hash retains its original read'), {
    cacheOwnershipReleased() { assert.equal(this, original); return ready; }
  }));
  fs.open = async (file, ...args) => {
    if (samePath(file, lockPath)) followingSourceReads += 1;
    const handle = await open(file, ...args);
    if (!samePath(file, packagePath)) return handle;
    activeHandle = handle;
    return { fd: handle.fd, stat: handle.stat.bind(handle), read: async () => { throw original; },
      close: async () => { closes += 1; const result = await handle.close(); activeHandle = null; return result; } };
  };
  await assert.rejects(createFirstSearchPlan({ repoRoot }), error => { failure = error; return error.cacheOwnershipPending === true; });
  assert.equal(followingSourceReads, 0, 'an unsettled approved-source read admits no later source borrower');
  assert.equal(closes, 0);
  assert.equal(failure.cacheOwnershipReleased(), false);
  const session = getContainedFileSession(failure);
  assert.ok(session, 'the exact source descriptor owner is reachable from first-search planning');
  ready = true;
  await session.releaseAfterClose();
  assert.equal(closes, 1);
  assert.equal(failure.cacheOwnershipReleased(), true);
} finally {
  fs.open = open;
  if (activeHandle) await activeHandle.close(); // Fixture disposal grants no owner settlement proof.
  await fs.rm(root, { recursive: true, force: true });
}
console.log('First-search approval hashes retain their original descriptor owner and stop further admission.');
