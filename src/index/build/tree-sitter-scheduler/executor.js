import fs from 'node:fs/promises';
import path from 'node:path';
import { throwIfAborted } from '../../../shared/abort.js';
import { toPosix } from '../../../shared/files.js';
import { buildLineIndex, offsetToLine } from '../../../shared/lines.js';
import { stringifyJsonValue } from '../../../shared/json-stream/encode.js';
import { createJsonWriteStream, writeChunk } from '../../../shared/json-stream/streams.js';
import { readTextFile } from '../../../shared/encoding.js';
import {
  preloadTreeSitterLanguages,
  pruneTreeSitterLanguages,
  resetTreeSitterParser,
  buildTreeSitterChunks
} from '../../../lang/tree-sitter.js';
import { resolveTreeSitterSchedulerPaths } from './paths.js';

const coercePosix = (value) => toPosix(String(value || ''));

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
      stats: { wasmKeys: 0, jobs: 0 }
    };
  }

  const treeSitterConfig = runtime?.languageOptions?.treeSitter || null;
  const strictTreeSitter = treeSitterConfig
    ? { ...treeSitterConfig, strict: true, worker: { enabled: false } }
    : { enabled: false };
  const treeSitterOptions = { treeSitter: strictTreeSitter, log };

  const paths = resolveTreeSitterSchedulerPaths(outDir);
  await fs.mkdir(paths.resultsDir, { recursive: true });

  const index = new Map(); // virtualPath -> { virtualPath, wasmKey, offset, bytes }
  let totalJobs = 0;

  for (const group of groups) {
    throwIfAborted(abortSignal);
    const wasmKey = group?.wasmKey || null;
    const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
    if (!wasmKey || !jobs.length) continue;

    const languages = Array.isArray(group?.languages) ? group.languages : [];
    const keepLanguages = languages.length ? languages : jobs.map((job) => job.languageId).filter(Boolean);

    // Hard reset + prune so each batch keeps memory bounded and stable.
    resetTreeSitterParser({ hard: true });
    pruneTreeSitterLanguages([], { log, onlyIfExceeds: false });

    await preloadTreeSitterLanguages(keepLanguages, {
      log,
      parallel: false,
      maxLoadedLanguages: Math.max(1, keepLanguages.length)
    });

    const resultsPath = paths.resultsPathForWasmKey(wasmKey);
    const indexPath = paths.resultsIndexPathForWasmKey(wasmKey);
    const { stream: resultsStream, done: resultsDone } = createJsonWriteStream(resultsPath, { atomic: true });
    const { stream: indexStream, done: indexDone } = createJsonWriteStream(indexPath, { atomic: true });

    let offset = 0;
    let wrote = 0;
    let currentFile = null;
    let currentText = null;
    let currentLineIndex = null;

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

        if (!virtualPath || !containerPath || !languageId) {
          throw new Error(`[tree-sitter:schedule] invalid job in ${wasmKey}: missing fields`);
        }
        if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentEnd < segmentStart) {
          throw new Error(`[tree-sitter:schedule] invalid segment range for ${containerPath}`);
        }

        if (currentFile !== containerPath) {
          currentFile = containerPath;
          currentText = null;
          currentLineIndex = null;
          const abs = path.join(runtime.root, containerPath);
          const decoded = await readTextFile(abs);
          currentText = decoded?.text || '';
          currentLineIndex = buildLineIndex(currentText);
        }

        const segmentText = currentText.slice(segmentStart, segmentEnd);
        const segmentStartLine = offsetToLine(currentLineIndex, segmentStart);
        const endOffset = segmentEnd > segmentStart ? segmentEnd - 1 : segmentStart;
        const segmentEndLine = offsetToLine(currentLineIndex, endOffset);

        const chunks = buildTreeSitterChunks({
          text: segmentText,
          languageId,
          ext: segmentExt,
          options: treeSitterOptions
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

        const row = {
          schemaVersion: '1.0.0',
          virtualPath,
          wasmKey,
          containerPath: coercePosix(containerPath),
          languageId,
          effectiveExt: segmentExt || null,
          segmentUid,
          segmentId: segment?.segmentId || null,
          segmentStart,
          segmentEnd,
          chunks: adjusted
        };

        const line = stringifyJsonValue(row);
        const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
        await writeChunk(resultsStream, line);
        await writeChunk(resultsStream, '\n');

        const idxEntry = {
          schemaVersion: '1.0.0',
          virtualPath,
          wasmKey,
          offset,
          bytes: lineBytes
        };
        await writeChunk(indexStream, stringifyJsonValue(idxEntry));
        await writeChunk(indexStream, '\n');

        index.set(virtualPath, idxEntry);
        offset += lineBytes;
        wrote += 1;
        totalJobs += 1;
      }
      resultsStream.end();
      indexStream.end();
      await Promise.all([resultsDone, indexDone]);
    } catch (err) {
      try { resultsStream.destroy(err); } catch {}
      try { indexStream.destroy(err); } catch {}
      try { await resultsDone; } catch {}
      try { await indexDone; } catch {}
      throw err;
    }

    if (log) log(`[tree-sitter:schedule] ${wasmKey}: wrote ${wrote} result rows.`);
  }

  return {
    index,
    paths,
    stats: {
      wasmKeys: Array.isArray(groups) ? groups.length : 0,
      jobs: totalJobs
    }
  };
};
