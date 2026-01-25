import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fdir } from 'fdir';
import {
  EXTS_CODE,
  EXTS_PROSE,
  isLockFile,
  isManifestFile,
  isSpecialCodeFile,
  resolveSpecialCodeExt
} from '../constants.js';
import { getLanguageForFile } from '../language-registry.js';
import { fileExt, toPosix } from '../../shared/files.js';
import { createRecordsClassifier } from './records.js';

/**
 * Recursively discover indexable files under a directory.
 * @param {{root:string,mode:'code'|'prose'|'extracted-prose',recordsDir?:string|null,ignoreMatcher:import('ignore').Ignore,skippedFiles:Array, maxFileBytes:number|null,fileCaps?:object,maxDepth?:number|null,maxFiles?:number|null}} input
 * @returns {Promise<Array<{abs:string,rel:string,stat:import('node:fs').Stats}>>}
 */
export async function discoverFiles({ root, mode, recordsDir = null, recordsConfig = null, ignoreMatcher, skippedFiles, maxFileBytes = null, fileCaps = null, maxDepth = null, maxFiles = null }) {
  const { entries, skippedCommon } = await discoverEntries({
    root,
    recordsDir,
    recordsConfig,
    ignoreMatcher,
    maxFileBytes,
    fileCaps,
    maxDepth,
    maxFiles
  });
  if (skippedFiles) skippedFiles.push(...skippedCommon);
  return filterEntriesByMode(entries, mode, skippedFiles);
}

/**
 * Discover files for multiple modes in a single traversal.
 * @param {{root:string,modes:Array<'code'|'prose'|'extracted-prose'>,recordsDir?:string|null,ignoreMatcher:import('ignore').Ignore,skippedByMode:Record<string,Array>,maxFileBytes:number|null,fileCaps?:object,maxDepth?:number|null,maxFiles?:number|null}} input
 * @returns {Promise<Record<string,Array<{abs:string,rel:string,stat:import('node:fs').Stats}>>>}
 */
export async function discoverFilesForModes({ root, modes, recordsDir = null, recordsConfig = null, ignoreMatcher, skippedByMode, maxFileBytes = null, fileCaps = null, maxDepth = null, maxFiles = null }) {
  const { entries, skippedCommon } = await discoverEntries({
    root,
    recordsDir,
    recordsConfig,
    ignoreMatcher,
    maxFileBytes,
    fileCaps,
    maxDepth,
    maxFiles
  });
  const output = {};
  for (const mode of modes) {
    const skipped = skippedByMode && skippedByMode[mode] ? skippedByMode[mode] : null;
    if (skipped) skipped.push(...skippedCommon);
    output[mode] = filterEntriesByMode(entries, mode, skipped);
  }
  return output;
}

export async function discoverEntries({ root, recordsDir = null, recordsConfig = null, ignoreMatcher, maxFileBytes = null, fileCaps = null, maxDepth = null, maxFiles = null }) {
  const maxBytes = Number.isFinite(Number(maxFileBytes)) && Number(maxFileBytes) > 0
    ? Number(maxFileBytes)
    : null;
  const maxDepthValue = maxDepth == null
    ? null
    : (Number.isFinite(Number(maxDepth)) && Number(maxDepth) >= 0
      ? Math.floor(Number(maxDepth))
      : null);
  const maxFilesValue = Number.isFinite(Number(maxFiles)) && Number(maxFiles) > 0
    ? Math.floor(Number(maxFiles))
    : null;
  const skippedCommon = [];
  const recordSkip = (filePath, reason, extra = {}) => {
    skippedCommon.push({ file: filePath, reason, ...extra });
  };
  const minifiedNameRegex = /(?:\.min\.[^/]+$)|(?:-min\.[^/]+$)/i;
  const normalizeCapValue = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const resolveMaxBytesForExt = (ext) => {
    const extKey = ext ? ext.toLowerCase() : '';
    const defaultCap = fileCaps?.default?.maxBytes;
    const extCap = extKey ? fileCaps?.byExt?.[extKey]?.maxBytes : null;
    const capValue = normalizeCapValue(extCap ?? defaultCap);
    if (!Number.isFinite(capValue) || capValue <= 0) {
      return maxBytes;
    }
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      return capValue;
    }
    return Math.min(maxBytes, capValue);
  };
  const normalizeRoot = (value) => {
    const resolved = path.resolve(value || '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const normalizedRoot = normalizeRoot(root);
  const normalizedRecordsRoot = recordsDir ? normalizeRoot(recordsDir) : null;
  const recordsRoot = normalizedRecordsRoot
    && (normalizedRecordsRoot === normalizedRoot
      || normalizedRecordsRoot.startsWith(`${normalizedRoot}${path.sep}`))
    ? normalizedRecordsRoot
    : null;
  const recordsClassifier = createRecordsClassifier({ root, config: recordsConfig });
  const listGitFiles = () => {
    try {
      const rootCheck = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
      if (rootCheck.status !== 0) return null;
      const gitRoot = String(rootCheck.stdout || '').trim();
      if (!gitRoot) return null;
      const normalizedGitRoot = normalizeRoot(gitRoot);
      const rootRel = normalizedRoot === normalizedGitRoot
        ? ''
        : (normalizedRoot.startsWith(`${normalizedGitRoot}${path.sep}`)
          ? path.relative(gitRoot, root)
          : null);
      if (rootRel == null) return null;
      const args = ['-C', gitRoot, 'ls-files', '-z'];
      if (rootRel) args.push('--', rootRel);
      const result = spawnSync('git', args, { encoding: 'utf8' });
      if (result.status !== 0) return null;
      const output = String(result.stdout || '');
      if (!output) return [];
      return {
        gitRoot,
        files: output.split('\u0000').filter(Boolean)
      };
    } catch {
      return null;
    }
  };

  const listFdirFiles = async () => {
    const crawler = new fdir().withFullPaths().crawl(root);
    return crawler.withPromise();
  };

  const gitResult = listGitFiles();
  const candidates = gitResult && Array.isArray(gitResult.files)
    ? gitResult.files.map((rel) => path.join(gitResult.gitRoot || root, rel))
    : await listFdirFiles();

  const entries = [];
  let maxFilesReached = false;
  const statConcurrency = Math.min(64, Math.max(4, Number(process.env.PAIROFCLEATS_DISCOVERY_STAT_CONCURRENCY) || 32));
  const processCandidate = async (absPath) => {
    if (maxFilesReached) {
      recordSkip(absPath, 'max-files', { maxFiles: maxFilesValue });
      return;
    }
    const relPosix = toPosix(path.relative(root, absPath));
    if (!relPosix || relPosix === '.' || relPosix.startsWith('..')) return;
    const normalizedAbs = normalizeRoot(absPath);
    const inRecordsRoot = recordsRoot
      ? normalizedAbs.startsWith(`${recordsRoot}${path.sep}`)
      : false;
    if (maxDepthValue != null) {
      const depth = relPosix.split('/').length - 1;
      if (depth > maxDepthValue) {
        recordSkip(absPath, 'max-depth', { depth, maxDepth: maxDepthValue });
        return;
      }
    }
    if (maxFilesValue && entries.length >= maxFilesValue) {
      maxFilesReached = true;
      recordSkip(absPath, 'max-files', { maxFiles: maxFilesValue });
      return;
    }
    const baseName = path.basename(absPath);
    const ext = resolveSpecialCodeExt(baseName) || fileExt(absPath);
    const isManifest = isManifestFile(baseName);
    const isLock = isLockFile(baseName);
    const language = getLanguageForFile(ext, relPosix);
    const isSpecialLanguage = !!language && !EXTS_CODE.has(ext) && !EXTS_PROSE.has(ext);
    const isSpecial = isSpecialCodeFile(baseName) || isManifest || isLock || isSpecialLanguage;
    if (minifiedNameRegex.test(baseName.toLowerCase())) {
      recordSkip(absPath, 'minified', { method: 'name' });
      return;
    }
    if (ignoreMatcher.ignores(relPosix)) {
      recordSkip(absPath, 'ignored');
      return;
    }
    let stat;
    try {
      stat = await fs.lstat(absPath);
    } catch {
      recordSkip(absPath, 'stat-failed');
      return;
    }
    if (stat.isSymbolicLink()) {
      recordSkip(absPath, 'symlink');
      return;
    }
    const maxBytesForExt = resolveMaxBytesForExt(ext);
    if (maxBytesForExt && stat.size > maxBytesForExt) {
      recordSkip(absPath, 'oversize', { bytes: stat.size, maxBytes: maxBytesForExt });
      return;
    }
    const record = inRecordsRoot
      ? { source: 'triage', recordType: 'record', reason: 'records-dir' }
      : (recordsClassifier
        ? recordsClassifier.classify({ absPath, relPath: relPosix, ext })
        : null);
    if (maxFilesValue && entries.length >= maxFilesValue) {
      maxFilesReached = true;
      recordSkip(absPath, 'max-files', { maxFiles: maxFilesValue });
      return;
    }
    entries.push({
      abs: absPath,
      rel: relPosix,
      stat,
      ext,
      isSpecial,
      isManifest,
      isLock,
      ...(record ? { record } : {})
    });
    if (maxFilesValue && entries.length >= maxFilesValue) {
      maxFilesReached = true;
    }
  };
  const workerCount = Math.min(statConcurrency, candidates.length || 0);
  if (!workerCount) {
    // no candidates
  } else {
    let cursor = 0;
    const workers = Array.from({ length: workerCount }, () => (async () => {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= candidates.length) break;
        await processCandidate(candidates[idx]);
      }
    })());
    await Promise.all(workers);
  }

  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  skippedCommon.sort((a, b) => {
    const fileA = String(a?.file || '');
    const fileB = String(b?.file || '');
    if (fileA < fileB) return -1;
    if (fileA > fileB) return 1;
    const reasonA = String(a?.reason || '');
    const reasonB = String(b?.reason || '');
    if (reasonA < reasonB) return -1;
    if (reasonA > reasonB) return 1;
    return 0;
  });
  return { entries, skippedCommon };
}

function filterEntriesByMode(entries, mode, skippedFiles) {
  const output = [];
  for (const entry of entries) {
    if (entry.record) {
      if (mode === 'records') {
        output.push({
          abs: entry.abs,
          rel: entry.rel,
          stat: entry.stat,
          ...(entry.record ? { record: entry.record } : {})
        });
      } else if (skippedFiles) {
        skippedFiles.push({
          file: entry.abs,
          reason: 'records',
          recordType: entry.record.recordType || null
        });
      }
      continue;
    }
    if (mode === 'records') {
      if (skippedFiles) skippedFiles.push({ file: entry.abs, reason: 'unsupported' });
      continue;
    }
    const isProse = mode === 'prose';
    const isCode = mode === 'code' || mode === 'extracted-prose';
    const allowed = (isProse && EXTS_PROSE.has(entry.ext))
      || (isCode && (EXTS_CODE.has(entry.ext) || entry.isSpecial))
      || (mode === 'extracted-prose' && EXTS_PROSE.has(entry.ext));
    if (!allowed) {
      if (skippedFiles) skippedFiles.push({ file: entry.abs, reason: 'unsupported' });
      continue;
    }
    output.push({ abs: entry.abs, rel: entry.rel, stat: entry.stat });
  }
  return output;
}
