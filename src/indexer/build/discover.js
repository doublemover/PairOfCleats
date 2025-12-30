import fs from 'node:fs/promises';
import path from 'node:path';
import { EXTS_CODE, EXTS_PROSE, isSpecialCodeFile } from '../constants.js';
import { fileExt, toPosix } from '../../shared/files.js';

/**
 * Recursively discover indexable files under a directory.
 * @param {{root:string,mode:'code'|'prose',ignoreMatcher:import('ignore').Ignore,skippedFiles:Array, maxFileBytes:number|null}} input
 * @returns {Promise<string[]>}
 */
export async function discoverFiles({ root, mode, ignoreMatcher, skippedFiles, maxFileBytes = null }) {
  const maxBytes = Number.isFinite(Number(maxFileBytes)) && Number(maxFileBytes) > 0
    ? Number(maxFileBytes)
    : null;
  const recordSkip = (filePath, reason, extra = {}) => {
    skippedFiles.push({
      file: filePath,
      reason,
      ...extra
    });
  };
  async function walk(dir, acc = []) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, entry.name);
      const relPosix = toPosix(path.relative(root, absPath));
      const ignoreKey = entry.isDirectory() ? `${relPosix}/` : relPosix;
      if (ignoreMatcher.ignores(ignoreKey)) {
        recordSkip(absPath, 'ignored');
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absPath, acc);
      } else {
        const ext = fileExt(absPath);
        const isSpecial = isSpecialCodeFile(entry.name);
        if ((mode === 'prose' && EXTS_PROSE.has(ext)) ||
          (mode === 'code' && (EXTS_CODE.has(ext) || isSpecial))) {
          if (maxBytes) {
            try {
              const stat = await fs.stat(absPath);
              if (stat.size > maxBytes) {
                recordSkip(absPath, 'oversize', { bytes: stat.size, maxBytes });
                continue;
              }
            } catch {
              recordSkip(absPath, 'stat-failed');
              continue;
            }
          }
          acc.push(absPath);
        } else {
          recordSkip(absPath, 'unsupported');
        }
      }
    }
    return acc;
  }

  return walk(root);
}
