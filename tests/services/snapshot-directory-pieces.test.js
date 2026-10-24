import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { copySnapshotModeArtifacts } from '../../src/index/snapshots/copy-pieces.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('snapshot-directory-pieces');
const sourceIndexDir = path.join(dir, 'source');
const directory = '.embeddings-backends/active/dense_vectors.lancedb';
const contents = new Map([
  [`${directory}/data/first.lance`, Buffer.from([0, 1, 2, 255])],
  [`${directory}/_versions/1.manifest`, Buffer.from('immutable version')],
  [`${directory}/.hidden`, Buffer.from('hidden data')],
  ['dense_vectors.lancedb.meta.json', Buffer.from('{"dims":384}')]
]);
for (const [relative, bytes] of contents) {
  await fs.mkdir(path.dirname(path.join(sourceIndexDir, relative)), { recursive: true });
  await fs.writeFile(path.join(sourceIndexDir, relative), bytes);
}
await fs.mkdir(path.join(sourceIndexDir, directory, '_transactions'), { recursive: true });
await fs.mkdir(path.join(sourceIndexDir, 'empty.lancedb'));
await fs.mkdir(path.join(sourceIndexDir, 'pieces'));
await fs.writeFile(path.join(sourceIndexDir, 'index_state.json'), '{}');
const metaBytes = contents.get('dense_vectors.lancedb.meta.json');
const manifest = { version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [
  { type: 'embeddings', name: 'dense_vectors_lancedb', format: 'dir', path: directory, bytes: null, checksum: null },
  { type: 'embeddings', name: 'empty_lancedb', format: 'dir', path: 'empty.lancedb', bytes: null, checksum: null },
  { type: 'embeddings', name: 'dense_vectors_lancedb_meta', format: 'json', path: 'dense_vectors.lancedb.meta.json',
    bytes: metaBytes.length, checksum: `sha1:${createHash('sha1').update(metaBytes).digest('hex')}` }
] };
await fs.writeFile(path.join(sourceIndexDir, 'pieces/manifest.json'), JSON.stringify(manifest));
for (const method of ['copy', 'hardlink']) {
  const targetIndexDir = path.join(dir, method);
  const copied = await copySnapshotModeArtifacts({ sourceIndexDir, targetIndexDir, method, verify: true });
  for (const [relative, bytes] of contents) assert.deepEqual(await fs.readFile(path.join(targetIndexDir, relative)), bytes);
  for (const relative of [directory, `${directory}/_transactions`, 'empty.lancedb']) {
    assert.equal((await fs.stat(path.join(targetIndexDir, relative))).isDirectory(), true);
  }
  assert.equal(copied.filesCopied, contents.size + 2, 'only physical files count as copied files');
  assert.equal(copied.filesChecked, contents.size, 'all directory descendants and the manifest file piece are verified');
  assert.equal(copied.bytesChecked, [...contents.values()].reduce((sum, bytes) => sum + bytes.length, 0));
}
const copyFile = fs.copyFile;
try {
  fs.copyFile = async (from, to, ...rest) => {
    await copyFile(from, to, ...rest);
    if (to.endsWith('first.lance')) await fs.writeFile(to, Buffer.from([4, 3, 2, 1]));
  };
  await assert.rejects(copySnapshotModeArtifacts({ sourceIndexDir, targetIndexDir: path.join(dir, 'corrupted'), method: 'copy', verify: true }),
    /Checksum mismatch.*first\.lance/, 'same-size corruption inside a directory piece must fail verification');
} finally { fs.copyFile = copyFile; }
const invalid = structuredClone(manifest);
invalid.pieces[0].path = 'dense_vectors.lancedb.meta.json';
await fs.writeFile(path.join(sourceIndexDir, 'pieces/manifest.json'), JSON.stringify(invalid));
await assert.rejects(copySnapshotModeArtifacts({ sourceIndexDir, targetIndexDir: path.join(dir, 'wrong-kind'), method: 'copy', verify: true }),
  /directory piece/i, 'a directory manifest entry cannot resolve to a regular file');
console.log('Verified copy and hardlink snapshots preserve directory pieces, empty directories and exact descendant bytes.');
