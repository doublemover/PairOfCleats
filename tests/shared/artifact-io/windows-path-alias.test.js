import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { assertArtifactFilePath } from '../../../src/shared/artifact-io/contained-path.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('artifact-windows-path-alias');
const root = path.join(dir, 'index'), target = path.join(root, 'pieces', 'manifest.json');
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.writeFile(target, 'original artifact');
assert.equal(await fs.readFile(assertArtifactFilePath(root, target), 'utf8'), 'original artifact');
if (process.platform === 'win32') {
  for (const [selectedRoot, selectedTarget] of [[root, path.toNamespacedPath(target)], [path.toNamespacedPath(root), target]]) {
    const admitted = assertArtifactFilePath(selectedRoot, selectedTarget);
    assert.equal(await fs.readFile(admitted, 'utf8'), 'original artifact');
    assert.equal(path.relative(selectedRoot, admitted), path.join('pieces', 'manifest.json'), 'producer labels retain their selected root spelling');
  }
  const foreign = path.join(dir, 'outside.json'); await fs.writeFile(foreign, 'foreign artifact');
  assert.throws(() => assertArtifactFilePath(root, path.toNamespacedPath(foreign)), { code: 'ERR_ARTIFACT_PATH' });
  assert.throws(() => assertArtifactFilePath(root, path.toNamespacedPath(path.join(dir, 'foreign-missing.json'))), { code: 'ERR_ARTIFACT_PATH' });
  assert.throws(() => assertArtifactFilePath(root, path.toNamespacedPath(path.join(root, 'missing.json'))), { code: 'ENOENT' });
  const admittedMissing = assertArtifactFilePath(root, path.toNamespacedPath(path.join(root, 'pieces', 'missing.json')), { allowMissing: true });
  assert.equal(path.basename(admittedMissing), 'missing.json');
  await assert.rejects(fs.stat(admittedMissing), { code: 'ENOENT' });
  const originalStat = fsSync.lstatSync;
  try {
    fsSync.lstatSync = (file, ...args) => {
      const stat = originalStat(file, ...args);
      if (path.resolve(file) === path.toNamespacedPath(path.dirname(target))) stat.isSymbolicLink = () => true;
      return stat;
    };
    assert.throws(() => assertArtifactFilePath(root, path.toNamespacedPath(target)), { code: 'ERR_ARTIFACT_PATH' },
      'an original reparse component cannot be hidden by canonicalization');
  } finally { fsSync.lstatSync = originalStat; }
}
assert.throws(() => assertArtifactFilePath(root, path.join(dir, 'outside.json')), { code: 'ERR_ARTIFACT_PATH' });
console.log('Artifact reads admit verified Windows namespace aliases and retain physical containment and missing-file failures.');
