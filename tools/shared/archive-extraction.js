import fs from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { archiveStreamError, createArchiveResourceOwner, removeOwnedArchiveDirectory } from './archive-resource-owner.js';
export { getArchiveExtractionSession, isArchiveExtractionSession, runArchiveTransaction } from './archive-resource-owner.js';
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


async function openArchiveInput(archivePath, owner) {
  const input = await owner.open(archivePath, 'r');
  const stat = await owner.stat(input);
  const size = Number(stat.size);
  if (!stat.isFile() || !Number.isSafeInteger(size) || size < 0) throw new Error('Archive input has no bounded regular-file extent.');
  return { input, size };
}

async function writeArchiveEntry(readStream, targetPath, owner, limits, name) {
  const output = await owner.open(targetPath, 'wx', FILE_MODE);
  let written = 0;
  const writer = new Writable({
    write(chunk, encoding, callback) {
      written += chunk.length;
      if (limits?.maxEntryBytes && written > limits.maxEntryBytes) {
        const error = createError(ERROR_CODES.ARCHIVE_TOO_LARGE, `archive entry too large (${name}).`);
        owner.record(error); callback(error); return;
      }
      owner.write(output, chunk).then(() => callback(), value => callback(archiveStreamError(value)));
    }
  });
  try { await pipeline(readStream, writer); }
  catch (value) { owner.record(value); throw value; }
  finally { await owner.closeOne(output); }
  return written;
}

const temporaryArchivePath = target => `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
async function publishArchiveFile(temporary, target, name) {
  let previous;
  try { previous = await fs.lstat(target); } catch (value) { if (value?.code !== 'ENOENT') throw value; }
  if (previous) {
    if (!previous.isFile() || previous.isSymbolicLink()) throw createError(ERROR_CODES.ARCHIVE_UNSAFE, `unsafe archive overwrite: ${name}`);
    await fs.rm(target, { force: false });
  }
  await fs.rename(temporary, target);
}

async function extractZipNode(archivePath, destDir, limits, owner) {
  const limiter = createArchiveLimiter(limits);
  const mod = await import('yauzl');
  const yauzl = mod.default || mod;
  const { input, size } = await openArchiveInput(archivePath, owner);
  // Keep yauzl's parser and range protocol, while the actual FileHandle remains
  // in this owner. reader.close acknowledges only that protocol, never native
  // descriptor closure. The original FileHandle closes after entry/I/O drain.
  const reader = new yauzl.RandomAccessReader();
  reader._readStreamForRange = (start, end) => Readable.from(owner.range(input, start, end));
  reader.read = (buffer, offset, length, position, callback) => {
    (async () => {
      let total = 0;
      while (total < length) {
        const { bytesRead } = await owner.read(input, buffer, offset + total, length - total, position + total);
        if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > length - total) throw new Error('Zip input descriptor returned an invalid byte count.');
        if (!bytesRead) break;
        total += bytesRead;
      }
      return total;
    })().then(bytes => callback(null, bytes), value => callback(archiveStreamError(value)));
  };
  reader.close = callback => callback();
  reader.on('error', value => owner.record(value));
  let zipfile = null, close = null, stopped = false;
  const tasks = new Set();
  const trackEntry = task => {
    tasks.add(task);
    task.finally(() => tasks.delete(task)).catch(() => {});
    return task;
  };
  try {
    zipfile = await new Promise((resolve, reject) => {
      yauzl.fromRandomAccessReader(reader, size, { lazyEntries: true, autoClose: false }, (error, result) => {
        if (error) { reject(error); return; }
        if (!result) { reject(new Error('Zip parser returned no owner.')); return; }
        resolve(result);
      });
    });
    close = zipfile.close;
    const readEntry = zipfile.readEntry, openReadStream = zipfile.openReadStream;
    if (typeof close !== 'function' || typeof readEntry !== 'function' || typeof openReadStream !== 'function') throw new Error('Zip parser has no original protocol owner.');
    await new Promise((resolve, reject) => {
      const fail = value => { owner.record(value); stopped = true; reject(value); };
      // All observations and entry handlers precede the first read admission.
      zipfile.on('error', fail);
      zipfile.on('end', () => { stopped = true; resolve(); });
      zipfile.on('entry', entry => {
        if (stopped) return;
        const task = (async () => {
          if (isZipSymlink(entry)) throw createError(ERROR_CODES.ARCHIVE_UNSAFE, `unsafe zip entry (symlink): ${entry.fileName}`);
          const targetPath = resolveArchivePath(destDir, entry.fileName);
          if (!targetPath) throw createError(ERROR_CODES.ARCHIVE_UNSAFE, `unsafe zip entry: ${entry.fileName}`);
          const declaredSize = Number(entry.uncompressedSize);
          const counted = limiter.checkEntry(entry.fileName, Number.isFinite(declaredSize) ? declaredSize : 0);
          if (isZipDirectory(entry)) {
            await fs.mkdir(targetPath, { recursive: true });
            try { await fs.chmod(targetPath, DIR_MODE); } catch {}
            return;
          }
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          if (stopped) return;
          const stream = await new Promise((resolveStream, rejectStream) => {
            openReadStream.call(zipfile, entry, (error, readStream) => {
              if (error) { rejectStream(error); return; }
              if (!readStream) { rejectStream(new Error('Zip entry returned no stream.')); return; }
              resolveStream(readStream);
            });
          });
          const tempPath = temporaryArchivePath(targetPath);
          try {
            if (stopped) { stream.destroy(); return; }
            const written = await writeArchiveEntry(stream, tempPath, owner, limits, entry.fileName);
            if (written > counted) limiter.addBytes(written - counted);
            try { await fs.chmod(tempPath, FILE_MODE); } catch {}
            await publishArchiveFile(tempPath, targetPath, entry.fileName);
            try { await fs.chmod(targetPath, FILE_MODE); } catch {}
          } catch (value) {
            // Temporary files remain within the exclusively owned destination;
            // recursive cleanup belongs to its owner after native closure.
            owner.record(value); stream.destroy(); throw value;
          }
        })().then(() => { if (!stopped) readEntry.call(zipfile); }).catch(fail);
        trackEntry(task);
      });
      try { readEntry.call(zipfile); } catch (value) { fail(value); }
    });
  } catch (value) { stopped = true; owner.record(value); }
  finally {
    stopped = true;
    while (tasks.size) await Promise.allSettled([...tasks]);
    if (zipfile && close) { try { close.call(zipfile); } catch (value) { owner.record(value); } }
  }
}

async function extractTarNode(archivePath, destDir, gzip, limits, owner) {
  const mod = await import('tar-stream');
  const tarStream = mod.default || mod;
  const extract = tarStream.extract();
  const destroy = extract.destroy;
  const limiter = createArchiveLimiter(limits);
  const tasks = new Set();
  let stopped = false;
  extract.on('entry', (header, stream, next) => {
    // The source can fail while an entry is awaiting mkdir, before its write
    // pipeline subscribes. Retain that error now and still drain the task.
    stream.on('error', value => { stopped = true; owner.record(value); });
    if (stopped) { stream.resume(); return; }
    const task = (async () => {
      const rawName = header?.name || '', type = header?.type || 'file';
      const declaredSize = Number(header?.size);
      const counted = limiter.checkEntry(rawName, Number.isFinite(declaredSize) ? declaredSize : 0);
      const normalized = normalizeArchiveEntry(rawName);
      if (type === 'symlink' || type === 'link') throw createError(ERROR_CODES.ARCHIVE_UNSAFE, `unsafe tar entry (symlink): ${rawName}`);
      if (!normalized || normalized === '.' || normalized === '..') { stream.resume(); return; }
      const targetPath = resolveArchivePath(destDir, normalized);
      if (!targetPath) throw createError(ERROR_CODES.ARCHIVE_UNSAFE, `unsafe tar entry: ${rawName}`);
      if (type === 'directory') {
        await fs.mkdir(targetPath, { recursive: true });
        try { await fs.chmod(targetPath, DIR_MODE); } catch {}
        stream.resume(); return;
      }
      if (type !== 'file' && type !== 'contiguous-file') { stream.resume(); return; }
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      if (stopped) { stream.resume(); return; }
      const temporary = temporaryArchivePath(targetPath);
      const written = await writeArchiveEntry(stream, temporary, owner, limits, normalized);
      if (written > counted) limiter.addBytes(written - counted);
      await publishArchiveFile(temporary, targetPath, normalized);
      try { await fs.chmod(targetPath, FILE_MODE); } catch {}
    })().then(() => { if (!stopped) next(); }).catch(value => {
      stopped = true; owner.record(value);
      try { stream.resume(); destroy.call(extract, archiveStreamError(value)); }
      catch (secondary) { owner.record(secondary); }
    });
    tasks.add(task);
    task.finally(() => tasks.delete(task)).catch(() => {});
  });
  try {
    const { input, size } = await openArchiveInput(archivePath, owner);
    const source = Readable.from(owner.range(input, 0, size));
    if (gzip) await pipeline(source, createGunzip(), extract);
    else await pipeline(source, extract);
  } catch (value) { stopped = true; owner.record(value); }
  finally {
    stopped = true;
    while (tasks.size) await Promise.allSettled([...tasks]);
  }
}

/** Extract only into a new destination, retaining the actual descriptor owner
 * through parser/entry drain and exact cleanup. No stream protocol receipt is
 * treated as native FileHandle closure.
 */
export async function extractArchive(archivePath, destDir, type, limits) {
  const destination = path.resolve(destDir);
  try { await fs.mkdir(destination, { mode: DIR_MODE }); }
  catch (value) {
    if (value?.code !== 'EEXIST') throw value;
    throw createError(ERROR_CODES.ARCHIVE_UNSAFE, `Archive destination must not exist: ${destination}`);
  }
  const owner = createArchiveResourceOwner(destination);
  let identity = null;
  owner.setCleanup(() => removeOwnedArchiveDirectory(destination, identity));
  try {
    identity = await fs.lstat(destination, { bigint: true });
    if (!identity.isDirectory() || identity.isSymbolicLink() || identity.ino === 0n) throw createError(ERROR_CODES.ARCHIVE_UNSAFE, 'Archive destination has no known directory identity.');
    if (type === 'zip') await extractZipNode(archivePath, destination, limits, owner);
    else if (type === 'tar' || type === 'tar.gz') await extractTarNode(archivePath, destination, type === 'tar.gz', limits, owner);
    else throw createError(ERROR_CODES.ARCHIVE_UNSAFE, `Unsupported archive type: ${type}`);
  } catch (value) { owner.record(value); }
  await owner.finish();
  return true;
}
