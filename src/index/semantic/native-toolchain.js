import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { throwIfAborted } from '../../shared/abort.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
const MAX_FILE_BYTES = 256 * 1024 * 1024, MAX_TOOLCHAIN_BYTES = 1024 * 1024 * 1024;
const safeNumber = value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw fail('Native ELF offset exceeds its allowance.');
  return number;
};

/** Hash and decode one pinned Linux ELF using a fixed hash buffer. No executable,
 * driver, shell, package manager or project hook runs during authority discovery.
 */
const inspectElf = async (filename, signal) => {
  const canonical = await fs.realpath(filename), handle = await fs.open(canonical, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_FILE_BYTES) throw fail('Native toolchain file exceeds its allowance.');
    const at = async (offset, size) => {
      if (!Number.isSafeInteger(offset + size) || size > 16 * 1024 * 1024 || offset + size > before.size) throw fail('Malformed or oversized ELF metadata.');
      const bytes = Buffer.alloc(size);
      let read = 0;
      while (read < size) {
        throwIfAborted(signal);
        const result = await handle.read(bytes, read, size - read, offset + read);
        if (!result.bytesRead) throw fail('Native toolchain bytes changed.');
        read += result.bytesRead;
      }
      return bytes;
    };
    const header = await at(0, 64);
    if (header.subarray(0, 4).toString('hex') !== '7f454c46' || header[4] !== 2 || header[5] !== 1) throw fail('Native sealed authority requires a little-endian 64-bit ELF toolchain.');
    const sectionOffset = safeNumber(header.readBigUInt64LE(40)), sectionSize = header.readUInt16LE(58), sectionCount = header.readUInt16LE(60);
    if (sectionSize < 64 || sectionCount < 1 || sectionCount > 4096) throw fail('Native ELF section inventory is unavailable.');
    const sections = await at(sectionOffset, sectionSize * sectionCount), needed = [], search = [];
    const section = index => {
      if (index >= sectionCount) throw fail('Native ELF string-table identity is invalid.');
      const entry = sections.subarray(index * sectionSize, (index + 1) * sectionSize);
      return { type: entry.readUInt32LE(4), offset: safeNumber(entry.readBigUInt64LE(24)),
        size: safeNumber(entry.readBigUInt64LE(32)), link: entry.readUInt32LE(40) };
    };
    for (let index = 0; index < sectionCount; index += 1) {
      const row = section(index); if (row.type !== 6) continue;
      const stringSection = section(row.link), strings = await at(stringSection.offset, stringSection.size), dynamic = await at(row.offset, row.size);
      for (let offset = 0; offset + 16 <= dynamic.length; offset += 16) {
        const tag = safeNumber(dynamic.readBigUInt64LE(offset)); if (tag === 0) break;
        if (![1, 15, 29].includes(tag)) continue;
        const start = safeNumber(dynamic.readBigUInt64LE(offset + 8)), end = strings.indexOf(0, start);
        if (start >= strings.length || end < start) throw fail('Malformed native library name.');
        const value = strings.subarray(start, end).toString('utf8');
        if (tag === 1) needed.push(value); else search.push(...value.split(':'));
      }
    }
    const programOffset = safeNumber(header.readBigUInt64LE(32)), programSize = header.readUInt16LE(54), programCount = header.readUInt16LE(56);
    let interpreter = null;
    if (programCount) {
      if (programSize < 56 || programCount > 256) throw fail('Native ELF loader inventory is invalid.');
      const programs = await at(programOffset, programSize * programCount);
      for (let index = 0; index < programCount; index += 1) {
        const row = programs.subarray(index * programSize, (index + 1) * programSize);
        if (row.readUInt32LE(0) !== 3) continue;
        const text = await at(safeNumber(row.readBigUInt64LE(8)), safeNumber(row.readBigUInt64LE(32)));
        interpreter = text.toString('utf8').replace(/\0.*$/s, '');
      }
    }
    const digest = createHash('sha256'), buffer = Buffer.alloc(65536);
    let position = 0;
    while (position < before.size) {
      throwIfAborted(signal);
      const read = await handle.read(buffer, 0, Math.min(buffer.length, before.size - position), position);
      if (!read.bytesRead) throw fail('Native toolchain bytes changed.');
      digest.update(buffer.subarray(0, read.bytesRead)); position += read.bytesRead;
    }
    const after = await handle.stat();
    if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => before[key] !== after[key]) || await fs.realpath(filename) !== canonical) throw fail('Native toolchain identity changed during its read.');
    return { path: canonical, hash: digest.digest('hex'), bytes: before.size, needed, search, interpreter };
  } finally { await handle.close(); }
};

export const resolveNativeExecutable = async command => {
  if (typeof command !== 'string' || !command.trim()) throw fail('Native provider command is unavailable.');
  const candidates = path.isAbsolute(command) || command.includes(path.sep) ? [path.resolve(command)]
    : String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, command));
  for (const candidate of candidates) {
    try { await fs.access(candidate, 1); return await fs.realpath(candidate); }
    catch (error) { if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) throw error; }
  }
  throw fail('Native provider command is unavailable.');
};

/** Seal every candidate for each declared ELF dependency, including loader-cache
 * variants. Ambiguity costs extra hashes rather than choosing an unverified file.
 */
export const collectNativeToolchainFiles = async ({ executables, signal = null }) => {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw fail('Native sealed toolchain platform is unsupported.');
  const cachePath = '/etc/ld.so.cache', cache = await fs.readFile(cachePath);
  if (cache.length > 16 * 1024 * 1024) throw fail('Native loader-cache inventory exceeds its allowance.');
  let preload = { exists: false, hash: null, bytes: 0 };
  try {
    const bytes = await fs.readFile('/etc/ld.so.preload');
    if (bytes.toString('utf8').trim()) throw fail('Native system preloads are outside sealed authority.');
    preload = { exists: true, hash: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const cachePaths = [...new Set([...cache.toString('latin1').matchAll(/\/[^\0]{1,4096}\0/g)].map(match => match[0].slice(0, -1)))];
  const defaultDirectories = process.arch === 'x64' ? ['/lib/x86_64-linux-gnu', '/usr/lib/x86_64-linux-gnu', '/lib64', '/usr/lib64']
    : ['/lib/aarch64-linux-gnu', '/usr/lib/aarch64-linux-gnu', '/lib64', '/usr/lib64'];
  defaultDirectories.push('/lib', '/usr/lib');
  const loaderDirectories = process.env.LD_LIBRARY_PATH ? process.env.LD_LIBRARY_PATH.split(path.delimiter) : [];
  if (loaderDirectories.length > 16 || loaderDirectories.some(directory => !path.isAbsolute(directory) || directory.includes('$'))) throw fail('Native loader path must contain bounded absolute directories.');
  for (const directory of loaderDirectories) {
    if (!(await fs.stat(directory)).isDirectory()) throw fail('Native loader directory is unavailable.');
  }
  const pending = [...new Set(executables)], files = new Map(); let totalBytes = cache.length;
  while (pending.length) {
    throwIfAborted(signal);
    const filename = pending.pop(), canonical = await fs.realpath(filename);
    if (files.has(canonical)) continue;
    if (files.size >= 128) throw fail('Native toolchain dependency inventory exceeds its allowance.');
    const row = await inspectElf(canonical, signal); totalBytes += row.bytes;
    if (totalBytes > MAX_TOOLCHAIN_BYTES) throw fail('Native toolchain byte inventory exceeds its allowance.');
    files.set(canonical, { path: canonical, hash: row.hash, bytes: row.bytes });
    if (row.interpreter) pending.push(row.interpreter);
    const search = [...loaderDirectories, ...row.search.map(directory => directory.replaceAll('${ORIGIN}', path.dirname(canonical)).replaceAll('$ORIGIN', path.dirname(canonical))), ...defaultDirectories];
    if (search.some(directory => !path.isAbsolute(directory) || directory.includes('$'))) throw fail('Native relative or dynamic loader search is outside sealed authority.');
    for (const name of row.needed) {
      if (!/^[A-Za-z0-9_.+-]+$/.test(name)) throw fail('Native library search name is outside sealed authority.');
      const variants = process.arch === 'x64' ? ['x86-64-v2', 'x86-64-v3', 'x86-64-v4'] : [];
      const candidates = [...cachePaths.filter(filename => path.basename(filename) === name), ...search.flatMap(directory =>
        [path.join(directory, name), ...variants.map(variant => path.join(directory, 'glibc-hwcaps', variant, name))])];
      let found = false;
      for (const candidate of candidates) {
        try { await fs.access(candidate); pending.push(candidate); found = true; }
        catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
      }
      if (!found) throw fail('Native toolchain dependency is unavailable: ' + name);
    }
  }
  return { files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
    loaderCache: { path: cachePath, hash: createHash('sha256').update(cache).digest('hex'), bytes: cache.length },
    preload, loaderDirectories, totalBytes };
};
