import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { observePublicationIntegrity } from '../../../src/index/build/publication-integrity.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('publication-member-classification-owner');
const file = path.join(dir, 'payload.bin'), manifestPath = path.join(dir, 'manifest.json');
const bytes = Buffer.from('original publication member\n');
await fs.writeFile(file, bytes);
await fs.writeFile(manifestPath, JSON.stringify({ pieces: [{ path: 'payload.bin', name: 'payload',
  bytes: bytes.length, checksum: 'sha256:' + createHash('sha256').update(bytes).digest('hex') }] }));
const open = fs.open, lstat = fs.lstat, lstatSync = fsSync.lstatSync;
try {
  for (const code of ['EISDIR', 'ERR_UNSAFE_FILE_PATH']) {
    const primary = Object.freeze(Object.assign(new Error('original regular-file read failed'), { code }));
    const secondary = Object.freeze(new Error('original descriptor close remains pending'));
    let refused = false, allowClose = false, reads = 0, closes = 0, laterPathProbes = 0, failure;
    fs.lstat = (...args) => {
      if (refused && path.resolve(args[0]) === file) laterPathProbes++;
      return lstat(...args);
    };
    fsSync.lstatSync = (...args) => {
      if (refused && path.resolve(args[0]) === file) laterPathProbes++;
      return lstatSync(...args);
    };
    fs.open = async (...args) => {
      const handle = await open(...args);
      if (path.resolve(args[0]) !== file) return handle;
      const close = handle.close.bind(handle);
      handle.read = async () => { reads++; refused = true; throw primary; };
      handle.close = async () => { closes++; if (!allowClose) throw secondary; await close(); };
      return handle;
    };
    try {
      await assert.rejects(observePublicationIntegrity({ outDir: dir, manifestPath }), error => {
        failure = error;
        return errorGraphIncludes(error, primary) && errorGraphIncludes(error, secondary)
          && error.cacheOwnershipReleased() === false;
      });
      assert.equal(reads, 1); assert.equal(closes, 1);
      assert.equal(laterPathProbes, 0, 'unsettled read failure cannot start path or directory classification');
      const original = getContainedFileSession(failure); assert.ok(original);
      allowClose = true; await original.releaseAfterClose();
      assert.equal(failure.cacheOwnershipReleased(), true);
      assert.equal(reads, 1, 'close-only recovery never replays the failed publication read');
      assert.equal(closes, 2);
    } finally {
      allowClose = true;
      await getContainedFileSession(failure)?.releaseAfterClose();
      fs.open = open; fs.lstat = lstat; fsSync.lstatSync = lstatSync;
    }
    assert.ok((await observePublicationIntegrity({ outDir: dir, manifestPath })).contentHash,
      'only a new verified invocation can produce a successful binding');
  }
  const primary = Object.freeze(Object.assign(new Error('settled regular-file EISDIR read failure'), { code: 'EISDIR' }));
  fs.open = async (...args) => {
    const handle = await open(...args);
    if (path.resolve(args[0]) === file) handle.read = async () => { throw primary; };
    return handle;
  };
  await assert.rejects(observePublicationIntegrity({ outDir: dir, manifestPath }), error => error === primary,
    'a settled file read failure is not a directory or an invented integrity diagnostic');
} finally {
  fs.open = open; fs.lstat = lstat; fsSync.lstatSync = lstatSync;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Publication member dispatch preserves original refusal, close-only recovery and fresh binding authority.');
