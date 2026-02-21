import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import AdmZip from 'adm-zip';

const FIXED_MTIME = new Date('2000-01-01T00:00:00.000Z');
const FIXED_MTIME_ISO = FIXED_MTIME.toISOString();
const DEFAULT_EXCLUDES = [
  /(^|\/)\.DS_Store$/,
  /(^|\/)Thumbs\.db$/,
  /(^|\/)__pycache__(\/|$)/,
  /\.pyc$/
];

const toPosix = (value) => String(value || '').replace(/\\/g, '/');

const matchesExclude = (relPath, excludes) => {
  const posixPath = toPosix(relPath);
  return excludes.some((pattern) => pattern.test(posixPath));
};

const stableSort = (items) => items.slice().sort((a, b) => a.localeCompare(b));

const listFilesRecursive = async (rootDir, {
  excludes = DEFAULT_EXCLUDES,
  baseDir = rootDir
} = {}) => {
  const entries = await fsPromises.readdir(rootDir, { withFileTypes: true });
  const sorted = entries.slice().sort((a, b) => a.name.localeCompare(b.name));
  const out = [];
  for (const entry of sorted) {
    const absPath = path.join(rootDir, entry.name);
    const relPath = toPosix(path.relative(baseDir, absPath));
    if (matchesExclude(relPath, excludes)) continue;
    if (entry.isDirectory()) {
      const nested = await listFilesRecursive(absPath, { excludes, baseDir });
      out.push(...nested);
      continue;
    }
    if (!entry.isFile()) continue;
    out.push({ absPath, relPath });
  }
  return out;
};

const detectFileMode = async (filePath) => {
  const stat = await fsPromises.stat(filePath);
  const executable = (stat.mode & 0o111) !== 0;
  return executable ? 0o755 : 0o644;
};

const sha256File = (filePath) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
};

const ensureDir = async (targetPath) => {
  await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
};

export const assertPinnedPackagingToolchain = ({
  requireNpm = false,
  requirePython = false
} = {}) => {
  if (!process.versions?.node) {
    throw new Error('Packaging toolchain error: Node.js runtime is unavailable.');
  }
  if (requireNpm) {
    const npmCheck = fs.existsSync(path.join(process.cwd(), 'package.json'));
    if (!npmCheck) {
      throw new Error('Packaging toolchain error: package.json not found for npm-based packaging policy.');
    }
  }
  if (requirePython) {
    const python = process.platform === 'win32' ? 'python' : 'python3';
    const probe = spawnSync(python, ['--version'], { encoding: 'utf8' });
    if (probe.status !== 0) {
      throw new Error('Packaging toolchain error: Python runtime is required but unavailable.');
    }
  }
};

export const buildDeterministicZip = async ({
  sourceDir,
  archivePath,
  rootPrefix = '',
  excludes = DEFAULT_EXCLUDES,
  fixedMtime = FIXED_MTIME
}) => {
  const sourceRoot = path.resolve(sourceDir);
  const files = await listFilesRecursive(sourceRoot, { excludes, baseDir: sourceRoot });
  const sortedFiles = files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  const zip = new AdmZip();
  const entries = [];
  for (const file of sortedFiles) {
    const archiveRel = toPosix(path.posix.join(rootPrefix, file.relPath));
    const content = await fsPromises.readFile(file.absPath);
    const mode = await detectFileMode(file.absPath);
    const attr = mode << 16;
    zip.addFile(archiveRel, content, '', attr);
    const entry = zip.getEntry(archiveRel);
    if (entry && entry.header) {
      entry.header.time = fixedMtime;
      entry.header.attr = attr;
    }
    entries.push({
      path: archiveRel,
      mode,
      sizeBytes: content.length,
      mtime: fixedMtime.toISOString()
    });
  }

  await ensureDir(archivePath);
  zip.writeZip(archivePath);

  const checksum = sha256File(archivePath);
  return {
    archivePath: path.resolve(archivePath),
    checksum,
    entries: stableSort(entries.map((entry) => entry.path)).map((entryPath) => (
      entries.find((entry) => entry.path === entryPath)
    ))
  };
};

export const writeArchiveChecksums = async ({
  archivePath,
  checksum,
  entries,
  checksumPath,
  manifestPath,
  toolchain
}) => {
  const relArchive = toPosix(path.relative(process.cwd(), archivePath));
  const shaLine = `${checksum}  ${path.basename(archivePath)}\n`;
  await ensureDir(checksumPath);
  await fsPromises.writeFile(checksumPath, shaLine, 'utf8');

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    archive: relArchive,
    checksumSha256: checksum,
    fixedMtime: FIXED_MTIME_ISO,
    toolchain: toolchain || {},
    entries: Array.isArray(entries) ? entries : []
  };
  await ensureDir(manifestPath);
  await fsPromises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
};

export const DEFAULT_ARCHIVE_EXCLUDES = DEFAULT_EXCLUDES;
export const DETERMINISTIC_ARCHIVE_FIXED_MTIME = FIXED_MTIME_ISO;
