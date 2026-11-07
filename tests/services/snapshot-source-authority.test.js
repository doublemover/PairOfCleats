import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { copySnapshotModeArtifacts, copySnapshotDirectory } from '../../src/index/snapshots/copy-pieces.js';
import { createPointerSnapshot } from '../../src/index/snapshots/create.js';
import { freezeSnapshot } from '../../src/index/snapshots/freeze.js';
import { loadSnapshotsManifest } from '../../src/index/snapshots/registry.js';
import { getRepoCacheRoot } from '../../src/shared/dict-utils.js';
import { seedCodeSnapshotBuildRoot, setCurrentCodeSnapshotBuild } from '../helpers/snapshot-build-fixture.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('snapshot-source-authority');
const sourceIndexDir = path.join(dir, 'source');
await fs.mkdir(path.join(sourceIndexDir, 'pieces'), { recursive: true });
await fs.mkdir(path.join(sourceIndexDir, 'directory/nested'), { recursive: true });
await fs.writeFile(path.join(sourceIndexDir, 'directory/nested/sentinel'), 'ordinary source bytes');
await fs.writeFile(path.join(sourceIndexDir, 'payload.json'), '{"value":"aa"}');
await fs.writeFile(path.join(sourceIndexDir, 'index_state.json'), '{}');
let flagged = null, forbiddenEffects = 0;
const lstat = fs.lstat, copyFile = fs.copyFile;
const createReadStream = fsSync.createReadStream, readFileSync = fsSync.readFileSync;
const identity = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const blocked = value => flagged && (identity(value) === identity(flagged) || identity(value).startsWith(identity(flagged) + path.sep));
// Inject the OS metadata result, not a real link. Ordinary-file controls still
// exercise the actual filesystem and the complete copy/freeze owners.
fs.lstat = async (file, options) => {
  const stat = await lstat(file, options);
  return flagged && identity(flagged) === identity(file) ? { ...stat, isSymbolicLink: () => true } : stat;
};
fs.copyFile = async (from, ...args) => { if (blocked(from)) forbiddenEffects += 1; return copyFile(from, ...args); };
fsSync.createReadStream = (file, ...args) => { if (blocked(file)) forbiddenEffects += 1; return createReadStream(file, ...args); };
fsSync.readFileSync = (file, ...args) => { if (blocked(file)) forbiddenEffects += 1; return readFileSync(file, ...args); };
try {
  const cases = [
    ['', 'directory', 'dir'], ['pieces', 'directory', 'dir'], ['directory', 'directory', 'dir'],
    ['directory/nested', 'directory', 'dir'], ['payload.json', 'payload.json', 'json']
  ];
  for (const [index, [relative, piecePath, format]] of cases.entries()) {
    const manifest = { version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [
      { type: 'embeddings', name: 'payload', format, path: piecePath, bytes: null, checksum: null }
    ] };
    await fs.writeFile(path.join(sourceIndexDir, 'pieces/manifest.json'), JSON.stringify(manifest));
    const positive = await copySnapshotModeArtifacts({ sourceIndexDir, targetIndexDir: path.join(dir, `ordinary-${index}`) });
    assert.ok(positive.filesChecked > 0);
    flagged = path.resolve(sourceIndexDir, relative);
    forbiddenEffects = 0;
    await assert.rejects(copySnapshotModeArtifacts({ sourceIndexDir, targetIndexDir: path.join(dir, `refused-${index}`) }), /Linked/);
    assert.equal(forbiddenEffects, 0, 'a reported link must be rejected before content reads or copies');
    flagged = null;
  }
  flagged = path.join(sourceIndexDir, 'directory');
  forbiddenEffects = 0;
  await assert.rejects(copySnapshotDirectory({ sourceDir: sourceIndexDir, targetDir: path.join(dir, 'optional') }), /Linked/);
  assert.equal(forbiddenEffects, 0);
  flagged = null;

  const repoRoot = path.join(dir, 'repo');
  const userConfig = { cache: { root: path.join(dir, 'cache') }, sqlite: { use: false } };
  await fs.mkdir(repoRoot);
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const { indexDir } = await seedCodeSnapshotBuildRoot({ repoCacheRoot, buildId: 'build-authority' });
  await setCurrentCodeSnapshotBuild({ repoCacheRoot, buildId: 'build-authority' });
  await fs.mkdir(path.join(indexDir, 'directory'));
  await fs.writeFile(path.join(indexDir, 'directory/sentinel'), 'retained source bytes');
  await fs.writeFile(path.join(indexDir, 'pieces/manifest.json'), JSON.stringify({ version: 2,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [
      { type: 'embeddings', name: 'directory', format: 'dir', path: 'directory', bytes: null, checksum: null }
    ] }));
  await createPointerSnapshot({ repoRoot, userConfig, modes: ['code'], snapshotId: 'snap-refused-source' });
  const before = loadSnapshotsManifest(repoCacheRoot);
  flagged = path.join(indexDir, 'directory');
  forbiddenEffects = 0;
  await assert.rejects(freezeSnapshot({ repoRoot, userConfig, snapshotId: 'snap-refused-source' }), /Linked/);
  assert.equal(forbiddenEffects, 0);
  flagged = null;
  assert.deepEqual(loadSnapshotsManifest(repoCacheRoot), before);
  const snapshotDir = path.join(repoCacheRoot, 'snapshots/snap-refused-source');
  await assert.rejects(fs.stat(path.join(snapshotDir, 'frozen')), { code: 'ENOENT' });
  assert.ok(!(await fs.readdir(snapshotDir)).some(name => name.startsWith('frozen.staging-')));
  assert.equal(await fs.readFile(path.join(indexDir, 'directory/sentinel'), 'utf8'), 'retained source bytes');
} finally {
  fs.lstat = lstat; fs.copyFile = copyFile;
  fsSync.createReadStream = createReadStream; fsSync.readFileSync = readFileSync;
}
console.log('Ordinary-filesystem controls and injected link metadata protect copy/freeze without creating symlinks.');
