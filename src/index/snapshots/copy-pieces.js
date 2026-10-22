import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { loadPiecesManifest } from '../../shared/artifact-io/manifest.js';
import { isManifestPathSafe } from '../validate/paths.js';
import { fromPosix, toPosix } from '../../shared/file-paths.js';
import { checksumFile, sha1File } from '../../shared/hash.js';

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const normalizeRelPath = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty path string.`);
  }
  const rel = toPosix(value.trim());
  if (!isManifestPathSafe(rel)) {
    throw new Error(`${label} must be traversal-safe and relative.`);
  }
  return rel;
};

const ensureParentDir = async (filePath) => {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
};

export const assertSnapshotSourcePath = async (sourceRoot, sourcePath) => {
  const root = path.resolve(sourceRoot);
  const relative = path.relative(root, path.resolve(sourcePath));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Snapshot source escapes its root: ${sourcePath}`);
  }
  let cursor = root;
  let stat = await fsPromises.lstat(cursor, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Linked or invalid snapshot source root: ${root}`);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    stat = await fsPromises.lstat(cursor, { bigint: true });
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error(`Linked or unsupported snapshot source: ${cursor}`);
    }
  }
  return stat;
};

export const copySnapshotFile = async ({ sourceRoot, sourcePath: srcPath, targetPath: destPath, verify = true }) => {
  const before = await assertSnapshotSourcePath(sourceRoot, srcPath);
  if (!before.isFile()) throw new Error(`Expected regular snapshot source: ${srcPath}`);
  const sourceDigest = verify ? await sha1File(srcPath) : null;
  await ensureParentDir(destPath);
  // A hardlink shares mutable bytes. Legacy hardlink requests use an independent
  // copy (or filesystem copy-on-write clone) so frozen artifacts stay immutable.
  await fsPromises.copyFile(srcPath, destPath, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
  const after = await assertSnapshotSourcePath(sourceRoot, srcPath);
  if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(field => before[field] !== after[field])) {
    throw new Error(`Snapshot source changed while copying: ${srcPath}`);
  }
  return { method: 'copy', bytes: Number(before.size), sourceDigest };
};

const copyEntryPath = async ({ sourceIndexDir, targetIndexDir, relPath, verify, files, directories }) => {
  if (files.has(relPath) || directories.has(relPath)) return;
  const sourcePath = path.join(sourceIndexDir, fromPosix(relPath));
  const targetPath = path.join(targetIndexDir, fromPosix(relPath));
  const stat = await assertSnapshotSourcePath(sourceIndexDir, sourcePath);
  if (stat.isDirectory()) {
    await fsPromises.mkdir(targetPath, { recursive: true });
    directories.set(relPath, { sourcePath, targetPath });
    const entries = await fsPromises.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      const nestedRel = toPosix(path.posix.join(relPath, entry.name));
      await copyEntryPath({ sourceIndexDir, targetIndexDir, relPath: nestedRel, verify, files, directories });
    }
    return;
  }
  const copied = await copySnapshotFile({ sourceRoot: sourceIndexDir, sourcePath, targetPath, verify });
  files.set(relPath, {
    relPath,
    sourcePath,
    targetPath,
    ...copied
  });
};

export const copySnapshotDirectory = async ({ sourceDir, targetDir, verify = true }) => {
  const files = new Map(), directories = new Map();
  await copyEntryPath({ sourceIndexDir: sourceDir, targetIndexDir: targetDir, relPath: '', verify, files, directories });
  const copied = [...files.values()];
  if (verify) {
    for (const entry of copied) {
      if (await sha1File(entry.targetPath) !== entry.sourceDigest) {
        throw new Error(`Checksum mismatch for snapshot file ${entry.relPath}`);
      }
    }
  }
  return copied;
};

const parseChecksum = (value) => {
  if (typeof value !== 'string' || !value.includes(':')) return null;
  const split = value.indexOf(':');
  const algo = value.slice(0, split).trim().toLowerCase();
  const digest = value.slice(split + 1).trim().toLowerCase();
  if (!algo || !digest) return null;
  return { algo, digest };
};

const verifyPieceChecksum = async ({ targetPath, piece, sourceDigest }) => {
  const parsed = parseChecksum(piece?.checksum);
  if (piece?.checksum == null) {
    const digest = await sha1File(targetPath);
    if (!sourceDigest || digest !== sourceDigest) throw new Error(`Checksum mismatch for ${piece.path}`);
    return { algo: 'sha1', digest };
  }
  if (!parsed || !['sha1', 'xxh64'].includes(parsed.algo)
    || !(parsed.algo === 'sha1' ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{16}$/).test(parsed.digest)) {
    throw new Error(`Invalid or unsupported checksum for ${piece.path}: ${piece.checksum}`);
  }
  if (parsed.algo === 'sha1') {
    const actual = (await sha1File(targetPath)).toLowerCase();
    if (actual !== parsed.digest) {
      throw new Error(`Checksum mismatch for ${piece.path}: sha1:${actual} != ${piece.checksum}`);
    }
    return { algo: parsed.algo, digest: actual };
  }
  if (parsed.algo === 'xxh64') {
    const actual = await checksumFile(targetPath);
    const digest = String(actual?.value || '').toLowerCase();
    if (digest !== parsed.digest) {
      throw new Error(`Checksum mismatch for ${piece.path}: xxh64:${digest} != ${piece.checksum}`);
    }
    return { algo: parsed.algo, digest };
  }
  return null;
};

export const copySnapshotModeArtifacts = async ({
  sourceIndexDir,
  targetIndexDir,
  method = 'copy',
  verify = true
} = {}) => {
  if (typeof sourceIndexDir !== 'string' || !sourceIndexDir) {
    throw new Error('sourceIndexDir is required.');
  }
  if (typeof targetIndexDir !== 'string' || !targetIndexDir) {
    throw new Error('targetIndexDir is required.');
  }
  if (!['copy', 'hardlink'].includes(method)) throw new Error(`Invalid snapshot copy method: ${method}`);

  await assertSnapshotSourcePath(sourceIndexDir, path.join(sourceIndexDir, 'pieces', 'manifest.json'));
  const manifest = loadPiecesManifest(sourceIndexDir, { strict: true });
  if (!isObject(manifest)) {
    throw new Error(`Invalid pieces manifest at ${path.join(sourceIndexDir, 'pieces', 'manifest.json')}`);
  }

  const pieceEntries = Array.isArray(manifest.pieces) ? manifest.pieces : [];
  const relPathSet = new Set(['pieces/manifest.json', 'index_state.json']);
  for (const piece of pieceEntries) {
    if (!isObject(piece)) continue;
    const relPath = normalizeRelPath(piece.path, 'piece.path');
    relPathSet.add(relPath);
  }

  const byRelPath = new Map(), directories = new Map();
  for (const relPath of relPathSet) {
    await copyEntryPath({
      sourceIndexDir,
      targetIndexDir,
      relPath,
      verify: verify !== false,
      files: byRelPath,
      directories
    });
  }
  const copiedFiles = [...byRelPath.values()];

  let filesChecked = 0;
  let bytesChecked = 0;
  const checked = new Set();
  const recordChecked = (relPath, bytes) => {
    if (checked.has(relPath)) return;
    checked.add(relPath);
    filesChecked += 1;
    bytesChecked += bytes;
  };
  if (verify !== false) {
    for (const piece of pieceEntries) {
      if (!isObject(piece) || typeof piece.path !== 'string') continue;
      const relPath = normalizeRelPath(piece.path, 'piece.path');
      if (piece.format === 'dir') {
        const directory = directories.get(relPath);
        if (!directory || !(await fsPromises.stat(directory.targetPath)).isDirectory()) {
          throw new Error(`Expected directory piece at destination: ${relPath}`);
        }
        for (const [nestedRel, nested] of directories) {
          if (nestedRel.startsWith(`${relPath}/`) && !(await fsPromises.stat(nested.targetPath)).isDirectory()) {
            throw new Error(`Expected directory piece at destination: ${nestedRel}`);
          }
        }
        // Directory pieces deliberately have null size/checksum in the
        // manifest. Verify every copied physical descendant instead of treating
        // the directory itself as a missing regular-file entry.
        for (const copied of copiedFiles.filter(entry => entry.relPath.startsWith(`${relPath}/`))) {
          const targetStat = await fsPromises.stat(copied.targetPath);
          if (!targetStat.isFile() || targetStat.size !== copied.bytes) {
            throw new Error(`Piece size mismatch for ${copied.relPath}`);
          }
          if (copied.sourceDigest !== await sha1File(copied.targetPath)) {
            throw new Error(`Checksum mismatch for directory piece ${relPath}: ${copied.relPath}`);
          }
          recordChecked(copied.relPath, targetStat.size);
        }
        continue;
      }
      const copied = byRelPath.get(relPath);
      if (!copied) {
        throw new Error(`Copied piece missing from destination: ${relPath}`);
      }
      const targetStat = await fsPromises.stat(copied.targetPath);
      if (Number.isFinite(piece.bytes) && Number(piece.bytes) >= 0 && Number(piece.bytes) !== targetStat.size) {
        throw new Error(`Piece size mismatch for ${relPath}: ${targetStat.size} != ${piece.bytes}`);
      }
      await verifyPieceChecksum({ targetPath: copied.targetPath, piece, sourceDigest: copied.sourceDigest });
      recordChecked(relPath, Number(targetStat.size || 0));
    }
  }

  const filesCopied = copiedFiles.length;
  const bytesCopied = copiedFiles.reduce((sum, entry) => sum + Number(entry.bytes || 0), 0);
  return {
    manifest,
    filesCopied,
    bytesCopied,
    filesChecked,
    bytesChecked,
    copiedFiles
  };
};
