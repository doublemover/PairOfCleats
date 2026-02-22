import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { throwIfAborted } from '../../../shared/abort.js';
import { toPosix } from '../../../shared/files.js';
import { buildLineIndex, offsetToLine } from '../../../shared/lines.js';
import { sha1 } from '../../../shared/hash.js';
import { stringifyJsonValue } from '../../../shared/json-stream/encode.js';
import { createJsonWriteStream, writeChunk } from '../../../shared/json-stream/streams.js';
import { readTextFile, readTextFileWithHash } from '../../../shared/encoding.js';
import { buildTreeSitterChunks } from '../../../lang/tree-sitter.js';
import { getNativeTreeSitterParser } from '../../../lang/tree-sitter/native-runtime.js';
import { resolveTreeSitterSchedulerPaths } from './paths.js';
import {
  createTreeSitterFileVersionSignature,
  formatTreeSitterFileVersionSignature,
  normalizeTreeSitterFileVersionSignature,
  treeSitterFileVersionSignaturesEqual
} from './file-signature.js';

const coercePosix = (value) => toPosix(String(value || ''));

const formatMemoryUsage = () => {
  const usage = process.memoryUsage();
  const toMb = (value) => (Number(value) / (1024 * 1024)).toFixed(1);
  return `rss=${toMb(usage.rss)}MB heapUsed=${toMb(usage.heapUsed)}MB ext=${toMb(usage.external)}MB ab=${toMb(usage.arrayBuffers)}MB`;
};

const attachSegmentMeta = ({
  chunk,
  segment,
  segmentUid,
  segmentExt,
  segmentStart,
  segmentEnd,
  segmentStartLine,
  segmentEndLine,
  embeddingContext
}) => {
  const adjusted = { ...chunk };
  adjusted.start = chunk.start + segmentStart;
  adjusted.end = chunk.end + segmentStart;
  if (adjusted.meta && typeof adjusted.meta === 'object') {
    if (Number.isFinite(adjusted.meta.startLine)) {
      adjusted.meta.startLine = segmentStartLine + adjusted.meta.startLine - 1;
    }
    if (Number.isFinite(adjusted.meta.endLine)) {
      adjusted.meta.endLine = segmentStartLine + adjusted.meta.endLine - 1;
    }
  }
  if (segment && segmentUid) {
    adjusted.segment = {
      segmentId: segment.segmentId,
      segmentUid,
      type: segment.type,
      languageId: segment.languageId || null,
      ext: segmentExt,
      start: segmentStart,
      end: segmentEnd,
      startLine: segmentStartLine,
      endLine: segmentEndLine,
      parentSegmentId: segment.parentSegmentId || null,
      embeddingContext
    };
  }
  return adjusted;
};

const clampPositiveInt = (value, fallback) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const resolveEscalatedParseTimeoutMs = ({
  baseTimeoutMs,
  segmentText,
  parseMode
}) => {
  const base = clampPositiveInt(baseTimeoutMs, 400);
  const text = typeof segmentText === 'string' ? segmentText : '';
  const bytes = Buffer.byteLength(text, 'utf8');
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) lines += 1;
  }
  let multiplier = 1;
  if (bytes >= (2 * 1024 * 1024) || lines >= 12000) multiplier = 4;
  else if (bytes >= (1024 * 1024) || lines >= 6000) multiplier = 3;
  else if (bytes >= (512 * 1024) || lines >= 3000) multiplier = 2;
  if (parseMode === 'lightweight-relations') multiplier = Math.max(1, Math.floor(multiplier * 0.75));
  return Math.max(base, Math.min(8000, base * multiplier));
};

const buildSchedulerCacheKey = ({
  languageId,
  parseMode,
  expectedSignature,
  segmentStart,
  segmentEnd
}) => ([
  'ts-scheduler',
  String(languageId || ''),
  String(parseMode || 'full'),
  String(expectedSignature?.hash || ''),
  String(expectedSignature?.size ?? ''),
  String(expectedSignature?.mtimeMs ?? ''),
  String(segmentStart ?? ''),
  String(segmentEnd ?? '')
].join(':'));

/**
 * Build per-job tree-sitter options for scheduler execution.
 *
 * This injects parse-mode-specific limits, stable cache-key inputs, and a
 * cache directory rooted under the repo cache when available.
 *
 * @param {object} input
 * @param {object|null} input.strictTreeSitter
 * @param {object|null} input.runtime
 * @param {(line:string)=>void|null} input.log
 * @param {{languageId?:string,parseMode?:string,segmentStart?:number,segmentEnd?:number}} input.job
 * @param {string} input.segmentText
 * @param {{hash?:string,size?:number,mtimeMs?:number}|null} input.expectedSignature
 * @returns {{treeSitter:object,treeSitterCacheKey:string,log:(line:string)=>void|null}}
 */
const buildTreeSitterOptionsForJob = ({
  strictTreeSitter,
  runtime,
  log,
  job,
  segmentText,
  expectedSignature
}) => {
  const languageId = job?.languageId || null;
  const parseMode = job?.parseMode || 'full';
  const baseConfig = strictTreeSitter && typeof strictTreeSitter === 'object'
    ? strictTreeSitter
    : {};
  const byLanguage = baseConfig.byLanguage && typeof baseConfig.byLanguage === 'object'
    ? { ...baseConfig.byLanguage }
    : {};
  const perLanguage = byLanguage[languageId] && typeof byLanguage[languageId] === 'object'
    ? { ...byLanguage[languageId] }
    : {};
  const baseParseTimeout = perLanguage.maxParseMs ?? baseConfig.maxParseMs ?? 400;
  perLanguage.maxParseMs = resolveEscalatedParseTimeoutMs({
    baseTimeoutMs: baseParseTimeout,
    segmentText,
    parseMode
  });
  if (parseMode === 'lightweight-relations') {
    perLanguage.maxChunkNodes = Math.min(clampPositiveInt(perLanguage.maxChunkNodes, 1024), 1024);
    perLanguage.maxAstNodes = Math.min(clampPositiveInt(perLanguage.maxAstNodes, 100_000), 100_000);
  }
  byLanguage[languageId] = perLanguage;
  const cacheRoot = runtime?.repoCacheRoot
    ? path.join(runtime.repoCacheRoot, 'tree-sitter-scheduler', 'chunk-cache')
    : null;
  const treeSitter = {
    ...baseConfig,
    byLanguage,
    cachePersistent: Boolean(cacheRoot),
    cachePersistentDir: cacheRoot || undefined
  };
  if (parseMode === 'lightweight-relations') {
    treeSitter.useQueries = false;
    treeSitter.adaptive = false;
    treeSitter.configChunking = false;
  }
  return {
    treeSitter,
    treeSitterCacheKey: buildSchedulerCacheKey({
      languageId,
      parseMode,
      expectedSignature,
      segmentStart: job?.segmentStart,
      segmentEnd: job?.segmentEnd
    }),
    log
  };
};

export const executeTreeSitterSchedulerPlan = async ({
  mode,
  runtime,
  groups,
  outDir,
  abortSignal = null,
  log = null
}) => {
  if (mode !== 'code') return null;
  if (!Array.isArray(groups) || !groups.length) {
    return {
      index: new Map(),
      stats: { grammarKeys: 0, jobs: 0 }
    };
  }

  const treeSitterConfig = runtime?.languageOptions?.treeSitter || null;
  const schedulerConfig = treeSitterConfig?.scheduler || {};
  const schedulerFormat = schedulerConfig?.format === 'binary-v1' ? 'binary-v1' : 'jsonl';
  const schedulerStore = schedulerConfig?.store === 'paged-json' ? 'paged-json' : 'rows';
  const schedulerPageCodec = schedulerConfig?.pageCodec === 'gzip' ? 'gzip' : 'none';
  const schedulerPageSize = Number.isFinite(Number(schedulerConfig?.pageSize))
    ? Math.max(8, Math.floor(Number(schedulerConfig.pageSize)))
    : 128;
  const resultsFormat = schedulerStore === 'paged-json' ? 'binary-v1' : schedulerFormat;
  const strictTreeSitter = treeSitterConfig
    ? { ...treeSitterConfig, strict: true, worker: { enabled: false }, nativeOnly: true }
    : { enabled: false };
  const treeSitterOptions = { treeSitter: strictTreeSitter, log };

  const paths = resolveTreeSitterSchedulerPaths(outDir);
  await fs.mkdir(paths.resultsDir, { recursive: true });

  const index = new Map(); // virtualPath -> { virtualPath, grammarKey, offset, bytes }
  let totalJobs = 0;

  for (const group of groups) {
    throwIfAborted(abortSignal);
    const grammarKey = group?.grammarKey || null;
    const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
    if (!grammarKey || !jobs.length) continue;
    const languages = Array.isArray(group?.languages) ? group.languages : [];
    const activationLanguageId = languages.length
      ? languages[0]
      : jobs.map((job) => job?.languageId).find((id) => typeof id === 'string' && id) || null;
    if (activationLanguageId) {
      const parser = getNativeTreeSitterParser(activationLanguageId, treeSitterOptions);
      if (!parser) {
        throw new Error(
          `[tree-sitter:schedule] parser activation failed for ${activationLanguageId} (${grammarKey}).`
        );
      }
    }

    if (log) log(`[tree-sitter:schedule] ${grammarKey}: start mem=${formatMemoryUsage()}`);

    const resultsPath = paths.resultsPathForGrammarKey(grammarKey, resultsFormat);
    const indexPath = paths.resultsIndexPathForGrammarKey(grammarKey);
    const metaPath = paths.resultsMetaPathForGrammarKey(grammarKey);
    const pageIndexPath = paths.resultsPageIndexPathForGrammarKey(grammarKey);
    // Scheduler outputs are written inside a unique per-build directory and are
    // consumed only after this subprocess completes. Avoid per-file atomic
    // rename churn here to prevent Windows temp-path races under high fan-out.
    const { stream: resultsStream, done: resultsDone } = createJsonWriteStream(resultsPath, { atomic: false });
    const { stream: indexStream, done: indexDone } = createJsonWriteStream(indexPath, { atomic: false });
    const { stream: metaStream, done: metaDone } = createJsonWriteStream(metaPath, { atomic: false });
    const pageIndexRef = schedulerStore === 'paged-json'
      ? createJsonWriteStream(pageIndexPath, { atomic: false })
      : null;
    const pageIndexStream = pageIndexRef?.stream || null;
    const pageIndexDone = pageIndexRef?.done || null;
    // Attach handlers early so stream teardown rejections are always observed.
    void resultsDone.catch(() => {});
    void indexDone.catch(() => {});
    void metaDone.catch(() => {});
    if (pageIndexDone) void pageIndexDone.catch(() => {});

    let offset = 0;
    let wrote = 0;
    let currentFile = null;
    let currentText = null;
    let currentLineIndex = null;
    let currentFileVersionSignature = null;
    const segmentMetaByKey = new Map();
    const segmentMetaRows = [];
    let pageId = 0;
    let pageRows = [];
    let pageRowMeta = [];
    const flushPage = async () => {
      if (schedulerStore !== 'paged-json') return;
      if (!pageRows.length) return;
      const rowsJson = stringifyJsonValue(pageRows);
      const rowPayload = Buffer.from(rowsJson, 'utf8');
      const pageChecksum = sha1(rowsJson).slice(0, 16);
      let pageRow = null;
      if (schedulerPageCodec === 'gzip') {
        const gz = zlib.gzipSync(rowPayload);
        pageRow = {
          schemaVersion: '1.0.0',
          grammarKey,
          pageId,
          codec: 'gzip',
          rowCount: pageRows.length,
          checksum: pageChecksum,
          data: gz.toString('base64')
        };
      } else {
        pageRow = {
          schemaVersion: '1.0.0',
          grammarKey,
          pageId,
          codec: 'none',
          rowCount: pageRows.length,
          checksum: pageChecksum,
          rows: pageRows
        };
      }
      const pageJson = stringifyJsonValue(pageRow);
      const payload = Buffer.from(pageJson, 'utf8');
      const header = Buffer.allocUnsafe(4);
      header.writeUInt32LE(payload.length, 0);
      const pageBytes = payload.length + 4;
      await writeChunk(resultsStream, header);
      await writeChunk(resultsStream, payload);
      if (pageIndexStream) {
        const pageEntry = {
          schemaVersion: '1.0.0',
          grammarKey,
          pageId,
          offset,
          bytes: pageBytes,
          rowCount: pageRows.length,
          codec: schedulerPageCodec,
          checksum: pageChecksum
        };
        await writeChunk(pageIndexStream, stringifyJsonValue(pageEntry));
        await writeChunk(pageIndexStream, '\n');
      }
      for (let i = 0; i < pageRowMeta.length; i += 1) {
        const rowMeta = pageRowMeta[i];
        const idxEntry = {
          schemaVersion: '1.0.0',
          virtualPath: rowMeta.virtualPath,
          grammarKey,
          store: 'paged-json',
          format: 'page-v1',
          page: pageId,
          row: i,
          checksum: rowMeta.checksum,
          pageOffset: offset,
          pageBytes,
          pageChecksum
        };
        await writeChunk(indexStream, stringifyJsonValue(idxEntry));
        await writeChunk(indexStream, '\n');
        index.set(rowMeta.virtualPath, idxEntry);
      }
      offset += pageBytes;
      wrote += pageRows.length;
      totalJobs += pageRows.length;
      pageRows = [];
      pageRowMeta = [];
      pageId += 1;
    };

    try {
      for (const job of jobs) {
        throwIfAborted(abortSignal);
        const virtualPath = job?.virtualPath || null;
        const containerPath = job?.containerPath || null;
        const containerExt = job?.containerExt || null;
        const languageId = job?.languageId || null;
        const segmentStart = Number(job?.segmentStart);
        const segmentEnd = Number(job?.segmentEnd);
        const segment = job?.segment || null;
        const segmentUid = segment?.segmentUid || null;
        const segmentExt = job?.effectiveExt || segment?.ext || containerExt || '';
        const embeddingContext = segment?.embeddingContext || segment?.meta?.embeddingContext || null;
        const expectedSignature = normalizeTreeSitterFileVersionSignature(job?.fileVersionSignature);
        if (!expectedSignature || !expectedSignature.hash) {
          throw new Error(
            `[tree-sitter:schedule] stale-plan signature missing for ${containerPath}.`
          );
        }

        if (!virtualPath || !containerPath || !languageId) {
          throw new Error(`[tree-sitter:schedule] invalid job in ${grammarKey}: missing fields`);
        }
        if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentEnd < segmentStart) {
          throw new Error(`[tree-sitter:schedule] invalid segment range for ${containerPath}`);
        }

        if (currentFile !== containerPath) {
          currentFile = containerPath;
          currentText = null;
          currentLineIndex = null;
          currentFileVersionSignature = null;
          const abs = path.join(runtime.root, containerPath);
          const stat = await fs.stat(abs);
          const matchesExpectedStat = Number.isFinite(expectedSignature?.size)
            && Number.isFinite(expectedSignature?.mtimeMs)
            && Number(expectedSignature.size) === Number(stat?.size)
            && Number(expectedSignature.mtimeMs) === Number(stat?.mtimeMs);
          if (matchesExpectedStat) {
            const decoded = await readTextFile(abs, { stat });
            currentText = decoded?.text || '';
            currentFileVersionSignature = createTreeSitterFileVersionSignature({
              size: stat?.size,
              mtimeMs: stat?.mtimeMs,
              hash: expectedSignature.hash
            });
          } else {
            const decoded = await readTextFileWithHash(abs, { stat });
            currentText = decoded?.text || '';
            currentFileVersionSignature = createTreeSitterFileVersionSignature({
              size: stat?.size,
              mtimeMs: stat?.mtimeMs,
              hash: decoded?.hash
            });
          }
          currentLineIndex = buildLineIndex(currentText);
        }
        if (!treeSitterFileVersionSignaturesEqual(expectedSignature, currentFileVersionSignature)) {
          throw new Error(
            `[tree-sitter:schedule] stale plan for ${containerPath}: expected ${
              formatTreeSitterFileVersionSignature(expectedSignature)
            } got ${formatTreeSitterFileVersionSignature(currentFileVersionSignature)}.`
          );
        }

        const segmentText = currentText.slice(segmentStart, segmentEnd);
        const segmentStartLine = offsetToLine(currentLineIndex, segmentStart);
        const endOffset = segmentEnd > segmentStart ? segmentEnd - 1 : segmentStart;
        const segmentEndLine = offsetToLine(currentLineIndex, endOffset);

        const optionsForJob = buildTreeSitterOptionsForJob({
          strictTreeSitter,
          runtime,
          log,
          job,
          segmentText,
          expectedSignature
        });
        const chunks = buildTreeSitterChunks({
          text: segmentText,
          languageId,
          ext: segmentExt,
          options: optionsForJob
        });
        if (!Array.isArray(chunks) || !chunks.length) {
          // In strict mode buildTreeSitterChunks should throw on failures. If it
          // returned empty/null, treat it as a hard error to avoid silent fallback.
          throw new Error(`[tree-sitter:schedule] No tree-sitter chunks produced for ${containerPath} (${languageId}).`);
        }

        const adjusted = chunks.map((chunk) => attachSegmentMeta({
          chunk,
          segment,
          segmentUid,
          segmentExt,
          segmentStart,
          segmentEnd,
          segmentStartLine,
          segmentEndLine,
          embeddingContext
        }));
        const normalizedContainerPath = coercePosix(containerPath);
        const segmentMetaKey = [
          normalizedContainerPath,
          languageId || '',
          segmentExt || '',
          segmentUid || '',
          segment?.segmentId || '',
          Number.isFinite(segmentStart) ? String(segmentStart) : '',
          Number.isFinite(segmentEnd) ? String(segmentEnd) : ''
        ].join('|');
        let segmentRef = segmentMetaByKey.get(segmentMetaKey);
        if (!Number.isFinite(segmentRef)) {
          segmentRef = segmentMetaRows.length;
          segmentMetaByKey.set(segmentMetaKey, segmentRef);
          segmentMetaRows.push({
            schemaVersion: '1.0.0',
            segmentRef,
            containerPath: normalizedContainerPath,
            languageId,
            effectiveExt: segmentExt || null,
            segmentUid,
            segmentId: segment?.segmentId || null,
            segmentStart,
            segmentEnd
          });
        }

        const row = {
          schemaVersion: '1.1.0',
          virtualPath,
          grammarKey,
          segmentRef,
          chunks: adjusted
        };

        const line = stringifyJsonValue(row);
        const rowChecksum = sha1(line).slice(0, 16);
        if (schedulerStore === 'paged-json') {
          pageRows.push(row);
          pageRowMeta.push({
            virtualPath,
            checksum: rowChecksum
          });
          if (pageRows.length >= schedulerPageSize) {
            await flushPage();
          }
        } else {
          const payload = Buffer.from(line, 'utf8');
          let lineBytes = payload.length;
          if (schedulerFormat === 'binary-v1') {
            const header = Buffer.allocUnsafe(4);
            header.writeUInt32LE(payload.length, 0);
            await writeChunk(resultsStream, header);
            await writeChunk(resultsStream, payload);
            lineBytes += 4;
          } else {
            await writeChunk(resultsStream, line);
            await writeChunk(resultsStream, '\n');
            lineBytes += 1;
          }

          const idxEntry = {
            schemaVersion: '1.0.0',
            virtualPath,
            grammarKey,
            offset,
            bytes: lineBytes,
            format: schedulerFormat,
            checksum: rowChecksum
          };
          await writeChunk(indexStream, stringifyJsonValue(idxEntry));
          await writeChunk(indexStream, '\n');

          index.set(virtualPath, idxEntry);
          offset += lineBytes;
          wrote += 1;
          totalJobs += 1;
        }
      }
      await flushPage();
      for (const metaRow of segmentMetaRows) {
        await writeChunk(metaStream, stringifyJsonValue(metaRow));
        await writeChunk(metaStream, '\n');
      }
      resultsStream.end();
      indexStream.end();
      metaStream.end();
      if (pageIndexStream) pageIndexStream.end();
      await Promise.all(
        [resultsDone, indexDone, metaDone, pageIndexDone].filter(Boolean)
      );
    } catch (err) {
      try { resultsStream.destroy(err); } catch {}
      try { indexStream.destroy(err); } catch {}
      try { metaStream.destroy(err); } catch {}
      try { pageIndexStream?.destroy?.(err); } catch {}
      try { await resultsDone; } catch {}
      try { await indexDone; } catch {}
      try { await metaDone; } catch {}
      try { await pageIndexDone; } catch {}
      throw err;
    }

    if (log) log(`[tree-sitter:schedule] ${grammarKey}: wrote ${wrote} result rows.`);
    if (log) log(`[tree-sitter:schedule] ${grammarKey}: done mem=${formatMemoryUsage()}`);
  }

  return {
    index,
    paths,
    stats: {
      grammarKeys: Array.isArray(groups) ? groups.length : 0,
      jobs: totalJobs
    }
  };
};

export const treeSitterSchedulerExecutorInternals = Object.freeze({
  resolveEscalatedParseTimeoutMs,
  buildSchedulerCacheKey,
  buildTreeSitterOptionsForJob
});
