import fs from 'node:fs/promises';
import path from 'node:path';
import { throwIfAborted } from '../../../shared/abort.js';
import { toPosix } from '../../../shared/files.js';
import { compareStrings } from '../../../shared/sort.js';
import { writeJsonObjectFile, writeJsonLinesFile } from '../../../shared/json-stream.js';
import { readTextFileWithHash } from '../../../shared/encoding.js';
import { getLanguageForFile } from '../../language-registry.js';
import { assignSegmentUids, discoverSegments } from '../../segments.js';
import {
  resolveSegmentExt,
  resolveSegmentTokenMode,
  shouldIndexSegment
} from '../../segments/config.js';
import { buildVfsVirtualPath } from '../../tooling/vfs.js';
import { TREE_SITTER_LANGUAGE_IDS, preflightTreeSitterWasmLanguages } from '../../../lang/tree-sitter.js';
import { LANGUAGE_WASM_FILES } from '../../../lang/tree-sitter/config.js';
import { isTreeSitterEnabled } from '../../../lang/tree-sitter/options.js';
import { resolveTreeSitterLanguageForSegment } from '../file-processor/tree-sitter.js';
import { resolveTreeSitterSchedulerPaths } from './paths.js';

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);

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

  const paths = resolveTreeSitterSchedulerPaths(outDir);
  await fs.mkdir(paths.baseDir, { recursive: true });
  await fs.mkdir(paths.jobsDir, { recursive: true });

  const groups = new Map(); // wasmKey -> { wasmKey, languages:Set<string>, jobs:Array<object> }
  const requiredLanguages = new Set();
  const treeSitterOptions = { treeSitter: treeSitterConfig };
  const effectiveMode = mode;

  const sortedEntries = Array.isArray(entries) ? entries.slice() : [];
  sortedEntries.sort((a, b) => {
    const aPath = (typeof a === 'string' ? a : a?.rel) || '';
    const bPath = (typeof b === 'string' ? b : b?.rel) || '';
    return compareStrings(String(aPath), String(bPath));
  });

  for (const entry of sortedEntries) {
    throwIfAborted(abortSignal);
    if (!entry) continue;
    if (entry?.treeSitterDisabled === true) continue;
    const { abs, relKey } = resolveEntryPaths(entry, runtime.root);
    if (!abs || !relKey) continue;
    const ext = typeof entry?.ext === 'string' && entry.ext ? entry.ext : path.extname(abs);
    const langHint = getLanguageForFile(ext, relKey);
    const primaryLanguageId = langHint?.id || null;

    let text = null;
    let buffer = null;
    let stat = entry?.stat || null;
    const cached = fileTextCache?.get && relKey ? fileTextCache.get(relKey) : null;
    if (cached && typeof cached === 'object') {
      if (typeof cached.text === 'string') text = cached.text;
      if (Buffer.isBuffer(cached.buffer)) buffer = cached.buffer;
    }
    if (!text) {
      buffer = buffer || await fs.readFile(abs);
      const decoded = await readTextFileWithHash(abs, { buffer, stat });
      text = decoded.text;
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
    }

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
      throw new Error(`[tree-sitter:schedule] segment discovery failed for ${relKey}: ${message}`);
    }

    for (const segment of segments || []) {
      if (!segment) continue;
      const tokenMode = resolveSegmentTokenMode(segment);
      if (tokenMode !== 'code') continue;
      if (!shouldIndexSegment(segment, tokenMode, effectiveMode)) continue;

      const segmentExt = resolveSegmentExt(ext, segment);
      const rawLanguageId = segment.languageId || primaryLanguageId || null;
      const languageId = resolveTreeSitterLanguageForSegment(rawLanguageId, segmentExt);
      if (!languageId || !TREE_SITTER_LANG_IDS.has(languageId)) continue;
      if (!isTreeSitterEnabled(treeSitterOptions, languageId)) continue;

      const segmentText = text.slice(segment.start, segment.end);
      if (exceedsTreeSitterLimits({ text: segmentText, languageId, treeSitterConfig, log })) {
        continue;
      }

      const wasmKey = LANGUAGE_WASM_FILES[languageId] || null;
      if (!wasmKey) {
        throw new Error(`[tree-sitter:schedule] missing wasmKey for ${languageId} (${relKey}).`);
      }

      const segmentUid = segment.segmentUid || null;
      const virtualPath = buildVfsVirtualPath({
        containerPath: relKey,
        segmentUid,
        effectiveExt: segmentExt
      });

      requiredLanguages.add(languageId);
      const job = {
        schemaVersion: '1.0.0',
        virtualPath,
        wasmKey,
        languageId,
        containerPath: relKey,
        containerExt: ext,
        effectiveExt: segmentExt,
        segmentStart: segment.start,
        segmentEnd: segment.end,
        segment: segment
      };
      if (!groups.has(wasmKey)) {
        groups.set(wasmKey, { wasmKey, languages: new Set(), jobs: [] });
      }
      const group = groups.get(wasmKey);
      group.languages.add(languageId);
      group.jobs.push(job);
    }
  }

  const required = Array.from(requiredLanguages);
  required.sort(compareStrings);
  if (required.length) {
    const preflight = await preflightTreeSitterWasmLanguages(required, { log });
    if (Array.isArray(preflight?.missing) && preflight.missing.length) {
      throw new Error(`[tree-sitter:schedule] Missing WASM grammars: ${preflight.missing.join(', ')}`);
    }
  }

  const wasmKeys = Array.from(groups.keys()).sort(compareStrings);
  const groupList = wasmKeys.map((wasmKey) => {
    const group = groups.get(wasmKey);
    group.jobs.sort(sortJobs);
    return {
      wasmKey,
      languages: Array.from(group.languages).sort(compareStrings),
      jobs: group.jobs
    };
  });

  const plan = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    mode,
    outDir,
    jobs: groupList.reduce((sum, group) => sum + group.jobs.length, 0),
    wasmKeys,
    requiredLanguages: required
  };

  await writeJsonObjectFile(paths.planPath, { fields: plan, atomic: true });
  for (const group of groupList) {
    const jobPath = paths.jobPathForWasmKey(group.wasmKey);
    await writeJsonLinesFile(jobPath, group.jobs, { atomic: true, compression: null });
  }

  return { plan, groups: groupList, paths };
};
