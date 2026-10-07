import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { createError, ERROR_CODES } from '../../src/shared/error-codes.js';
import { isAbsolutePathAny, toPosix } from '../../src/shared/file-paths.js';

const FILE_MODE = 0o644;
const DIR_MODE = 0o755;

function normalizeArchiveEntry(entryName) {
  const name = toPosix(String(entryName || '')).trim();
  if (name.length > 4096 || name.split('/').length > 64) {
    throw createError(ERROR_CODES.ARCHIVE_UNSAFE, 'Archive entry exceeds path length/depth limits.');
  }
  let cleaned = name.replace(/^(\.\/)+/, '');
  cleaned = cleaned.replace(/^\/+/, '');
  // Handle Windows extended-length paths that can appear as //?/C:/...
  cleaned = cleaned.replace(/^\?\//, '');
  // Strip Windows drive-letter prefixes (e.g., C:, C:/, C:\)
  cleaned = cleaned.replace(/^[A-Za-z]:/, '');
  cleaned = cleaned.replace(/^\/+/, '');
  return path.posix.normalize(cleaned);
}

function isArchivePathSafe(rootDir, entryName) {
  const normalized = normalizeArchiveEntry(entryName);
  if (!normalized) return false;
  if (normalized === '.' || normalized === '..') return false;
  if (normalized.startsWith('../') || normalized.includes('/../')) return false;
  if (/^[A-Za-z]:/.test(normalized)) return false;
  if (isAbsolutePathAny(normalized)) return false;
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, normalized);
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (process.platform === 'win32') {
    return resolved.toLowerCase().startsWith(rootPrefix.toLowerCase());
  }
  return resolved.startsWith(rootPrefix);
}

function resolveArchivePath(rootDir, entryName) {
  if (!isArchivePathSafe(rootDir, entryName)) return null;
  const normalized = normalizeArchiveEntry(entryName);
  return path.resolve(rootDir, normalized);
}

function isZipSymlink(entry) {
  const attr = Number(entry?.header?.attr ?? entry?.externalFileAttributes);
  if (!Number.isFinite(attr)) return false;
  const mode = attr >>> 16;
  return (mode & 0o170000) === 0o120000;
}

function isZipDirectory(entry) {
  const name = String(entry?.fileName || '');
  if (name.endsWith('/')) return true;
  const attr = Number(entry?.header?.attr ?? entry?.externalFileAttributes);
  if (!Number.isFinite(attr)) return false;
  const mode = attr >>> 16;
  return (mode & 0o170000) === 0o040000;
}

function createArchiveLimiter(limits) {
  const maxEntries = Number.isFinite(limits?.maxEntries) ? limits.maxEntries : null;
  const maxEntryBytes = Number.isFinite(limits?.maxEntryBytes) ? limits.maxEntryBytes : null;
  const maxBytes = Number.isFinite(limits?.maxBytes) ? limits.maxBytes : null;
  let entries = 0;
  let totalBytes = 0;
  const checkTotals = () => {
    if (maxBytes && totalBytes > maxBytes) {
      throw createError(ERROR_CODES.ARCHIVE_TOO_LARGE, `Archive exceeds max size (${totalBytes} > ${maxBytes}).`);
    }
  };
  const checkEntry = (name, size) => {
    entries += 1;
    if (maxEntries && entries > maxEntries) {
      throw createError(ERROR_CODES.ARCHIVE_TOO_LARGE, `Archive exceeds entry limit (${entries} > ${maxEntries}).`);
    }
    const entryBytes = Number.isFinite(size) && size > 0 ? size : 0;
    if (maxEntryBytes && entryBytes > maxEntryBytes) {
      throw createError(ERROR_CODES.ARCHIVE_TOO_LARGE, `Archive entry too large (${name}).`);
    }
    totalBytes += entryBytes;
    checkTotals();
    return entryBytes;
  };
  const addBytes = (delta) => {
    if (!Number.isFinite(delta) || delta <= 0) return;
    totalBytes += delta;
    checkTotals();
  };
  return { checkEntry, addBytes };
}


async function extractZipNode(archivePath, destDir, limits) {
  const limiter = createArchiveLimiter(limits);
  await fs.mkdir(destDir, { recursive: true });
  const mod = await import('yauzl');
  const yauzl = mod.default || mod;
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err);
      const fail = (error) => {
        try { zipfile.close(); } catch {}
        reject(error);
      };
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (isZipSymlink(entry)) {
          fail(createError(ERROR_CODES.ARCHIVE_UNSAFE, `unsafe zip entry (symlink): ${entry.fileName}`));
          return;
        }
        let targetPath;
        try {
          targetPath = resolveArchivePath(destDir, entry.fileName);
        } catch (error) {
          fail(error);
          return;
        }
        if (!targetPath) {
          fail(createError(ERROR_CODES.ARCHIVE_UNSAFE, `unsafe zip entry: ${entry.fileName}`));
          return;
        }
        const declaredSize = Number(entry.uncompressedSize);
        let counted = 0;
        try {
          counted = limiter.checkEntry(
            entry.fileName,
            Number.isFinite(declaredSize) ? declaredSize : 0
          );
        } catch (err) {
          fail(err);
          return;
        }
        if (isZipDirectory(entry)) {
          fs.mkdir(targetPath, { recursive: true })
            .then(async () => {
              try { await fs.chmod(targetPath, DIR_MODE); } catch {}
            })
            .then(() => zipfile.readEntry())
            .catch(fail);
          return;
        }
        fs.mkdir(path.dirname(targetPath), { recursive: true })
          .then(() => new Promise((resolveStream, rejectStream) => {
            zipfile.openReadStream(entry, (streamErr, readStream) => {
              if (streamErr || !readStream) return rejectStream(streamErr);
              const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 8)}`;
              let written = 0;
              readStream.on('data', (chunk) => {
                written += chunk.length;
                if (limits?.maxEntryBytes && written > limits.maxEntryBytes) {
                  readStream.destroy(
                    createError(ERROR_CODES.ARCHIVE_TOO_LARGE, `archive entry too large (${entry.fileName}).`)
                  );
                }
              });
              const writer = fsSync.createWriteStream(tempPath, { mode: FILE_MODE });
              pipeline(readStream, writer)
                .then(async () => {
                  if (written > counted) {
                    limiter.addBytes(written - counted);
                  }
                  try { await fs.chmod(tempPath, FILE_MODE); } catch {}
                  if (fsSync.existsSync(targetPath)) {
                    try { await fs.rm(targetPath, { force: true }); } catch {}
                  }
                  await fs.rename(tempPath, targetPath);
                  try { await fs.chmod(targetPath, FILE_MODE); } catch {}
                  resolveStream();
                })
                .catch(async (err) => {
                  try { await fs.rm(tempPath, { force: true }); } catch {}
                  rejectStream(err);
                });
            });
          }))
          .then(() => zipfile.readEntry())
          .catch(fail);
      });
      zipfile.on('end', () => {
        try { zipfile.close(); } catch {}
        resolve(true);
      });
      zipfile.on('error', fail);
    });
  });
}

async function extractTarNode(archivePath, destDir, gzip, limits) {
  const mod = await import('tar-stream');
  const tarStream = mod.default || mod;
  const extract = tarStream.extract();
  const limiter = createArchiveLimiter(limits);
  await fs.mkdir(destDir, { recursive: true });
  extract.on('entry', (header, stream, next) => {
    const rawName = header?.name || '';
    const type = header?.type || 'file';

    (async () => {
      // Count directories and special entries before any filesystem effect.
      const declaredSize = Number(header?.size);
      const counted = limiter.checkEntry(rawName,
        Number.isFinite(declaredSize) ? declaredSize : 0);
      const normalized = normalizeArchiveEntry(rawName);
      // Reject symlinks/hardlinks to avoid writing outside the destination or
      // creating unexpected filesystem references.
      if (type === 'symlink' || type === 'link') {
        throw createError(ERROR_CODES.ARCHIVE_UNSAFE, `unsafe tar entry (symlink): ${rawName}`);
      }

      // Skip empty / root-ish entries.
      if (!normalized || normalized === '.' || normalized === '..') {
        stream.resume();
        return;
      }

      const targetPath = resolveArchivePath(destDir, normalized);
      if (!targetPath) {
        throw createError(ERROR_CODES.ARCHIVE_UNSAFE, `unsafe tar entry: ${rawName}`);
      }

      if (type === 'directory') {
        await fs.mkdir(targetPath, { recursive: true });
        try { await fs.chmod(targetPath, DIR_MODE); } catch {}
        stream.resume();
        return;
      }

      // Ignore special entries (devices, FIFOs, pax headers, etc.).
      if (type !== 'file' && type !== 'contiguous-file') {
        stream.resume();
        return;
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });

      const writer = fsSync.createWriteStream(targetPath, { mode: FILE_MODE });
      let written = 0;
      stream.on('data', (chunk) => {
        written += chunk.length;
        if (limits?.maxEntryBytes && written > limits.maxEntryBytes) {
          stream.destroy(
            createError(ERROR_CODES.ARCHIVE_TOO_LARGE, `archive entry too large (${normalized}).`)
          );
        }
      });

      await pipeline(stream, writer);

      if (written > counted) {
        limiter.addBytes(written - counted);
      }
      try { await fs.chmod(targetPath, FILE_MODE); } catch {}
    })()
      .then(() => next())
      .catch((err) => {
        try { stream.resume(); } catch {}
        extract.destroy(err);
      });
  });
  const source = fsSync.createReadStream(archivePath);
  if (gzip) {
    await pipeline(source, createGunzip(), extract);
  } else {
    await pipeline(source, extract);
  }
  return true;
}

async function extractArchiveNode(archivePath, destDir, type, limits) {
  if (type === 'zip') return extractZipNode(archivePath, destDir, limits);
  const gzip = type === 'tar.gz';
  return extractTarNode(archivePath, destDir, gzip, limits);
}

/**
 * Extract an archive into a destination directory.
 * @param {string} archivePath
 * @param {string} destDir
 * @param {string} type
 * @returns {boolean}
 */
export async function extractArchive(archivePath, destDir, type, limits) {
  try {
    return await extractArchiveNode(archivePath, destDir, type, limits);
  } catch (error) {
    await fs.rm(destDir, { recursive: true, force: true });
    throw error;
  }
}
