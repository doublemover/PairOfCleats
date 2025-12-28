import fs from 'node:fs/promises';
import path from 'node:path';
import { EXTS_CODE, EXTS_PROSE, isSpecialCodeFile } from '../constants.js';
import { fileExt, toPosix } from '../../shared/files.js';

/**
 * Recursively discover indexable files under a directory.
 * @param {{root:string,mode:'code'|'prose',ignoreMatcher:import('ignore').Ignore,skippedFiles:string[]}} input
 * @returns {Promise<string[]>}
 */
export async function discoverFiles({ root, mode, ignoreMatcher, skippedFiles }) {
  async function walk(dir, acc = []) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, entry.name);
      const relPosix = toPosix(path.relative(root, absPath));
      const ignoreKey = entry.isDirectory() ? `${relPosix}/` : relPosix;
      if (ignoreMatcher.ignores(ignoreKey)) {
        skippedFiles.push(absPath);
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absPath, acc);
      } else {
        const ext = fileExt(absPath);
        const isSpecial = isSpecialCodeFile(entry.name);
        if ((mode === 'prose' && EXTS_PROSE.has(ext)) ||
          (mode === 'code' && (EXTS_CODE.has(ext) || isSpecial))) {
          acc.push(absPath);
        } else {
          skippedFiles.push(absPath);
        }
      }
    }
    return acc;
  }

  return walk(root);
}
