import { performance } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import { iterateFilesystemCandidates, iterateScmCandidates } from './discovery/candidates.js';
import { createDiscoveryDirectoryInventory, forwardDiscoveryDirectoryInventory } from './discovery/directory-inventory.js';
import {
  EXTS_CODE,
  EXTS_PROSE,
  isLockFile,
  isManifestFile,
  isSpecialCodeFile,
  resolveSpecialCodeExt
} from '../constants.js';
import { getLanguageForFile } from '../language-registry.js';
import { fileExt, isRelativePathEscape, toPosix } from '../../shared/file-paths.js';
import { createRecordsClassifier } from './records.js';
import { throwIfAborted, isAbortError } from '../../shared/abort.js';
import { declaredScmFileInventory, scmFileInventoryReceipt } from '../scm/file-inventory.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { inspectGeneratedArtifact, isGeneratedArtifactCandidatePath } from '../../shared/generated-artifact.js';
import { pickMinLimit, resolveFileCaps, resolveSharedDiscoveryFileCaps } from './file-processor/read.js';
import { getEnvConfig } from '../../shared/env/runtime.js';
import { isCodeEntryForPath, isProseEntryForPath } from './mode-routing.js';
import { detectShebangLanguage } from './shebang.js';
import { isWithinRoot, toRealPath } from '../../workspace/identity.js';
import {
  buildGeneratedPolicyConfig,
  buildGeneratedPolicyDowngradePayload,
  resolveGeneratedPolicyDecision
} from './generated-policy.js';

const DOCUMENT_EXTS = new Set(['.pdf', '.docx']);
const MAX_FILES_LIMIT_REASON = 'max_files_reached';

/**
 * Recursively discover indexable files under a directory.
 * @param {{root:string,mode:'code'|'prose'|'extracted-prose',recordsDir?:string|null,ignoreMatcher:import('ignore').Ignore,skippedFiles:Array, maxFileBytes:number|null,fileCaps?:object,maxDepth?:number|null,maxFiles?:number|null}} input
 * @returns {Promise<Array<{abs:string,rel:string,stat:import('node:fs').Stats,ext:string}>>}
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
  generatedPolicy = null,
  skippedFiles,
  maxFileBytes = null,
  fileCaps = null,
  maxDepth = null,
  maxFiles = null,
  strictTraversal = false,
  abortSignal = null,
  metrics = {}
}) {
  const { entries, skippedCommon } = await discoverEntries({
    root,
    modes: [mode],
    recordsDir,
    recordsConfig,
    scmProvider,
    scmProviderImpl,
    scmRepoRoot,
    ignoreMatcher,
    generatedPolicy,
    maxFileBytes,
    fileCaps,
    maxDepth,
    maxFiles,
    strictTraversal,
    abortSignal,
    metrics
  });
  if (skippedFiles) skippedFiles.push(...skippedCommon);
  return forwardDiscoveryDirectoryInventory(entries, filterEntriesByMode(entries, mode, skippedFiles, documentExtractionConfig, fileCaps));
}

/**
 * Discover files for multiple modes in a single traversal.
 * @param {{root:string,modes:Array<'code'|'prose'|'extracted-prose'>,recordsDir?:string|null,ignoreMatcher:import('ignore').Ignore,skippedByMode:Record<string,Array>,maxFileBytes:number|null,fileCaps?:object,maxDepth?:number|null,maxFiles?:number|null}} input
 * @returns {Promise<Record<string,Array<{abs:string,rel:string,stat:import('node:fs').Stats,ext:string}>>>}
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
  generatedPolicy = null,
  skippedByMode,
  maxFileBytes = null,
  fileCaps = null,
  maxDepth = null,
  maxFiles = null,
  strictTraversal = false,
  abortSignal = null,
  metrics = {}
}) {
  const { entries, skippedCommon } = await discoverEntries({
    root,
    modes,
    recordsDir,
    recordsConfig,
    scmProvider,
    scmProviderImpl,
    scmRepoRoot,
    ignoreMatcher,
    generatedPolicy,
    maxFileBytes,
    fileCaps,
    maxDepth,
    maxFiles,
    strictTraversal,
    abortSignal,
    metrics
  });
  const output = {};
  for (const mode of modes) {
    const skipped = skippedByMode && skippedByMode[mode] ? skippedByMode[mode] : null;
    if (skipped) skipped.push(...skippedCommon);
    output[mode] = forwardDiscoveryDirectoryInventory(entries, filterEntriesByMode(entries, mode, skipped, documentExtractionConfig, fileCaps));
  }
  return output;
}

/**
 * Discover candidate files once, then reuse the result across modes.
 * A bounded candidate producer and source-order commit window enforce ignores,
 * per-file caps and deterministic accepted membership independently of stat completion order.
 *
 * @param {object} input
 * @returns {Promise<{entries:Array<object>,skippedCommon:Array<object>}>}
 */
export async function discoverEntries({
  root,
  modes = null,
  recordsDir = null,
  recordsConfig = null,
  scmProvider = null,
  scmProviderImpl = null,
  scmRepoRoot = null,
  ignoreMatcher,
  generatedPolicy = null,
  maxFileBytes = null,
  fileCaps = null,
  maxDepth = null,
  maxFiles = null,
  strictTraversal = false,
  abortSignal = null,
  metrics = {}
}) {
  const startedAt = performance.now();
  throwIfAborted(abortSignal);
  const effectiveGeneratedPolicy = generatedPolicy && typeof generatedPolicy === 'object'
    ? generatedPolicy
    : buildGeneratedPolicyConfig({});
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
    const caps = resolveSharedDiscoveryFileCaps(fileCaps, ext, languageId, modes);
    return pickMinLimit(maxBytes, caps.maxBytes);
  };
  const canonicalRoot = await toRealPath(root);
  const canonicalRecordsRoot = recordsDir ? await toRealPath(recordsDir) : null;
  const recordsRoot = canonicalRecordsRoot
    && isWithinRoot(canonicalRecordsRoot, canonicalRoot)
    ? canonicalRecordsRoot
    : null;
  const canonicalRepoRoot = scmRepoRoot ? await toRealPath(scmRepoRoot) : null;
  const rootRel = canonicalRepoRoot
    ? (isWithinRoot(canonicalRoot, canonicalRepoRoot)
      ? toPosix(path.relative(canonicalRepoRoot, canonicalRoot))
      : null)
    : null;
  const recordsClassifier = createRecordsClassifier({ root, config: recordsConfig });
  const unavailableInventory = reason => {
    metrics.scmInventory = scmFileInventoryReceipt({ provider: scmProvider || 'unknown', operation: 'tracked', reason });
    return null;
  };
  const listScmFiles = async () => {
    if (scmProvider === 'none' || (!scmProviderImpl && !scmProvider)) return null;
    if (!scmProviderImpl) return unavailableInventory('provider-unavailable');
    if (!scmRepoRoot || !canonicalRepoRoot) return unavailableInventory('repo-unavailable');
    if (rootRel == null) return unavailableInventory('outside-repo-scope');
    try {
      if (typeof scmProviderImpl.iterateTrackedFiles === 'function') {
        const result = await scmProviderImpl.iterateTrackedFiles({ repoRoot: scmRepoRoot,
          subdir: rootRel || null, signal: abortSignal });
        throwIfAborted(abortSignal);
        metrics.scmInventory = declaredScmFileInventory(result, { provider: scmProvider, operation: 'tracked' });
        if (!metrics.scmInventory.complete) return null;
        const files = result?.files || result;
        if (files && (typeof files[Symbol.asyncIterator] === 'function' || typeof files[Symbol.iterator] === 'function')) {
          metrics.source = 'scm-stream';
          return { repoRoot: scmRepoRoot, files, ordered: result?.ordering === 'utf16-lex' };
        }
        return unavailableInventory('invalid-stream-inventory');
      }
      if (typeof scmProviderImpl.listTrackedFiles !== 'function') return unavailableInventory('provider-unavailable');
      const result = await scmProviderImpl.listTrackedFiles({
        repoRoot: scmRepoRoot,
        subdir: rootRel || null,
        signal: abortSignal
      });
      throwIfAborted(abortSignal);
      metrics.scmInventory = declaredScmFileInventory(result, { provider: scmProvider, operation: 'tracked' });
      if (!metrics.scmInventory.complete) return null;
      const files = Array.isArray(result?.filesPosix)
        ? result.filesPosix
        : null;
      if (!files || files.some(entry => typeof entry !== 'string' || !entry || entry.includes('\0'))) {
        metrics.scmInventory = scmFileInventoryReceipt({ provider: scmProvider, operation: 'tracked', reason: 'invalid-path-inventory' });
        return null;
      }
      metrics.source = 'scm-legacy';
      metrics.providerMaterialized = true;
      return { repoRoot: scmRepoRoot, files, ordered: false };
    } catch (error) {
      observeStorageResource(error, { phase: 'discovery-scm-inventory' }).requireSettled();
      if (isAbortError(error)) throw error;
      throwIfAborted(abortSignal);
      metrics.scmInventory = scmFileInventoryReceipt({ provider: scmProvider, operation: 'tracked', reason: 'provider-threw' });
      return null;
    }
  };

  const scmResult = await listScmFiles();
  metrics.selectionPolicy = scmResult ? 'scm-tracked-only' : metrics.scmInventory ? 'filesystem-fallback' : 'filesystem';
  const directoryInventory = !scmResult ? createDiscoveryDirectoryInventory({ root, canonicalRoot, metrics }) : null;
  if (!scmResult) metrics.source = 'filesystem-bounded';
  const candidates = scmResult
    ? iterateScmCandidates({ files: scmResult.files, repoRoot: scmResult.repoRoot, ordered: scmResult.ordered, signal: abortSignal, metrics })
    : iterateFilesystemCandidates({ root, canonicalRoot, ignoreMatcher, maxDepth: maxDepthValue,
      strictTraversal, signal: abortSignal, metrics, directoryInventory,
      onError: (dir, error) => recordSkip(dir, 'traversal-failed', { code: error?.code || 'ERR_DISCOVERY_DIRECTORY' }) });

  throwIfAborted(abortSignal);
  const entries = [];
  let acceptedCount = 0;
  const envConfig = getEnvConfig();
  const statConcurrency = Math.min(
    64,
    Math.max(4, Number(envConfig.discoveryStatConcurrency) || 32)
  );
  const processCandidate = async (absPath) => {
    throwIfAborted(abortSignal);
    const canonicalAbs = await toRealPath(absPath);
    if (!isWithinRoot(canonicalAbs, canonicalRoot)) return;
    let relPosix = toPosix(path.relative(root, absPath));
    if (!relPosix || relPosix === '.' || isRelativePathEscape(relPosix) || path.isAbsolute(relPosix)) {
      relPosix = toPosix(path.relative(canonicalRoot, canonicalAbs));
    }
    if (!relPosix || relPosix === '.' || isRelativePathEscape(relPosix)) return;
    const inRecordsRoot = recordsRoot
      ? isWithinRoot(canonicalAbs, recordsRoot)
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
    let ext = resolveSpecialCodeExt(baseName) || fileExt(absPath);
    const isManifest = isManifestFile(baseName);
    const isLock = isLockFile(baseName);
    const preclassifiedRecord = inRecordsRoot
      ? { source: 'triage', recordType: 'record', reason: 'records-dir' }
      : (recordsClassifier
        ? recordsClassifier.classify({ absPath, relPath: relPosix, ext })
        : null);
    if (path.isAbsolute(relPosix)) {
      recordSkip(absPath, 'ignored', { reason: 'absolute-rel-path' });
      return;
    }
    if (ignoreMatcher?.ignores(relPosix)) {
      recordSkip(absPath, 'ignored');
      return;
    }
    // Record candidates (records root / include-glob / known record extensions)
    // are routed first so generated-policy heuristics do not suppress records.
    if (!preclassifiedRecord) {
      const generatedPolicyDecision = resolveGeneratedPolicyDecision({
        generatedPolicy: effectiveGeneratedPolicy,
        relPath: relPosix,
        absPath,
        baseName
      });
      if (generatedPolicyDecision?.downgrade) {
        recordSkip(absPath, generatedPolicyDecision.classification || 'generated', {
          indexMode: generatedPolicyDecision.indexMode,
          downgrade: buildGeneratedPolicyDowngradePayload(generatedPolicyDecision)
        });
        return;
      }
    }
    let stat;
    try {
      metrics.statCalls = (metrics.statCalls || 0) + 1;
      stat = await fs.lstat(absPath);
    } catch {
      metrics.statFailures = (metrics.statFailures || 0) + 1;
      recordSkip(absPath, 'stat-failed');
      return;
    }
    throwIfAborted(abortSignal);
    if (stat.isSymbolicLink()) {
      recordSkip(absPath, 'symlink');
      return;
    }
    if (!preclassifiedRecord && stat.isFile() && isGeneratedArtifactCandidatePath(relPosix)) {
      const artifact = await inspectGeneratedArtifact({ repoRoot: root, filePath: absPath, relativePath: relPosix });
      if (artifact?.action === 'omit') {
        recordSkip(absPath, 'generated-artifact', { artifactKind: artifact.kind, artifactFormat: artifact.format,
          artifactFlags: artifact.flags, action: artifact.action });
        return;
      }
    }
    let language = getLanguageForFile(ext, relPosix);
    if (!ext && !language && stat.isFile()) {
      const shebang = await detectShebangLanguage(absPath);
      if (shebang?.languageId) {
        ext = shebang.ext || ext;
        language = getLanguageForFile(ext, relPosix);
      }
    }
    const isSpecialLanguage = !!language && !EXTS_CODE.has(ext) && !EXTS_PROSE.has(ext);
    const isSpecial = isSpecialCodeFile(baseName) || isManifest || isLock || isSpecialLanguage;
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
    const record = preclassifiedRecord
      || (recordsClassifier
        ? recordsClassifier.classify({ absPath, relPath: relPosix, ext })
        : null);
    return {
      abs: absPath,
      rel: relPosix,
      stat,
      ext,
      isSpecial,
      isManifest,
      isLock,
      ...(record ? { record } : {})
    };
  };
  const pending = [];
  const iterator = candidates[Symbol.asyncIterator]();
  let exhausted = false;
  let primary = null;
  try {
    while (!maxFilesValue || acceptedCount < maxFilesValue) {
      throwIfAborted(abortSignal);
      const window = Math.min(statConcurrency, maxFilesValue ? maxFilesValue - acceptedCount : statConcurrency);
      while (!exhausted && pending.length < window) {
        const next = await iterator.next();
        if (next.done) { exhausted = true; break; }
        metrics.candidates = (metrics.candidates || 0) + 1;
        pending.push(Promise.resolve(processCandidate(next.value)).then(
          value => ({ value }), error => ({ error })
        ));
        metrics.candidateHighWater = Math.max(metrics.candidateHighWater || 0, pending.length);
      }
      if (!pending.length) break;
      const result = await pending.shift();
      if (Object.hasOwn(result, 'error')) throw result.error;
      if (result.value) {
        if (!acceptedCount) metrics.timeToFirstAcceptedMs = performance.now() - startedAt;
        entries.push(result.value); acceptedCount += 1;
      }
    }
    metrics.candidateEnumerationComplete = exhausted && !metrics.directoryErrors && !metrics.statFailures;
    metrics.coverageScope = 'filtered-candidates-only';
  } catch (error) { primary = error; throw error; }
  finally {
    const settled = await Promise.allSettled([iterator.return?.(), ...pending]);
    const closeFailure = settled.find(result => result.status === 'rejected');
    if (closeFailure) {
      if (primary && typeof primary === 'object') primary.candidateCleanupError = closeFailure.reason;
      else throw closeFailure.reason;
    }
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
  directoryInventory?.seal(entries);
  return { entries, skippedCommon, metrics };
}

/**
 * Apply mode-specific filtering to shared discovery entries.
 * @param {Array<object>} entries
 * @param {'code'|'prose'|'records'|'extracted-prose'} mode
 * @param {Array<object>|null} skippedFiles
 * @param {object|null} [documentExtractionConfig]
 * @returns {Array<object>}
 */
function filterEntriesByMode(entries, mode, skippedFiles, documentExtractionConfig = null, fileCaps = null) {
  const documentExtractionEnabled = documentExtractionConfig?.enabled === true;
  const allowDocumentExt = mode === 'extracted-prose' && documentExtractionEnabled;
  const output = [];
  for (const entry of entries) {
    const maxBytes = resolveFileCaps(fileCaps, entry.ext, getLanguageForFile(entry.ext, entry.rel)?.id || null, mode).maxBytes;
    if (maxBytes && entry.stat?.size > maxBytes) {
      skippedFiles?.push({ file: entry.abs, reason: 'oversize', bytes: entry.stat.size, maxBytes });
      continue;
    }
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
    const proseAllowed = isProseEntryForPath({ ext: entry.ext, relPath: entry.rel });
    const codeAllowed = isCodeEntryForPath({
      ext: entry.ext,
      relPath: entry.rel,
      isSpecial: entry.isSpecial
    });
    const isProse = mode === 'prose';
    const isCode = mode === 'code' || mode === 'extracted-prose';
    const allowed = (isProse && proseAllowed)
      || (isCode && codeAllowed)
      || (mode === 'extracted-prose' && proseAllowed && entry.extractedProseCandidate !== false)
      || (allowDocumentExt && DOCUMENT_EXTS.has(entry.ext));
    if (!allowed) {
      if (skippedFiles) skippedFiles.push({ file: entry.abs, reason: 'unsupported' });
      continue;
    }
    output.push({ abs: entry.abs, rel: entry.rel, stat: entry.stat, ext: entry.ext });
  }
  return output;
}
