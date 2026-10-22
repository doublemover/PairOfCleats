import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { sha1File, checksumFile, setXxhashBackend } from '../../../src/shared/hash.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { delayFileReadClose } from '../../helpers/delayed-read-close.js';

const { dir } = await prepareIsolatedTestCacheDir('file-hash-close-lifetime');
const file = path.join(dir, 'input');
await fsp.writeFile(file, 'hash bytes');
const observer = delayFileReadClose();
try {
  for (const compute of [sha1File, checksumFile]) {
    await compute(file);
    assert.equal(observer.activeHandles, 0, 'digest completion must include actual descriptor close');
    await assert.rejects(compute(path.join(dir, 'missing')), { code: 'ENOENT' });
    assert.equal(observer.activeHandles, 0);
  }
  setXxhashBackend('wasm');
  await checksumFile(file);
  assert.equal(observer.activeHandles, 0);
} finally {
  observer.restore();
  setXxhashBackend(null);
}
console.log('File hash completion and failure await delayed actual descriptor closure for SHA1 and xxhash.');
