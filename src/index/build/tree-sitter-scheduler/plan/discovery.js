import fs from 'node:fs/promises';
import path from 'node:path';
import { throwIfAborted } from '../../../../shared/abort.js';
import { toPosix } from '../../../../shared/files.js';
import { compareStrings } from '../../../../shared/sort.js';
import { runWithConcurrency } from '../../../../shared/concurrency.js';
import {
  exceedsTreeSitterLimits as exceedsSharedTreeSitterLimits,
  resolveTreeSitterLimits
} from '../../../../shared/indexing/tree-sitter-limits.js';
import { toArray } from '../../../../shared/iterables.js';
import { readTextFileWithHash } from '../../../../shared/encoding.js';
import { TREE_SITTER_LANGUAGE_IDS } from '../../../../lang/tree-sitter.js';
import {
  preflightNativeTreeSitterGrammars,
  resolveNativeTreeSitterTarget
} from '../../../../lang/tree-sitter/native-runtime.js';
import { isTreeSitterEnabled } from '../../../../lang/tree-sitter/options.js';
import { getLanguageForFile } from '../../../language-registry.js';
import { assignSegmentUids, discoverSegments } from '../../../segments.js';
import {
  resolveSegmentExt,
  resolveSegmentTokenMode,
  shouldIndexSegment
} from '../../../segments/config.js';
import { isMinifiedName } from '../../file-scan.js';
import { buildVfsVirtualPath } from '../../../tooling/vfs.js';
import {
  isTreeSitterSchedulerLanguage,
  resolveTreeSitterLanguageForSegment
} from '../../file-processor/tree-sitter.js';
import { assertTreeSitterScheduledJobContract } from '../contracts.js';
import { estimateSegmentParseCost } from './cost-model.js';
import { MIN_ESTIMATED_PARSE_COST } from './metrics.js';

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);

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

export const resolveEntryPaths = (entry, root) => {
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

export const discoverTreeSitterSchedulerGroups = async ({
  runtime,
  entries,
  fileTextCache = null,
  abortSignal = null,
  treeSitterConfig = null,
  mode = 'code',
  strict = false,
  skipOnParseError = false,
  plannerIoConcurrency = 4,
  recordSkip = () => {},
  shouldSkipTreeSitterPlanningForPath = () => false,
  createTreeSitterFileVersionSignature
} = {}) => {
  const groups = new Map();
  const requiredNativeLanguages = new Set();
  const treeSitterOptions = { treeSitter: treeSitterConfig };

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

  const sortedEntriesWithKeys = toArray(entries).map((entry, stableIndex) => ({
    entry,
    stableIndex,
    sortKey: resolveEntrySortKey(entry)
  }));
  sortedEntriesWithKeys.sort((a, b) => {
    const sortDelta = compareStrings(a.sortKey, b.sortKey);
    if (sortDelta !== 0) return sortDelta;
    return a.stableIndex - b.stableIndex;
  });

  const entryResults = await runWithConcurrency(
    sortedEntriesWithKeys,
    plannerIoConcurrency,
    async (sortedEntry) => {
      const entry = sortedEntry?.entry;
      throwIfAborted(abortSignal);
      if (!entry) return { jobs: [], requiredLanguages: [] };
      if (entry?.treeSitterDisabled === true) return { jobs: [], requiredLanguages: [] };
      const { abs, relKey } = resolveEntryPaths(entry, runtime.root);
      if (!abs || !relKey) return { jobs: [], requiredLanguages: [] };

      let stat = null;
      try {
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
              encodingFallbackClass: decoded.encodingFallbackClass || null,
              encodingFallbackRisk: decoded.encodingFallbackRisk || null,
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
          mode,
          languageId: primaryLanguageId,
          context: null,
          segmentsConfig: runtime.segmentsConfig,
          extraSegments: []
        });
        await assignSegmentUids({
          text,
          segments,
          ext,
          mode,
          includeBaseSegments: true
        });
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
      for (const segment of toArray(segments)) {
        if (!segment) continue;
        const tokenMode = resolveSegmentTokenMode(segment);
        if (tokenMode !== 'code') continue;
        if (!shouldIndexSegment(segment, tokenMode, mode)) continue;

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
        const job = {
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
        };
        assertTreeSitterScheduledJobContract(job, { phase: 'scheduler-plan:job' });
        jobs.push(job);
      }
      return { jobs, requiredLanguages: Array.from(requiredLanguages) };
    },
    {
      signal: abortSignal,
      requireSignal: true,
      signalLabel: 'build.tree-sitter.plan.runWithConcurrency'
    }
  );

  for (const result of toArray(entryResults)) {
    throwIfAborted(abortSignal);
    if (!result) continue;
    for (const languageId of toArray(result.requiredLanguages)) {
      requiredNativeLanguages.add(languageId);
    }
    for (const job of toArray(result.jobs)) {
      const grammarKey = job.grammarKey;
      if (!groups.has(grammarKey)) {
        groups.set(grammarKey, { grammarKey, languages: new Set(), jobs: [] });
      }
      const group = groups.get(grammarKey);
      group.languages.add(job.languageId);
      group.jobs.push(job);
    }
  }

  return { groups, requiredNativeLanguages };
};

export const applyTreeSitterGrammarPreflight = ({
  groups,
  requiredNativeLanguages,
  strict = false,
  log = null
} = {}) => {
  const requiredNative = Array.from(requiredNativeLanguages || []).sort(compareStrings);
  const preflight = preflightNativeTreeSitterGrammars(requiredNative, { log });
  if (!preflight.ok) {
    const blocked = Array.from(new Set([...toArray(preflight.missing), ...toArray(preflight.unavailable)]));
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
  return { groups, requiredNative };
};
