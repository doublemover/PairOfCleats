import fs from 'node:fs/promises';
import path from 'node:path';
import { throwIfAborted } from '../../../shared/abort.js';
import { toPosix } from '../../../shared/files.js';
import { buildLineIndex, offsetToLine } from '../../../shared/lines.js';
import { stringifyJsonValue } from '../../../shared/json-stream/encode.js';
import { createJsonWriteStream, writeChunk } from '../../../shared/json-stream/streams.js';
import { readTextFileWithHash } from '../../../shared/encoding.js';
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

    const resultsPath = paths.resultsPathForGrammarKey(grammarKey);
    const indexPath = paths.resultsIndexPathForGrammarKey(grammarKey);
    const { stream: resultsStream, done: resultsDone } = createJsonWriteStream(resultsPath, { atomic: true });
    const { stream: indexStream, done: indexDone } = createJsonWriteStream(indexPath, { atomic: true });

    let offset = 0;
    let wrote = 0;
    let currentFile = null;
    let currentText = null;
    let currentLineIndex = null;
    let currentFileVersionSignature = null;

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
          const decoded = await readTextFileWithHash(abs, { stat });
          currentText = decoded?.text || '';
          currentLineIndex = buildLineIndex(currentText);
          currentFileVersionSignature = createTreeSitterFileVersionSignature({
            size: stat?.size,
            mtimeMs: stat?.mtimeMs,
            hash: decoded?.hash
          });
        }

        const expectedSignature = normalizeTreeSitterFileVersionSignature(job?.fileVersionSignature);
        if (!expectedSignature || !expectedSignature.hash) {
          throw new Error(
            `[tree-sitter:schedule] stale-plan signature missing for ${containerPath}.`
          );
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
          grammarKey,
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
          grammarKey,
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
