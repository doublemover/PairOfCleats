import fs from 'node:fs/promises';
import path from 'node:path';
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
import { throwIfAborted } from '../../shared/abort.js';
import { pickMinLimit, resolveFileCaps } from './file-processor/read.js';
import { getEnvConfig } from '../../shared/env.js';
import { MINIFIED_NAME_REGEX, normalizeRoot } from './watch/shared.js';

const DOCUMENT_EXTS = new Set(['.pdf', '.docx']);
const MAX_FILES_LIMIT_REASON = 'max_files_reached';

/**
 * Recursively discover indexable files under a directory.
 * @param {{root:string,mode:'code'|'prose'|'extracted-prose',recordsDir?:string|null,ignoreMatcher:import('ignore').Ignore,skippedFiles:Array, maxFileBytes:number|null,fileCaps?:object,maxDepth?:number|null,maxFiles?:number|null}} input
 * @returns {Promise<Array<{abs:string,rel:string,stat:import('node:fs').Stats}>>}
 */
export async function discoverFiles({
  root,
  mode,
  documentExtractionConfig = null,
  recordsDir = null,
  recordsConfig = null,
  scmProvider = null,
  scmProviderImpl = null,
  scmRepoRoot = null,
  ignoreMatcher,
  skippedFiles,
  maxFileBytes = null,
  fileCaps = null,
  maxDepth = null,
  maxFiles = null,
  abortSignal = null
}) {
  const { entries, skippedCommon } = await discoverEntries({
    root,
    recordsDir,
    recordsConfig,
    scmProvider,
    scmProviderImpl,
    scmRepoRoot,
    ignoreMatcher,
    maxFileBytes,
    fileCaps,
    maxDepth,
    maxFiles,
    abortSignal
  });
  if (skippedFiles) skippedFiles.push(...skippedCommon);
  return filterEntriesByMode(entries, mode, skippedFiles, documentExtractionConfig);
}

/**
 * Discover files for multiple modes in a single traversal.
 * @param {{root:string,modes:Array<'code'|'prose'|'extracted-prose'>,recordsDir?:string|null,ignoreMatcher:import('ignore').Ignore,skippedByMode:Record<string,Array>,maxFileBytes:number|null,fileCaps?:object,maxDepth?:number|null,maxFiles?:number|null}} input
 * @returns {Promise<Record<string,Array<{abs:string,rel:string,stat:import('node:fs').Stats}>>>}
 */
export async function discoverFilesForModes({
  root,
  modes,
  documentExtractionConfig = null,
  recordsDir = null,
  recordsConfig = null,
  scmProvider = null,
  scmProviderImpl = null,
  scmRepoRoot = null,
  ignoreMatcher,
  skippedByMode,
  maxFileBytes = null,
  fileCaps = null,
  maxDepth = null,
  maxFiles = null,
  abortSignal = null
}) {
  const { entries, skippedCommon } = await discoverEntries({
    root,
    recordsDir,
    recordsConfig,
    scmProvider,
    scmProviderImpl,
    scmRepoRoot,
    ignoreMatcher,
    maxFileBytes,
    fileCaps,
    maxDepth,
    maxFiles,
    abortSignal
  });
  const output = {};
  for (const mode of modes) {
    const skipped = skippedByMode && skippedByMode[mode] ? skippedByMode[mode] : null;
    if (skipped) skipped.push(...skippedCommon);
    output[mode] = filterEntriesByMode(entries, mode, skipped, documentExtractionConfig);
  }
  return output;
}

export async function discoverEntries({
  root,
  recordsDir = null,
  recordsConfig = null,
  scmProvider = null,
  scmProviderImpl = null,
  scmRepoRoot = null,
  ignoreMatcher,
  maxFileBytes = null,
  fileCaps = null,
  maxDepth = null,
  maxFiles = null,
  abortSignal = null
}) {
  throwIfAborted(abortSignal);
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
  const resolveMaxBytesForFile = (ext, languageId) => {
    const caps = resolveFileCaps(fileCaps, ext, languageId, null);
    return pickMinLimit(maxBytes, caps.maxBytes);
  };
  const normalizedRoot = normalizeRoot(root);
  const normalizedRecordsRoot = recordsDir ? normalizeRoot(recordsDir) : null;
  const recordsRoot = normalizedRecordsRoot
    && (normalizedRecordsRoot === normalizedRoot
      || normalizedRecordsRoot.startsWith(`${normalizedRoot}${path.sep}`))
    ? normalizedRecordsRoot
    : null;
  const normalizedRepoRoot = scmRepoRoot ? normalizeRoot(scmRepoRoot) : null;
  const rootRel = normalizedRepoRoot
    ? (normalizedRoot === normalizedRepoRoot
      ? ''
      : (normalizedRoot.startsWith(`${normalizedRepoRoot}${path.sep}`)
        ? path.relative(scmRepoRoot, root)
        : null))
    : null;
  const recordsClassifier = createRecordsClassifier({ root, config: recordsConfig });
  const listScmFiles = async () => {
    if (!scmProviderImpl || scmProvider === 'none') return null;
    if (!scmRepoRoot || !normalizedRepoRoot) return null;
    if (rootRel == null) return null;
    if (typeof scmProviderImpl.listTrackedFiles !== 'function') return null;
    try {
      const result = await scmProviderImpl.listTrackedFiles({
        repoRoot: scmRepoRoot,
        subdir: rootRel || null
      });
      if (result?.ok === false) return null;
      const files = Array.isArray(result?.filesPosix)
        ? result.filesPosix.filter(Boolean)
        : null;
      if (!files) return null;
      return { repoRoot: scmRepoRoot, files };
    } catch {
      return null;
    }
  };

  const listFdirFiles = async () => {
    let crawler = new fdir().withFullPaths();
    if (maxDepthValue != null) {
      crawler = crawler.withMaxDepth(maxDepthValue);
    }
    if (abortSignal) {
      crawler = crawler.withAbortSignal(abortSignal);
    }
    if (ignoreMatcher) {
      crawler = crawler.exclude((entryPath) => {
        const relPosix = toPosix(path.relative(root, entryPath));
        if (!relPosix || relPosix === '.' || relPosix.startsWith('..')) return false;
        if (path.isAbsolute(relPosix)) return false;
        return ignoreMatcher.ignores(relPosix);
      });
    }
    return crawler.crawl(root).withPromise();
  };

  const scmResult = await listScmFiles();
  const scmFiles = scmResult && Array.isArray(scmResult.files) ? scmResult.files : null;
  const candidates = scmFiles && scmFiles.length > 0
    ? scmFiles.map((rel) => path.join(scmResult.repoRoot || root, rel))
    : await listFdirFiles();

  const entries = [];
  let acceptedCount = 0;
  let reservedCount = 0;
  const envConfig = getEnvConfig();
  const statConcurrency = Math.min(
    64,
    Math.max(4, Number(envConfig.discoveryStatConcurrency) || 32)
  );
  /**
   * Acquire an in-flight reservation for a candidate.
   * Reservations are intentionally independent from accepted entries so workers
   * do not permanently drop candidates while another reservation is still
   * resolving (for example a delayed stat-failed path).
   * @returns {boolean}
   */
  const tryReserveCandidate = () => {
    if (!maxFilesValue) return true;
    if (acceptedCount >= maxFilesValue) return false;
    if (reservedCount >= maxFilesValue) return false;
    reservedCount += 1;
    return true;
  };
  const processCandidate = async (absPath) => {
    throwIfAborted(abortSignal);
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
    throwIfAborted(abortSignal);
    const baseName = path.basename(absPath);
    const ext = resolveSpecialCodeExt(baseName) || fileExt(absPath);
    const isManifest = isManifestFile(baseName);
    const isLock = isLockFile(baseName);
    const language = getLanguageForFile(ext, relPosix);
    const isSpecialLanguage = !!language && !EXTS_CODE.has(ext) && !EXTS_PROSE.has(ext);
    const isSpecial = isSpecialCodeFile(baseName) || isManifest || isLock || isSpecialLanguage;
    if (MINIFIED_NAME_REGEX.test(baseName.toLowerCase())) {
      recordSkip(absPath, 'minified', { method: 'name' });
      return;
    }
    if (path.isAbsolute(relPosix)) {
      recordSkip(absPath, 'ignored', { reason: 'absolute-rel-path' });
      return;
    }
    if (ignoreMatcher.ignores(relPosix)) {
      recordSkip(absPath, 'ignored');
      return;
    }
    try {
      let stat;
      try {
        stat = await fs.lstat(absPath);
      } catch {
        recordSkip(absPath, 'stat-failed');
        return;
      }
      throwIfAborted(abortSignal);
      if (stat.isSymbolicLink()) {
        recordSkip(absPath, 'symlink');
        return;
      }
      const maxBytesForFile = resolveMaxBytesForFile(ext, language?.id || null);
      if (maxBytesForFile && stat.size > maxBytesForFile) {
        recordSkip(absPath, 'oversize', {
          stage: 'discover',
          capSource: 'maxBytes',
          bytes: stat.size,
          maxBytes: maxBytesForFile
        });
        return;
      }
      if (maxFilesValue && acceptedCount >= maxFilesValue) {
        return;
      }
      const record = inRecordsRoot
        ? { source: 'triage', recordType: 'record', reason: 'records-dir' }
        : (recordsClassifier
          ? recordsClassifier.classify({ absPath, relPath: relPosix, ext })
          : null);
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
      acceptedCount += 1;
    } finally {
      if (maxFilesValue) {
        reservedCount = Math.max(0, reservedCount - 1);
      }
    }
  };
  const workerCount = Math.min(
    statConcurrency,
    maxFilesValue ? maxFilesValue : Number.MAX_SAFE_INTEGER,
    candidates.length || 0
  );
  if (!workerCount) {
    // no candidates
  } else {
    let cursor = 0;
    const workers = Array.from({ length: workerCount }, () => (async () => {
      while (true) {
        throwIfAborted(abortSignal);
        if (maxFilesValue && acceptedCount >= maxFilesValue) break;
        if (maxFilesValue && !tryReserveCandidate()) {
          await new Promise((resolve) => setImmediate(resolve));
          continue;
        }
        const idx = cursor;
        cursor += 1;
        if (idx >= candidates.length) {
          if (maxFilesValue) {
            reservedCount = Math.max(0, reservedCount - 1);
          }
          break;
        }
        await processCandidate(candidates[idx]);
      }
    })());
    await Promise.all(workers);
  }
  if (maxFilesValue && acceptedCount >= maxFilesValue) {
    recordSkip(root, MAX_FILES_LIMIT_REASON, { maxFiles: maxFilesValue });
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

function filterEntriesByMode(entries, mode, skippedFiles, documentExtractionConfig = null) {
  const documentExtractionEnabled = documentExtractionConfig?.enabled === true;
  const allowDocumentExt = mode === 'extracted-prose' && documentExtractionEnabled;
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
      || (mode === 'extracted-prose' && EXTS_PROSE.has(entry.ext))
      || (allowDocumentExt && DOCUMENT_EXTS.has(entry.ext));
    if (!allowed) {
      if (skippedFiles) skippedFiles.push({ file: entry.abs, reason: 'unsupported' });
      continue;
    }
    output.push({ abs: entry.abs, rel: entry.rel, stat: entry.stat });
  }
  return output;
}
