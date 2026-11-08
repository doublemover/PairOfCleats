import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { sha1File, sha256File, checksumFile, setXxhashBackend } from '../../../src/shared/hash.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('file-hash-close-lifetime');
const file = path.join(dir, 'input');
await fsp.writeFile(file, 'hash bytes');
const open = fsp.open;
let activeHandles = 0, observedOpens = 0;
fsp.open = async (...args) => {
  const handle = await open(...args), close = handle.close;
  activeHandles += 1; observedOpens += 1;
  handle.close = async function () {
    assert.equal(this, handle);
    await new Promise(resolve => setTimeout(resolve, 20));
    const result = await close.call(handle); activeHandles -= 1; return result;
  };
  return handle;
};
const createHash = crypto.createHash;
try {
  for (const compute of [sha1File, sha256File, checksumFile]) {
    await compute(file);
    assert.equal(activeHandles, 0, 'digest completion must include actual descriptor close');
    await assert.rejects(compute(path.join(dir, 'missing')), { code: 'ENOENT' });
    assert.equal(activeHandles, 0);
  }
  setXxhashBackend('wasm');
  await checksumFile(file);
  assert.equal(activeHandles, 0);
  for (const compute of [sha1File, sha256File]) {
    for (const phase of ['create', 'update', 'digest']) {
      const fault = new Error(`hash ${phase} fault`);
      crypto.createHash = algorithm => {
        if (phase === 'create') throw fault;
        const hash = createHash(algorithm);
        hash[phase] = () => { throw fault; };
        return hash;
      };
      await assert.rejects(compute(file), error => error === fault);
      assert.equal(activeHandles, 0, `${phase} rejection must await actual descriptor close`);
      crypto.createHash = createHash;
    }
  }
} finally {
  crypto.createHash = createHash;
  fsp.open = open;
  setXxhashBackend(null);
}
assert.ok(observedOpens >= 10, 'the real descriptor boundary must be observed for every completed/failing hash');
console.log('SHA1, SHA256 and xxhash settle after actual closure, including read and digest failures.');
