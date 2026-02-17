import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { throwIfAborted } from '../../../shared/abort.js';
import { toPosix } from '../../../shared/files.js';
import { compareStrings } from '../../../shared/sort.js';
import { runWithConcurrency } from '../../../shared/concurrency.js';
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

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);
const PLANNER_IO_CONCURRENCY_CAP = 16;

const countLines = (text) => {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
};

const exceedsTreeSitterLimits = ({ text, languageId, treeSitterConfig, log }) => {
  const config = treeSitterConfig && typeof treeSitterConfig === 'object' ? treeSitterConfig : {};
  const perLanguage = (config.byLanguage && languageId && config.byLanguage[languageId]) || {};
  const maxBytes = perLanguage.maxBytes ?? config.maxBytes;
  const maxLines = perLanguage.maxLines ?? config.maxLines;
  if (typeof maxBytes === 'number' && maxBytes > 0) {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) {
      if (log) log(`[tree-sitter:schedule] skip ${languageId} segment: maxBytes (${bytes} > ${maxBytes})`);
      return true;
    }
  }
  if (typeof maxLines === 'number' && maxLines > 0) {
    const lines = countLines(text);
    if (lines > maxLines) {
      if (log) log(`[tree-sitter:schedule] skip ${languageId} segment: maxLines (${lines} > ${maxLines})`);
      return true;
    }
  }
  return false;
};

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

const sortJobs = (a, b) => {
  const langDelta = compareStrings(a.languageId || '', b.languageId || '');
  if (langDelta !== 0) return langDelta;
  const pathDelta = compareStrings(a.containerPath || '', b.containerPath || '');
  if (pathDelta !== 0) return pathDelta;
  const startDelta = (a.segmentStart || 0) - (b.segmentStart || 0);
  if (startDelta !== 0) return startDelta;
  const endDelta = (a.segmentEnd || 0) - (b.segmentEnd || 0);
  if (endDelta !== 0) return endDelta;
  return compareStrings(a.virtualPath || '', b.virtualPath || '');
};

const resolvePlannerIoConcurrency = (treeSitterConfig) => {
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
  return Math.max(1, Math.min(PLANNER_IO_CONCURRENCY_CAP, Math.floor(available || 1)));
};

export const buildTreeSitterSchedulerPlan = async ({
  mode,
  runtime,
  entries,
  outDir,
  fileTextCache = null,
  abortSignal = null,
  log = null
}) => {
  if (mode !== 'code') return null;
  const treeSitterConfig = runtime?.languageOptions?.treeSitter || null;
  if (!treeSitterConfig || treeSitterConfig.enabled === false) return null;
  const strict = treeSitterConfig?.strict === true;
  const skipOnParseError = runtime?.languageOptions?.skipOnParseError === true;
  const plannerIoConcurrency = resolvePlannerIoConcurrency(treeSitterConfig);

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

  const sortedEntries = Array.isArray(entries) ? entries.slice() : [];
  sortedEntries.sort((a, b) => compareStrings(resolveEntrySortKey(a), resolveEntrySortKey(b)));

  const entryResults = await runWithConcurrency(
    sortedEntries,
    plannerIoConcurrency,
    async (entry) => {
      throwIfAborted(abortSignal);
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
        if (log) {
          log(`[tree-sitter:schedule] skip ${relKey}: lstat failed (${err?.code || 'ERR'})`);
        }
        return { jobs: [], requiredLanguages: [] };
      }
      if (stat?.isSymbolicLink?.()) {
        if (log) log(`[tree-sitter:schedule] skip ${relKey}: symlink`);
        return { jobs: [], requiredLanguages: [] };
      }
      if (stat && typeof stat.isFile === 'function' && !stat.isFile()) {
        if (log) log(`[tree-sitter:schedule] skip ${relKey}: not a file`);
        return { jobs: [], requiredLanguages: [] };
      }
      if (entry?.skip) {
        const reason = entry.skip?.reason || 'skip';
        if (log) log(`[tree-sitter:schedule] skip ${relKey}: ${reason}`);
        return { jobs: [], requiredLanguages: [] };
      }
      if (entry?.scan?.skip) {
        const reason = entry.scan.skip?.reason || 'skip';
        if (log) log(`[tree-sitter:schedule] skip ${relKey}: ${reason}`);
        return { jobs: [], requiredLanguages: [] };
      }
      if (isMinifiedName(path.basename(abs))) {
        if (log) log(`[tree-sitter:schedule] skip ${relKey}: minified`);
        return { jobs: [], requiredLanguages: [] };
      }

      const ext = typeof entry?.ext === 'string' && entry.ext ? entry.ext : path.extname(abs);
      const langHint = getLanguageForFile(ext, relKey);
      const primaryLanguageId = langHint?.id || null;

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
            if (log) log(`[tree-sitter:schedule] skip ${relKey}: symlink`);
            return { jobs: [], requiredLanguages: [] };
          }
          const reason = (code === 'EACCES' || code === 'EPERM' || code === 'EISDIR')
            ? 'unreadable'
            : 'read-failure';
          if (log) log(`[tree-sitter:schedule] skip ${relKey}: ${reason} (${code || 'ERR'})`);
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
          if (log) {
            log(`[tree-sitter:schedule] skip ${relKey}: parse-error (${message})`);
          }
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
        if (exceedsTreeSitterLimits({ text: segmentText, languageId, treeSitterConfig, log })) {
          continue;
        }

        const target = resolveNativeTreeSitterTarget(languageId, segmentExt);
        if (!target) {
          if (strict) {
            throw new Error(`[tree-sitter:schedule] missing grammar target for ${languageId} (${relKey}).`);
          }
          if (log) {
            log(`[tree-sitter:schedule] skip ${languageId} segment: grammar target unavailable (${relKey})`);
          }
          continue;
        }
        const grammarKey = target.grammarKey;

        const segmentUid = segment.segmentUid || null;
        const virtualPath = buildVfsVirtualPath({
          containerPath: relKey,
          segmentUid,
          effectiveExt: segmentExt
        });

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
          fileVersionSignature,
          segment
        });
      }
      return { jobs, requiredLanguages: Array.from(requiredLanguages) };
    },
    { signal: abortSignal }
  );

  for (const result of entryResults || []) {
    throwIfAborted(abortSignal);
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
        group.jobs = group.jobs.filter((job) => !blockedSet.has(job.languageId));
        group.languages = new Set(Array.from(group.languages).filter((id) => !blockedSet.has(id)));
        if (!group.jobs.length) groups.delete(grammarKey);
      }
      if (log) {
        log(`[tree-sitter:schedule] grammar preflight unavailable; skipping languages: ${blocked.join(', ')}`);
      }
    }
  }

  const grammarKeys = Array.from(groups.keys()).sort(compareStrings);
  const groupList = grammarKeys.map((grammarKey) => {
    const group = groups.get(grammarKey);
    group.jobs.sort(sortJobs);
    return {
      grammarKey,
      languages: Array.from(group.languages).sort(compareStrings),
      jobs: group.jobs
    };
  });

  const plan = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    mode,
    repoRoot: runtime.root,
    outDir,
    jobs: groupList.reduce((sum, group) => sum + group.jobs.length, 0),
    grammarKeys,
    requiredNativeLanguages: requiredNative,
    treeSitterConfig
  };

  await writeJsonObjectFile(paths.planPath, { fields: plan, atomic: true });
  for (const group of groupList) {
    const jobPath = paths.jobPathForGrammarKey(group.grammarKey);
    await writeJsonLinesFile(jobPath, group.jobs, { atomic: true, compression: null });
  }

  return { plan, groups: groupList, paths };
};
