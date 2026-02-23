import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import { toPosix } from '../../src/shared/files.js';
import { listFilesRecursive } from '../shared/fs-utils.js';

const FIXED_MTIME = new Date('2000-01-01T00:00:00.000Z');
const FIXED_MTIME_ISO = FIXED_MTIME.toISOString();
const DEFAULT_EXCLUDES = [
  /(^|\/)\.DS_Store$/,
  /(^|\/)Thumbs\.db$/,
  /(^|\/)__pycache__(\/|$)/,
  /\.pyc$/
];

const matchesExclude = (relPath, excludes) => {
  const posixPath = toPosix(relPath);
  return excludes.some((pattern) => pattern.test(posixPath));
};

const stableSort = (items) => items.slice().sort((a, b) => a.localeCompare(b));

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

/**
 * Validate runtime/tooling prerequisites for deterministic packaging flows.
 *
 * @param {{requireNpm?:boolean,requirePython?:boolean}} [options]
 * @returns {void}
 */
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

/**
 * Build a deterministic zip archive from a source tree.
 *
 * Entries are sorted and normalized with fixed mtime/mode metadata so repeated
 * runs over identical inputs produce identical bytes/checksums.
 *
 * @param {{
 *  sourceDir:string,
 *  archivePath:string,
 *  rootPrefix?:string,
 *  excludes?:RegExp[],
 *  fixedMtime?:Date
 * }} options
 * @returns {Promise<{archivePath:string,checksum:string,entries:Array<{path:string,mode:number,sizeBytes:number,mtime:string}>}>}
 */
export const buildDeterministicZip = async ({
  sourceDir,
  archivePath,
  rootPrefix = '',
  excludes = DEFAULT_EXCLUDES,
  fixedMtime = FIXED_MTIME
}) => {
  const sourceRoot = path.resolve(sourceDir);
  const files = await listFilesRecursive(sourceRoot, {
    baseDir: sourceRoot,
    sortEntries: true,
    include: ({ relPath }) => !matchesExclude(relPath, excludes)
  });
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
