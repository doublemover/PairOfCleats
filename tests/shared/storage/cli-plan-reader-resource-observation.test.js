import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runStorageCli } from '../../../tools/storage/cli.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-storage-cli-read-resource-'));
const home = path.join(root, 'home'), repo = path.join(root, 'repo'), file = path.join(root, 'selected-input.json');
const originalLog = console.log, originalExitCode = process.exitCode, open = fs.open;
let disposableHandle = null;
const samePath = (left, right) => typeof left === 'string' && (process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right));
try {
  await fs.mkdir(repo); await fs.writeFile(file, '{}');
  applyTestEnv({ cacheRoot: path.join(home, 'cache'), embeddings: 'off' });
  for (const args of [['configure-apply', '--category', 'models', '--path', path.join(root, 'models'), '--plan', file, '--plan-id', 'a'.repeat(64)],
    ['explain', '--machine-config', file]]) {
    let ready = false, closes = 0, failure;
    const output = [], original = Object.freeze(Object.assign(new Error('actual selected input read remains pending'), {
      cacheOwnershipReleased() { assert.equal(this, original); return ready; }
    }));
    fs.open = async (target, ...options) => {
      const handle = await open(target, ...options);
      if (!samePath(target, file)) return handle;
      disposableHandle = handle;
      return { fd: handle.fd, stat: handle.stat.bind(handle), read: async () => { throw original; },
        close: async () => { closes += 1; const result = await handle.close(); disposableHandle = null; return result; } };
    };
    console.log = value => output.push(value);
    const before = await fs.readdir(root, { recursive: true });
    await assert.rejects(runStorageCli([...args, '--repo', repo, '--home', home, '--json']),
      error => { failure = error; return error.cacheOwnershipPending === true; });
    assert.equal(failure.storageCliContext.mutationStarted, false);
    assert.equal(output.length, 0, 'a process-local caller receives the actual owner, not an ordinary blocked configuration receipt');
    assert.equal(closes, 0);
    assert.equal(failure.cacheOwnershipReleased(), false);
    const session = getContainedFileSession(failure);
    assert.ok(session);
    ready = true; await session.releaseAfterClose();
    assert.equal(closes, 1); assert.equal(failure.cacheOwnershipReleased(), true);
    fs.open = open; console.log = originalLog;
    assert.deepEqual(await fs.readdir(root, { recursive: true }), before, 'pending plan/config reads admit no mutation owner');
  }
} finally {
  fs.open = open; console.log = originalLog; process.exitCode = originalExitCode;
  if (disposableHandle) await disposableHandle.close();
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Storage CLI selected plan and machine-config reads retain their actual descriptor owner.');
