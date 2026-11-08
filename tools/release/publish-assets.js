import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { collectSortedFiles, requireRepoContainedOutputPath, toPosixRelative } from './file-walk.js';

const MAP_NAME = 'release-asset-map.json';
const hashFile = filename => {
  const fd = fs.openSync(filename, 'r'), hash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
};

// GitHub uses a local basename as the asset name; #suffix is only a label.
// Hash the complete relative identity, retain a readable suffix/extension, and
// reject any final namespace collision before staging or external mutation.
export const validateReleaseAssetNames = entries => {
  const names = new Set([MAP_NAME]);
  for (const entry of entries) {
    const name = entry.assetName;
    if (typeof name !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(name) || name.length > 200
      || name === '.' || name === '..' || names.has(name.toLowerCase())) {
      throw new Error(`Duplicate or unsafe release asset name: ${name}`);
    }
    names.add(name.toLowerCase());
  }
};

export const createReleaseAssetPlan = (releaseRoot, roots = ['downloads', 'bundle', 'trust']) => {
  const root = path.resolve(releaseRoot);
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Release root must not be a symlink.');
  const entries = roots.flatMap(relative => {
    const directory = requireRepoContainedOutputPath(root, relative, 'release asset input');
    if (!fs.statSync(directory).isDirectory()) throw new Error(`Missing release asset directory: ${relative}`);
    return collectSortedFiles(directory).map(filename => {
      if (!fs.lstatSync(filename).isFile()) throw new Error(`Release asset must be a regular file: ${filename}`);
      const originalPath = toPosixRelative(root, filename);
      const identity = createHash('sha256').update(originalPath).digest('hex');
      const suffix = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
      return { originalPath, assetName: `${identity}-${suffix}`, bytes: fs.statSync(filename).size, sha256: hashFile(filename) };
    });
  }).sort((left, right) => left.originalPath < right.originalPath ? -1 : left.originalPath > right.originalPath ? 1 : 0);
  if (!entries.length) throw new Error('No release assets to publish.');
  validateReleaseAssetNames(entries);
  return { version: 1, entries };
};

export const stageReleaseAssets = releaseRoot => {
  const root = path.resolve(releaseRoot), plan = createReleaseAssetPlan(root);
  const directory = fs.mkdtempSync(path.join(root, 'publish-staging-'));
  const uploadPaths = [];
  // Staging is private and fresh on every invocation. A failed stage is never
  // returned as an upload plan and cannot replace a prior release asset.
  for (const entry of plan.entries) {
    const source = requireRepoContainedOutputPath(root, entry.originalPath, 'release asset');
    const destination = path.join(directory, entry.assetName);
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    if (fs.statSync(destination).size !== entry.bytes || hashFile(destination) !== entry.sha256) {
      throw new Error(`Release asset changed during staging: ${entry.originalPath}`);
    }
    uploadPaths.push(destination);
  }
  const mappingPath = path.join(directory, MAP_NAME);
  fs.writeFileSync(mappingPath, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
  uploadPaths.push(mappingPath);
  return { mappingPath, uploadPaths };
};
