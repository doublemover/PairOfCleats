import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { loadPiecesManifest } from '../../shared/artifact-io.js';
import { isManifestPathSafe } from '../validate/paths.js';
import { fromPosix, toPosix } from '../../shared/files.js';
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

const copyFileWithFallback = async (srcPath, destPath, method) => {
  await ensureParentDir(destPath);
  const preferHardlink = method !== 'copy';
  if (preferHardlink) {
    try {
      await fsPromises.link(srcPath, destPath);
      return { method: 'hardlink' };
    } catch (err) {
      if (!['EXDEV', 'EPERM', 'EACCES', 'EEXIST'].includes(err?.code)) {
        throw err;
      }
    }
  }
  await fsPromises.copyFile(srcPath, destPath);
  return { method: 'copy' };
};

const copyEntryPath = async ({ sourceIndexDir, targetIndexDir, relPath, method }) => {
  const sourcePath = path.join(sourceIndexDir, fromPosix(relPath));
  const targetPath = path.join(targetIndexDir, fromPosix(relPath));
  const stat = await fsPromises.stat(sourcePath);
  if (stat.isDirectory()) {
    const entries = await fsPromises.readdir(sourcePath, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
      const nestedRel = toPosix(path.posix.join(relPath, entry.name));
      const nested = await copyEntryPath({ sourceIndexDir, targetIndexDir, relPath: nestedRel, method });
      results.push(...nested);
    }
    return results;
  }
  const copied = await copyFileWithFallback(sourcePath, targetPath, method);
  return [{
    relPath,
    sourcePath,
    targetPath,
    bytes: stat.size,
    method: copied.method
  }];
};

const parseChecksum = (value) => {
  if (typeof value !== 'string' || !value.includes(':')) return null;
  const split = value.indexOf(':');
  const algo = value.slice(0, split).trim().toLowerCase();
  const digest = value.slice(split + 1).trim().toLowerCase();
  if (!algo || !digest) return null;
  return { algo, digest };
};

const verifyPieceChecksum = async ({ targetPath, piece }) => {
  const parsed = parseChecksum(piece?.checksum);
  if (!parsed) return null;
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
  method = 'hardlink',
  verify = true
} = {}) => {
  if (typeof sourceIndexDir !== 'string' || !sourceIndexDir) {
    throw new Error('sourceIndexDir is required.');
  }
  if (typeof targetIndexDir !== 'string' || !targetIndexDir) {
    throw new Error('targetIndexDir is required.');
  }

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

  const copiedFiles = [];
  for (const relPath of relPathSet) {
    const copied = await copyEntryPath({
      sourceIndexDir,
      targetIndexDir,
      relPath,
      method
    });
    copiedFiles.push(...copied);
  }

  const byRelPath = new Map();
  for (const copied of copiedFiles) {
    byRelPath.set(copied.relPath, copied);
  }

  let filesChecked = 0;
  let bytesChecked = 0;
  if (verify !== false) {
    for (const piece of pieceEntries) {
      if (!isObject(piece) || typeof piece.path !== 'string') continue;
      const relPath = normalizeRelPath(piece.path, 'piece.path');
      const copied = byRelPath.get(relPath);
      if (!copied) {
        throw new Error(`Copied piece missing from destination: ${relPath}`);
      }
      const targetStat = await fsPromises.stat(copied.targetPath);
      if (Number.isFinite(piece.bytes) && Number(piece.bytes) >= 0 && Number(piece.bytes) !== targetStat.size) {
        throw new Error(`Piece size mismatch for ${relPath}: ${targetStat.size} != ${piece.bytes}`);
      }
      await verifyPieceChecksum({ targetPath: copied.targetPath, piece });
      filesChecked += 1;
      bytesChecked += Number(targetStat.size || 0);
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
