import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import tar from 'tar-stream';
import { gzipSync } from 'node:zlib';
import { extractArchive } from '../../../tools/shared/archive-extraction.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('archive-destination-ownership');
const payload = Buffer.from('owned archive bytes');
const zip = new AdmZip();
zip.addFile('nested/payload.txt', payload);
const pack = tar.pack();
pack.entry({ name: 'nested/payload.txt' }, payload);
pack.finalize();
const chunks = [];
for await (const chunk of pack) chunks.push(chunk);
const tarBytes = Buffer.concat(chunks);
try {
  for (const [type, bytes] of [['zip', zip.toBuffer()], ['tar', tarBytes], ['tar.gz', gzipSync(tarBytes)]]) {
    const archive = path.join(dir, `valid.${type}`);
    const malformed = path.join(dir, `malformed.${type}`);
    await fs.writeFile(archive, bytes);
    await fs.writeFile(malformed, 'invalid archive');
    const existing = path.join(dir, `existing-${type}`);
    await fs.mkdir(path.join(existing, 'nested'), { recursive: true });
    const marker = path.join(existing, 'nested/payload.txt');
    await fs.writeFile(marker, 'preserved caller bytes');
    for (const input of [archive, malformed]) {
      await assert.rejects(extractArchive(input, existing, type), error => error.code === 'ARCHIVE_UNSAFE');
      assert.equal(await fs.readFile(marker, 'utf8'), 'preserved caller bytes');
    }
    const empty = path.join(dir, `existing-empty-${type}`);
    await fs.mkdir(empty);
    await assert.rejects(extractArchive(archive, empty, type), error => error.code === 'ARCHIVE_UNSAFE');
    assert.deepEqual(await fs.readdir(empty), []);

    const fresh = path.join(dir, `fresh-${type}`);
    assert.equal(await extractArchive(archive, fresh, type), true);
    assert.deepEqual(await fs.readFile(path.join(fresh, 'nested/payload.txt')), payload);
    const failed = path.join(dir, `failed-${type}`);
    await assert.rejects(extractArchive(malformed, failed, type));
    await assert.rejects(fs.stat(failed), { code: 'ENOENT' });
    const limited = path.join(dir, `limited-${type}`);
    await assert.rejects(extractArchive(archive, limited, type, { maxEntryBytes: 1 }),
      error => error.code === 'ARCHIVE_TOO_LARGE');
    await assert.rejects(fs.stat(limited), { code: 'ENOENT' });
  }

  // Model replacement/link metadata at the OS boundary without creating links.
  // A cleanup failure must preserve the extraction failure and recovery bytes.
  const destination = path.join(dir, 'changed-before-cleanup');
  const originalLstat = fs.lstat;
  let seen = 0;
  fs.lstat = async (target, options) => {
    const stat = await originalLstat(target, options);
    if (path.resolve(target) !== destination || ++seen !== 2) return stat;
    await fs.writeFile(path.join(destination, 'replacement-marker'), 'preserved replacement bytes');
    return { ...stat, isDirectory: () => true, isSymbolicLink: () => true };
  };
  try {
    await assert.rejects(extractArchive(path.join(dir, 'malformed.zip'), destination, 'zip'), error => {
      assert.equal(error.cleanupError?.code, 'ARCHIVE_UNSAFE');
      assert.equal(error.recoveryPath, destination);
      return /zip|central directory/i.test(error.message);
    });
    assert.equal(await fs.readFile(path.join(destination, 'replacement-marker'), 'utf8'), 'preserved replacement bytes');
  } finally {
    fs.lstat = originalLstat;
  }
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('archive destinations are exclusively owned; existing bytes survive valid and invalid inputs');
