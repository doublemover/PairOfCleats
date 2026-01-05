import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fdir } from 'fdir';
import { EXTS_CODE, EXTS_PROSE, isSpecialCodeFile } from '../constants.js';
import { fileExt, toPosix } from '../../shared/files.js';

/**
 * Recursively discover indexable files under a directory.
 * @param {{root:string,mode:'code'|'prose',ignoreMatcher:import('ignore').Ignore,skippedFiles:Array, maxFileBytes:number|null}} input
 * @returns {Promise<Array<{abs:string,rel:string,stat:import('node:fs').Stats}>>}
 */
export async function discoverFiles({ root, mode, ignoreMatcher, skippedFiles, maxFileBytes = null }) {
  const { entries, skippedCommon } = await discoverEntries({ root, ignoreMatcher, maxFileBytes });
  if (skippedFiles) skippedFiles.push(...skippedCommon);
  return filterEntriesByMode(entries, mode, skippedFiles);
}

/**
 * Discover files for multiple modes in a single traversal.
 * @param {{root:string,modes:Array<'code'|'prose'>,ignoreMatcher:import('ignore').Ignore,skippedByMode:Record<string,Array>,maxFileBytes:number|null}} input
 * @returns {Promise<Record<string,Array<{abs:string,rel:string,stat:import('node:fs').Stats}>>>}
 */
export async function discoverFilesForModes({ root, modes, ignoreMatcher, skippedByMode, maxFileBytes = null }) {
  const { entries, skippedCommon } = await discoverEntries({ root, ignoreMatcher, maxFileBytes });
  const output = {};
  for (const mode of modes) {
    const skipped = skippedByMode && skippedByMode[mode] ? skippedByMode[mode] : null;
    if (skipped) skipped.push(...skippedCommon);
    output[mode] = filterEntriesByMode(entries, mode, skipped);
  }
  return output;
}

async function discoverEntries({ root, ignoreMatcher, maxFileBytes = null }) {
  const maxBytes = Number.isFinite(Number(maxFileBytes)) && Number(maxFileBytes) > 0
    ? Number(maxFileBytes)
    : null;
  const skippedCommon = [];
  const recordSkip = (filePath, reason, extra = {}) => {
    skippedCommon.push({ file: filePath, reason, ...extra });
  };
  const normalizeRoot = (value) => {
    const resolved = path.resolve(value || '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const listGitFiles = () => {
    try {
      const rootCheck = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
      if (rootCheck.status !== 0) return null;
      const gitRoot = String(rootCheck.stdout || '').trim();
      if (!gitRoot) return null;
      if (normalizeRoot(gitRoot) !== normalizeRoot(root)) return null;
      const result = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
      if (result.status !== 0) return null;
      const output = String(result.stdout || '');
      if (!output) return [];
      return output.split('\u0000').filter(Boolean);
    } catch {
      return null;
    }
  };

  const listFdirFiles = async () => {
    const crawler = new fdir().withFullPaths().crawl(root);
    return crawler.withPromise();
  };

  const relPaths = listGitFiles();
  const candidates = Array.isArray(relPaths)
    ? relPaths.map((rel) => path.join(root, rel))
    : await listFdirFiles();

  const entries = [];
  for (const absPath of candidates) {
    const relPosix = toPosix(path.relative(root, absPath));
    if (!relPosix || relPosix === '.' || relPosix.startsWith('..')) continue;
    if (ignoreMatcher.ignores(relPosix)) {
      recordSkip(absPath, 'ignored');
      continue;
    }
    const ext = fileExt(absPath);
    const baseName = path.basename(absPath);
    const isSpecial = isSpecialCodeFile(baseName);
    let stat;
    try {
      stat = await fs.stat(absPath);
    } catch {
      recordSkip(absPath, 'stat-failed');
      continue;
    }
    if (maxBytes && stat.size > maxBytes) {
      recordSkip(absPath, 'oversize', { bytes: stat.size, maxBytes });
      continue;
    }
    entries.push({ abs: absPath, rel: relPosix, stat, ext, isSpecial });
  }

  return { entries, skippedCommon };
}

function filterEntriesByMode(entries, mode, skippedFiles) {
  const output = [];
  for (const entry of entries) {
    const allowed = (mode === 'prose' && EXTS_PROSE.has(entry.ext))
      || (mode === 'code' && (EXTS_CODE.has(entry.ext) || entry.isSpecial));
    if (!allowed) {
      if (skippedFiles) skippedFiles.push({ file: entry.abs, reason: 'unsupported' });
      continue;
    }
    output.push({ abs: entry.abs, rel: entry.rel, stat: entry.stat });
  }
  return output;
}
