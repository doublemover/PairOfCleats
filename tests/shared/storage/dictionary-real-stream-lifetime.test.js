import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { loadDictionaryWordSetFromFiles } from '../../../src/shared/dictionary-wordlists.js';
import { registerDictionaryStorageRoot, dictionaryStorageCoordinationRoot } from '../../../src/shared/storage/dictionary-access.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';

const temporary = await makeTempDir('poc-dictionary-stream-owner-');
const originalCreate = fsSync.createReadStream;
let allowClose;
let loading;
try {
  const home = path.join(temporary, 'home');
  const root = path.join(home, 'dictionaries');
  const file = path.join(root, 'en.txt');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(file, 'alpha\nbeta\n');
  applyTestEnv({ cacheRoot: home, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_DICT_DIR: root } });
  registerDictionaryStorageRoot(root);
  const coordinationRoot = dictionaryStorageCoordinationRoot();
  const gate = new Promise(resolve => { allowClose = resolve; });
  let opened;
  const open = new Promise(resolve => { opened = resolve; });
  fsSync.createReadStream = (...args) => {
    const stream = originalCreate(...args);
    const destroy = stream.destroy.bind(stream);
    stream.destroy = error => { gate.then(() => destroy(error)); return stream; };
    stream.once('open', () => opened());
    return stream;
  };
  loading = loadDictionaryWordSetFromFiles([file]);
  await open;
  assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, true);
  assert.equal((await withExclusiveRepoCacheCleanup(root, () => assert.fail('open native file cannot yield ownership'), { coordinationRoot })).protected, true);
  let fulfilled = false;
  loading.then(() => { fulfilled = true; });
  await Promise.resolve();
  assert.equal(fulfilled, false, 'readline completion cannot release before actual stream close');
  allowClose();
  assert.deepEqual([...(await loading)].sort(), ['alpha', 'beta']);
  assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, false);
  fsSync.createReadStream = originalCreate;
  const excluded = await withExclusiveRepoCacheCleanup(root, async () => {
    await assert.rejects(loadDictionaryWordSetFromFiles([file]), { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' });
  }, { coordinationRoot });
  assert.equal(excluded.protected, false, 'normal read failures must not turn exclusion into an empty successful dictionary');
} finally {
  fsSync.createReadStream = originalCreate;
  allowClose?.();
  if (loading) await loading.catch(() => {});
  await rmDirRecursive(temporary);
}
console.log('dictionary real stream lifetime passed');
