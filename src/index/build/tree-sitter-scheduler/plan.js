import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { coerceAbortSignal, throwIfAborted } from '../../../shared/abort.js';
import { toPosix } from '../../../shared/files.js';
import { compareStrings } from '../../../shared/sort.js';
import { runWithConcurrency } from '../../../shared/concurrency.js';
import {
  exceedsTreeSitterLimits as exceedsSharedTreeSitterLimits,
  resolveTreeSitterLimits
} from '../../../shared/indexing/tree-sitter-limits.js';
import { writeJsonObjectFile, writeJsonLinesFile } from '../../../shared/json-stream.js';
import { readTextFileWithHash } from '../../../shared/encoding.js';
import { getLanguageForFile } from '../../language-registry.js';
import { assignSegmentUids, discoverSegments } from '../../segments.js';
import {
  resolveSegmentExt,
  resolveSegmentTokenMode,
  shouldIndexSegment
} from '../../segments/config.js';
import { isMinifiedName } from '../file-scan.js';
import { buildVfsVirtualPath } from '../../tooling/vfs.js';
import { TREE_SITTER_LANGUAGE_IDS } from '../../../lang/tree-sitter.js';
import {
  preflightNativeTreeSitterGrammars,
  resolveNativeTreeSitterTarget
} from '../../../lang/tree-sitter/native-runtime.js';
import { isTreeSitterEnabled } from '../../../lang/tree-sitter/options.js';
import {
  isTreeSitterSchedulerLanguage,
  resolveTreeSitterLanguageForSegment
} from '../file-processor/tree-sitter.js';
import { resolveTreeSitterSchedulerPaths } from './paths.js';
import { createTreeSitterFileVersionSignature } from './file-signature.js';
import { shouldSkipTreeSitterPlanningForPath } from './policy.js';
import { loadTreeSitterSchedulerAdaptiveProfile } from './adaptive-profile.js';
import {
  MIN_ESTIMATED_PARSE_COST,
  summarizeBucketMetrics,
  summarizeGrammarJobs
} from './plan/metrics.js';
import {
  resolveAdaptiveBucketTargetCost,
  resolveAdaptiveBucketTargetJobs,
  resolveAdaptiveWaveTargetCost,
  resolveAdaptiveWaveTargetJobs
} from './plan/policy-normalization.js';
import { assignPathAwareBuckets } from './plan/candidate-ranking.js';
import {
  assembleGrammarGroups,
  shardGrammarGroup,
  splitGrammarBucketIntoWaves
} from './plan/assembly.js';
import {
  buildContinuousWaveExecutionOrder,
  buildLaneDiagnostics,
  buildPlanGroupArtifacts
} from './plan/execution.js';

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);
const PLANNER_IO_CONCURRENCY_CAP = 32;
const PLANNER_IO_LARGE_REPO_THRESHOLD = 20000;
const TREE_SITTER_SKIP_SAMPLE_LIMIT_DEFAULT = 3;

/**
 * Determine whether a segment exceeds planner-side tree-sitter limits.
 *
 * @param {{
 *  text:string,
 *  languageId:string,
 *  treeSitterConfig?:object|null,
 *  recordSkip?:(reason:string,buildMessage:()=>string)=>void
 * }} input
 * @returns {boolean}
 */
const exceedsTreeSitterLimits = ({ text, languageId, treeSitterConfig, recordSkip }) => {
  return exceedsSharedTreeSitterLimits({
    text,
    languageId,
    treeSitterConfig,
    onExceeded: (details = {}) => {
      if (!recordSkip) return;
      if (details.reason === 'max-bytes') {
        recordSkip('segment-max-bytes', () => (
          `[tree-sitter:schedule] skip ${languageId} segment: maxBytes (${details.bytes} > ${details.maxBytes})`
        ));
        return;
      }
      if (details.reason === 'max-lines') {
        recordSkip('segment-max-lines', () => (
          `[tree-sitter:schedule] skip ${languageId} segment: maxLines (${details.lines} > ${details.maxLines})`
        ));
      }
    }
  });
};

/**
 * Normalize input file entry into absolute path + stable relative key.
 *
 * @param {string|{abs?:string,path?:string,rel?:string}} entry
 * @param {string} root
 * @returns {{abs:string|null,relKey:string|null}}
 */
const resolveEntryPaths = (entry, root) => {
  if (typeof entry === 'string') {
    const abs = entry;
    const relKey = toPosix(path.relative(root, abs));
    return { abs, relKey };
  }
  const abs = entry?.abs || entry?.path || null;
  if (!abs) return { abs: null, relKey: null };
  const relKey = entry?.rel ? toPosix(entry.rel) : toPosix(path.relative(root, abs));
  return { abs, relKey };
};

/**
 * Check whether a char code should be counted as part of a word-like token.
 *
 * @param {number} code
 * @returns {boolean}
 */
const isWordLikeCharCode = (code) => (
  (code >= 48 && code <= 57)
  || (code >= 65 && code <= 90)
  || (code >= 97 && code <= 122)
  || code === 95
  || code === 36
);

/**
 * Check whether a char code is treated as whitespace by the segment scanner.
 *
 * @param {number} code
 * @returns {boolean}
 */
const isWhitespaceCharCode = (code) => (
  code === 9 || code === 10 || code === 13 || code === 32 || code === 12
);

/**
 * Estimate parse cost from segment content using line count and token density.
 * Token estimation uses a single pass scanner to keep planner overhead bounded.
 *
 * @param {string} text
 * @returns {{lineCount:number,tokenCount:number,tokenDensity:number,estimatedParseCost:number}}
 */
const estimateSegmentParseCost = (text) => {
  if (!text) {
    return {
      lineCount: 0,
      tokenCount: 0,
      tokenDensity: 0,
      estimatedParseCost: MIN_ESTIMATED_PARSE_COST
    };
  }
  let lineCount = 1;
  let tokenCount = 0;
  let inWord = false;
  let nonWhitespaceChars = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10) lineCount += 1;
    if (isWhitespaceCharCode(code)) {
      inWord = false;
      continue;
    }
    nonWhitespaceChars += 1;
    if (isWordLikeCharCode(code)) {
      if (!inWord) {
        tokenCount += 1;
        inWord = true;
      }
    } else {
      tokenCount += 1;
      inWord = false;
    }
  }
  const safeLineCount = Math.max(1, lineCount);
  const tokenDensity = tokenCount / safeLineCount;
  const charDensity = nonWhitespaceChars / safeLineCount;
  const tokenMultiplier = 1 + Math.min(2.5, tokenDensity / 18);
  const charMultiplier = 1 + Math.min(1.5, charDensity / 90);
  const estimatedParseCost = Math.max(
    MIN_ESTIMATED_PARSE_COST,
    Math.round(safeLineCount * ((tokenMultiplier * 0.7) + (charMultiplier * 0.3)))
  );
  return {
    lineCount: safeLineCount,
    tokenCount,
    tokenDensity,
    estimatedParseCost
  };
};

/**
 * Resolve planner I/O concurrency for scheduler plan building.
 * Uses explicit scheduler overrides when provided, otherwise derives from
 * host parallelism with an upper safety cap.
 *
 * @param {object|null|undefined} treeSitterConfig
 * @param {number} [entryCount]
 * @returns {number}
 */
const resolvePlannerIoConcurrency = (treeSitterConfig, entryCount = 0) => {
  const schedulerConfig = treeSitterConfig?.scheduler || {};
  const configuredRaw = Number(
    schedulerConfig.planIoConcurrency
      ?? schedulerConfig.plannerIoConcurrency
      ?? schedulerConfig.ioConcurrency
  );
  if (Number.isFinite(configuredRaw) && configuredRaw > 0) {
    return Math.max(1, Math.min(PLANNER_IO_CONCURRENCY_CAP, Math.floor(configuredRaw)));
  }
  const available = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : 4;
  const totalMemGb = Number.isFinite(Number(os.totalmem()))
    ? (Number(os.totalmem()) / (1024 ** 3))
    : null;
  const memoryConstrainedCap = Number.isFinite(totalMemGb) && totalMemGb > 0 && totalMemGb < 8
    ? 8
    : PLANNER_IO_CONCURRENCY_CAP;
  let resolved = Math.max(1, Math.min(memoryConstrainedCap, Math.floor(available || 1)));
  if (Number(entryCount) >= PLANNER_IO_LARGE_REPO_THRESHOLD) {
    const boosted = Math.max(resolved, Math.floor((available || 1) * 0.75));
    resolved = Math.max(1, Math.min(memoryConstrainedCap, boosted));
  }
  return resolved;
};

/**
 * Create aggregated skip logger with per-reason sampling and final summary.
 *
 * @param {{treeSitterConfig?:object|null,log?:(line:string)=>void|null}} input
 * @returns {{record:(reason:string,message:string|(()=>string))=>void,flush:()=>void}}
 */
const createSkipLogger = ({ treeSitterConfig, log }) => {
  const schedulerConfig = treeSitterConfig?.scheduler || {};
  const sampleLimitRaw = Number(
    schedulerConfig.skipLogSampleLimit
      ?? schedulerConfig.logSkipSampleLimit
      ?? schedulerConfig.skipSampleLimit
      ?? TREE_SITTER_SKIP_SAMPLE_LIMIT_DEFAULT
  );
  const sampleLimit = Number.isFinite(sampleLimitRaw) && sampleLimitRaw >= 0
    ? Math.floor(sampleLimitRaw)
    : TREE_SITTER_SKIP_SAMPLE_LIMIT_DEFAULT;
  const emitSamples = schedulerConfig.logSkips !== false;
  const counts = new Map();
  const sampleCounts = new Map();

  const record = (reason, message) => {
    const reasonKey = reason || 'unknown';
    counts.set(reasonKey, (counts.get(reasonKey) || 0) + 1);
    if (!emitSamples || !log || sampleLimit <= 0 || !message) return;
    const seen = sampleCounts.get(reasonKey) || 0;
    if (seen >= sampleLimit) return;
    const rendered = typeof message === 'function' ? message() : message;
    if (!rendered) return;
    log(rendered);
    sampleCounts.set(reasonKey, seen + 1);
  };

  const flush = () => {
    if (!log || !counts.size) return;
    for (const reasonKey of Array.from(counts.keys()).sort(compareStrings)) {
      const count = counts.get(reasonKey) || 0;
      if (!count) continue;
      const samples = sampleCounts.get(reasonKey) || 0;
      const suppressed = Math.max(0, count - samples);
      if (suppressed > 0) {
        log(`[tree-sitter:schedule] skip summary ${reasonKey}: ${count} total (${samples} sampled, ${suppressed} suppressed)`);
      } else {
        log(`[tree-sitter:schedule] skip summary ${reasonKey}: ${count} total`);
      }
    }
  };

  return { record, flush };
};

/**
 * Build scheduler planning artifacts for tree-sitter subprocess execution.
 *
 * @param {{
 *  mode:'code'|'prose'|'records'|'extracted-prose',
 *  runtime:object,
 *  entries:Array<object|string>,
 *  outDir:string,
 *  fileTextCache?:Map<string,object>|null,
 *  abortSignal?:AbortSignal|null,
 *  log?:(line:string)=>void|null
 * }} input
 * @returns {Promise<object|null>}
 */
export const buildTreeSitterSchedulerPlan = async ({
  mode,
  runtime,
  entries,
  outDir,
  fileTextCache = null,
  abortSignal = null,
  log = null
}) => {
  const effectiveAbortSignal = coerceAbortSignal(abortSignal);
  if (mode !== 'code') return null;
  const treeSitterConfig = runtime?.languageOptions?.treeSitter || null;
  if (!treeSitterConfig || treeSitterConfig.enabled === false) return null;
  const strict = treeSitterConfig?.strict === true;
  const skipOnParseError = runtime?.languageOptions?.skipOnParseError === true;
  const skipLogger = createSkipLogger({ treeSitterConfig, log });
  const recordSkip = (reason, message) => skipLogger.record(reason, message);

  const paths = resolveTreeSitterSchedulerPaths(outDir);
  await fs.mkdir(paths.baseDir, { recursive: true });
  await fs.mkdir(paths.jobsDir, { recursive: true });

  const groups = new Map(); // grammarKey -> { grammarKey, languages:Set<string>, jobs:Array<object> }
  const requiredNativeLanguages = new Set();
  const treeSitterOptions = { treeSitter: treeSitterConfig };
  const effectiveMode = mode;

  const resolveEntrySortKey = (entry) => {
    if (!entry) return '';
    if (typeof entry === 'string') return toPosix(String(entry));
    if (typeof entry?.rel === 'string' && entry.rel) return toPosix(entry.rel);
    if (typeof entry?.abs === 'string' && entry.abs) {
      return toPosix(path.relative(runtime.root, entry.abs));
    }
    const resolved = resolveEntryPaths(entry, runtime.root);
    return resolved?.relKey ? toPosix(resolved.relKey) : '';
  };

  const sortedEntriesWithKeys = Array.isArray(entries)
    ? entries.map((entry, stableIndex) => ({
      entry,
      stableIndex,
      sortKey: resolveEntrySortKey(entry)
    }))
    : [];
  sortedEntriesWithKeys.sort((a, b) => {
    const sortDelta = compareStrings(a.sortKey, b.sortKey);
    if (sortDelta !== 0) return sortDelta;
    return a.stableIndex - b.stableIndex;
  });
  const plannerIoConcurrency = resolvePlannerIoConcurrency(treeSitterConfig, sortedEntriesWithKeys.length);

  const entryResults = await runWithConcurrency(
    sortedEntriesWithKeys,
    plannerIoConcurrency,
    async (sortedEntry) => {
      const entry = sortedEntry?.entry;
      throwIfAborted(effectiveAbortSignal);
      if (!entry) return { jobs: [], requiredLanguages: [] };
      if (entry?.treeSitterDisabled === true) return { jobs: [], requiredLanguages: [] };
      const { abs, relKey } = resolveEntryPaths(entry, runtime.root);
      if (!abs || !relKey) return { jobs: [], requiredLanguages: [] };

      let stat = null;
      try {
        // Mirror file processor behavior: use lstat so we can reliably detect
        // symlinks (stat() follows them).
        stat = await fs.lstat(abs);
      } catch (err) {
        recordSkip('lstat-failed', () => (
          `[tree-sitter:schedule] skip ${relKey}: lstat failed (${err?.code || 'ERR'})`
        ));
        return { jobs: [], requiredLanguages: [] };
      }
      if (stat?.isSymbolicLink?.()) {
        recordSkip('symlink', () => `[tree-sitter:schedule] skip ${relKey}: symlink`);
        return { jobs: [], requiredLanguages: [] };
      }
      if (stat && typeof stat.isFile === 'function' && !stat.isFile()) {
        recordSkip('not-file', () => `[tree-sitter:schedule] skip ${relKey}: not a file`);
        return { jobs: [], requiredLanguages: [] };
      }
      if (entry?.skip) {
        const reason = entry.skip?.reason || 'skip';
        recordSkip('entry-skip', () => `[tree-sitter:schedule] skip ${relKey}: ${reason}`);
        return { jobs: [], requiredLanguages: [] };
      }
      if (entry?.scan?.skip) {
        const reason = entry.scan.skip?.reason || 'skip';
        recordSkip('scan-skip', () => `[tree-sitter:schedule] skip ${relKey}: ${reason}`);
        return { jobs: [], requiredLanguages: [] };
      }
      if (isMinifiedName(path.basename(abs))) {
        recordSkip('minified', () => `[tree-sitter:schedule] skip ${relKey}: minified`);
        return { jobs: [], requiredLanguages: [] };
      }

      const ext = typeof entry?.ext === 'string' && entry.ext ? entry.ext : path.extname(abs);
      const langHint = getLanguageForFile(ext, relKey);
      const primaryLanguageId = langHint?.id || null;
      if (shouldSkipTreeSitterPlanningForPath({ relKey, languageId: primaryLanguageId })) {
        recordSkip('policy', () => (
          `[tree-sitter:schedule] skip ${primaryLanguageId || 'unknown'} file: policy (${relKey})`
        ));
        return { jobs: [], requiredLanguages: [] };
      }
      const { maxBytes, maxLines } = resolveTreeSitterLimits({
        languageId: primaryLanguageId,
        treeSitterConfig
      });
      if (typeof maxBytes === 'number' && maxBytes > 0 && Number.isFinite(stat?.size) && stat.size > maxBytes) {
        recordSkip('file-max-bytes', () => (
          `[tree-sitter:schedule] skip ${primaryLanguageId || 'unknown'} file: maxBytes (${stat.size} > ${maxBytes})`
        ));
        return { jobs: [], requiredLanguages: [] };
      }
      const knownLines = Number(entry?.lines);
      if (typeof maxLines === 'number' && maxLines > 0 && Number.isFinite(knownLines) && knownLines > maxLines) {
        recordSkip('file-max-lines', () => (
          `[tree-sitter:schedule] skip ${primaryLanguageId || 'unknown'} file: maxLines (${knownLines} > ${maxLines})`
        ));
        return { jobs: [], requiredLanguages: [] };
      }

      let text = null;
      let buffer = null;
      let hash = null;
      const cached = fileTextCache?.get && relKey ? fileTextCache.get(relKey) : null;
      if (cached && typeof cached === 'object') {
        if (typeof cached.text === 'string') text = cached.text;
        if (Buffer.isBuffer(cached.buffer)) buffer = cached.buffer;
        if (typeof cached.hash === 'string' && cached.hash) hash = cached.hash;
      }
      if (!text) {
        try {
          const decoded = await readTextFileWithHash(abs, { buffer, stat });
          text = decoded.text;
          buffer = decoded.buffer;
          hash = decoded.hash;
          if (fileTextCache?.set && relKey) {
            fileTextCache.set(relKey, {
              text,
              buffer,
              hash: decoded.hash,
              size: stat?.size ?? buffer.length,
              mtimeMs: stat?.mtimeMs ?? null,
              encoding: decoded.encoding || null,
              encodingFallback: decoded.usedFallback,
              encodingConfidence: decoded.confidence
            });
          }
        } catch (err) {
          const code = err?.code || null;
          if (code === 'ERR_SYMLINK') {
            recordSkip('symlink', () => `[tree-sitter:schedule] skip ${relKey}: symlink`);
            return { jobs: [], requiredLanguages: [] };
          }
          const reason = (code === 'EACCES' || code === 'EPERM' || code === 'EISDIR')
            ? 'unreadable'
            : 'read-failure';
          recordSkip(reason, () => `[tree-sitter:schedule] skip ${relKey}: ${reason} (${code || 'ERR'})`);
          return { jobs: [], requiredLanguages: [] };
        }
      }
      if (!hash) {
        const decoded = await readTextFileWithHash(abs, { buffer, stat });
        hash = decoded.hash;
        if (!text) text = decoded.text;
        if (!buffer) buffer = decoded.buffer;
      }
      const fileVersionSignature = createTreeSitterFileVersionSignature({
        size: stat?.size,
        mtimeMs: stat?.mtimeMs,
        hash
      });

      let segments = null;
      try {
        segments = discoverSegments({
          text,
          ext,
          relPath: relKey,
          mode: effectiveMode,
          languageId: primaryLanguageId,
          context: null,
          segmentsConfig: runtime.segmentsConfig,
          extraSegments: []
        });
        await assignSegmentUids({ text, segments, ext, mode: effectiveMode });
      } catch (err) {
        const message = err?.message || String(err);
        if (skipOnParseError) {
          recordSkip('parse-error', () => `[tree-sitter:schedule] skip ${relKey}: parse-error (${message})`);
          return { jobs: [], requiredLanguages: [] };
        }
        throw new Error(`[tree-sitter:schedule] segment discovery failed for ${relKey}: ${message}`);
      }

      const jobs = [];
      const requiredLanguages = new Set();
      for (const segment of segments || []) {
        if (!segment) continue;
        const tokenMode = resolveSegmentTokenMode(segment);
        if (tokenMode !== 'code') continue;
        if (!shouldIndexSegment(segment, tokenMode, effectiveMode)) continue;

        const segmentExt = resolveSegmentExt(ext, segment);
        const rawLanguageId = segment.languageId || primaryLanguageId || null;
        const languageId = resolveTreeSitterLanguageForSegment(rawLanguageId, segmentExt);
        if (!languageId || !TREE_SITTER_LANG_IDS.has(languageId)) continue;
        if (!isTreeSitterSchedulerLanguage(languageId)) continue;
        if (!isTreeSitterEnabled(treeSitterOptions, languageId)) continue;

        const segmentText = text.slice(segment.start, segment.end);
        if (exceedsTreeSitterLimits({ text: segmentText, languageId, treeSitterConfig, recordSkip })) {
          continue;
        }

        const target = resolveNativeTreeSitterTarget(languageId, segmentExt);
        if (!target) {
          if (strict) {
            throw new Error(`[tree-sitter:schedule] missing grammar target for ${languageId} (${relKey}).`);
          }
          recordSkip('grammar-target-unavailable', () => (
            `[tree-sitter:schedule] skip ${languageId} segment: grammar target unavailable (${relKey})`
          ));
          continue;
        }
        const grammarKey = target.grammarKey;

        const segmentUid = segment.segmentUid || null;
        const virtualPath = buildVfsVirtualPath({
          containerPath: relKey,
          segmentUid,
          effectiveExt: segmentExt
        });
        const relationExtractionOnly = entry?.treeSitterRelationOnly === true
          || entry?.relationExtractionOnly === true
          || entry?.relationsOnly === true
          || segment?.meta?.relationExtractionOnly === true
          || segment?.meta?.relationOnly === true;
        const parseEstimate = estimateSegmentParseCost(segmentText);
        const estimatedParseCost = relationExtractionOnly
          ? Math.max(MIN_ESTIMATED_PARSE_COST, Math.floor(parseEstimate.estimatedParseCost * 0.75))
          : parseEstimate.estimatedParseCost;

        requiredLanguages.add(languageId);
        jobs.push({
          schemaVersion: '1.0.0',
          virtualPath,
          grammarKey,
          runtimeKind: target.runtimeKind,
          languageId,
          containerPath: relKey,
          containerExt: ext,
          effectiveExt: segmentExt,
          segmentStart: segment.start,
          segmentEnd: segment.end,
          parseMode: relationExtractionOnly ? 'lightweight-relations' : 'full',
          estimatedLineCount: parseEstimate.lineCount,
          estimatedTokenCount: parseEstimate.tokenCount,
          estimatedTokenDensity: parseEstimate.tokenDensity,
          estimatedParseCost,
          fileVersionSignature,
          segment
        });
      }
      return { jobs, requiredLanguages: Array.from(requiredLanguages) };
    },
    {
      signal: effectiveAbortSignal,
      requireSignal: true,
      signalLabel: 'build.tree-sitter.plan.runWithConcurrency'
    }
  );

  for (const result of entryResults || []) {
    throwIfAborted(effectiveAbortSignal);
    if (!result) continue;
    for (const languageId of result.requiredLanguages || []) {
      requiredNativeLanguages.add(languageId);
    }
    for (const job of result.jobs || []) {
      const grammarKey = job.grammarKey;
      if (!groups.has(grammarKey)) {
        groups.set(grammarKey, { grammarKey, languages: new Set(), jobs: [] });
      }
      const group = groups.get(grammarKey);
      group.languages.add(job.languageId);
      group.jobs.push(job);
    }
  }

  const requiredNative = Array.from(requiredNativeLanguages).sort(compareStrings);
  const preflight = preflightNativeTreeSitterGrammars(requiredNative, { log });
  if (!preflight.ok) {
    const blocked = Array.from(new Set([...(preflight.missing || []), ...(preflight.unavailable || [])]));
    if (strict) {
      const details = [
        preflight.missing?.length ? `missing=${preflight.missing.join(',')}` : null,
        preflight.unavailable?.length ? `unavailable=${preflight.unavailable.join(',')}` : null
      ].filter(Boolean).join(' ');
      throw new Error(`[tree-sitter:schedule] grammar preflight failed ${details}`.trim());
    }
    if (blocked.length) {
      const blockedSet = new Set(blocked);
      for (const [grammarKey, group] of groups.entries()) {
        let writeJobIndex = 0;
        for (let readJobIndex = 0; readJobIndex < group.jobs.length; readJobIndex += 1) {
          const job = group.jobs[readJobIndex];
          if (blockedSet.has(job.languageId)) continue;
          group.jobs[writeJobIndex] = job;
          writeJobIndex += 1;
        }
        group.jobs.length = writeJobIndex;
        for (const languageId of group.languages) {
          if (blockedSet.has(languageId)) group.languages.delete(languageId);
        }
        if (!group.jobs.length) groups.delete(grammarKey);
      }
      if (log) {
        log(`[tree-sitter:schedule] grammar preflight unavailable; skipping languages: ${blocked.join(', ')}`);
      }
    }
  }

  const { entriesByGrammarKey: observedRowsPerSecByGrammar } = await loadTreeSitterSchedulerAdaptiveProfile({
    runtime,
    treeSitterConfig,
    log
  });
  const schedulerConfig = treeSitterConfig?.scheduler || {};
  const groupList = assembleGrammarGroups({
    groupsByGrammarKey: groups,
    schedulerConfig,
    observedRowsPerSecByGrammar
  });
  const executionOrder = buildContinuousWaveExecutionOrder(groupList);
  const laneDiagnostics = buildLaneDiagnostics(groupList);
  const { finalGrammarKeys, groupMeta, totalJobs } = buildPlanGroupArtifacts(groupList);

  const plan = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    mode,
    repoRoot: runtime.root,
    repoCacheRoot: runtime?.repoCacheRoot || null,
    outDir,
    jobs: totalJobs,
    grammarKeys: finalGrammarKeys,
    executionOrder,
    groupMeta,
    laneDiagnostics,
    requiredNativeLanguages: requiredNative,
    treeSitterConfig
  };

  await writeJsonObjectFile(paths.planPath, { fields: plan, atomic: true });
  for (const group of groupList) {
    const jobPath = paths.jobPathForGrammarKey(group.grammarKey);
    await writeJsonLinesFile(jobPath, group.jobs, { atomic: true, compression: null });
  }

  skipLogger.flush();
  return { plan, groups: groupList, paths };
};

export const treeSitterSchedulerPlannerInternals = Object.freeze({
  estimateSegmentParseCost,
  summarizeGrammarJobs,
  resolveAdaptiveBucketTargetJobs,
  resolveAdaptiveWaveTargetJobs,
  resolveAdaptiveBucketTargetCost,
  resolveAdaptiveWaveTargetCost,
  assignPathAwareBuckets,
  summarizeBucketMetrics,
  shardGrammarGroup,
  splitGrammarBucketIntoWaves,
  buildContinuousWaveExecutionOrder,
  buildLaneDiagnostics
});
