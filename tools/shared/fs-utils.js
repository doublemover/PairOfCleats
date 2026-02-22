import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { toPosix } from '../../src/shared/files.js';

/**
 * Copy a directory if the source exists.
 * @param {string} sourceDir
 * @param {string} destinationDir
 * @param {{clearDestination?:boolean}} [options]
 * @returns {Promise<boolean>}
 */
export async function copyDirIfExists(sourceDir, destinationDir, options = {}) {
  if (!fs.existsSync(sourceDir)) return false;
  if (options.clearDestination) {
    await fsPromises.rm(destinationDir, { recursive: true, force: true });
  }
  await fsPromises.mkdir(destinationDir, { recursive: true });
  await fsPromises.cp(sourceDir, destinationDir, { recursive: true });
  return true;
}

/**
 * Recursively list files under a directory.
 *
 * @param {string} rootDir
 * @param {{
 *   baseDir?:string,
 *   sortEntries?:boolean,
 *   include?:(entry:{absPath:string,relPath:string,dirent:import('node:fs').Dirent})=>boolean
 * }} [options]
 * @returns {Promise<Array<{absPath:string,relPath:string,dirent:import('node:fs').Dirent}>>}
 */
export async function listFilesRecursive(rootDir, options = {}) {
  const baseDir = options.baseDir || rootDir;
  const sortEntries = options.sortEntries === true;
  const include = typeof options.include === 'function' ? options.include : null;
  const entries = await fsPromises.readdir(rootDir, { withFileTypes: true });
  const ordered = sortEntries
    ? entries.slice().sort((a, b) => a.name.localeCompare(b.name))
    : entries;
  const out = [];
  for (const dirent of ordered) {
    const absPath = path.join(rootDir, dirent.name);
    const relPath = toPosix(path.relative(baseDir, absPath));
    if (include && include({ absPath, relPath, dirent }) === false) continue;
    if (dirent.isDirectory()) {
      out.push(...await listFilesRecursive(absPath, { baseDir, sortEntries, include }));
      continue;
    }
    if (!dirent.isFile()) continue;
    out.push({ absPath, relPath, dirent });
  }
  return out;
}
