import { resolveCallArguments } from '../../../../contracts/call-arguments.js';
import { createCallSiteSemanticRefResolver, unavailableCallSiteSemanticRef } from './call-site-semantic-refs.js';
import { mergeRunsWithPlanner, readJsonlRows } from '../../../../shared/merge.js';
import { throwIfAborted } from '../../../../shared/abort.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFileAsync } from '../../../../shared/json-stream/jsonl-write.js';
import { writeJsonLinesShardedAsync } from '../../../../shared/json-stream/jsonl-sharded.js';
import { sha1 } from '../../../../shared/hash.js';
import { fromPosix } from '../../../../shared/file-paths.js';
import { buildCallSiteId } from '../../../callsite-id.js';
import {
  createOffsetsMeta,
  createRowSpillCollector,
  createTrimStats,
  recordArtifactTelemetry,
  recordTrimStats
} from '../helpers.js';
import { applyByteBudget } from '../../byte-budget.js';
import { buildTrimMetadata, TRIM_REASONS } from '../trim-policy.js';
import {
  buildJsonlVariantPaths,
  buildShardedPartEntries,
  removeArtifacts,
  resolveJsonlExtension,
  writeShardedJsonlMeta
} from './_common.js';

const MAX_ARGS_PER_CALL = 5;
const MAX_ARG_TEXT_LEN = 80;
const MAX_EVIDENCE_ITEMS = 6;
const MAX_EVIDENCE_LEN = 32;
const MAX_ROW_BYTES = 32768;
const measureRowBytes = (row) => (
  Buffer.byteLength(JSON.stringify(row), 'utf8') + 1
);

const normalizePathIdentity = value => typeof value === 'string' && value.length ? value : null;

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
};

const truncateText = (value, limit) => {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
};

const deriveCalleeNormalized = (calleeRaw) => {
  const normalized = normalizeText(calleeRaw);
  if (!normalized) return '';
  const flattened = normalized.replace(/\?\./g, '.').replace(/::/g, '.');
  const parts = flattened.split('.').filter(Boolean);
  if (!parts.length) return normalized;
  return parts[parts.length - 1];
};

const normalizeArgs = (args) => {
  if (!Array.isArray(args)) return [];
  const output = [];
  for (const arg of args) {
    if (output.length >= MAX_ARGS_PER_CALL) break;
    const normalized = truncateText(arg, MAX_ARG_TEXT_LEN);
    if (normalized) output.push(normalized);
  }
  return output;
};

const normalizeEvidence = (evidence) => {
  if (!Array.isArray(evidence)) return [];
  const output = [];
  for (const item of evidence) {
    if (output.length >= MAX_EVIDENCE_ITEMS) break;
    const normalized = truncateText(item, MAX_EVIDENCE_LEN);
    if (normalized) output.push(normalized);
  }
  return output;
};

const buildSnippetHash = (calleeRaw, args) => {
  const base = `${calleeRaw || ''}(${(args || []).join(',')})`.trim();
  if (!base) return null;
  return `sha1:${sha1(base)}`;
};

const maybeTrimRow = (row) => {
  const byteLength = measureRowBytes(row);
  if (byteLength <= MAX_ROW_BYTES) {
    return { row, trimmed: false, trimReasons: [] };
  }
  const trimReasons = [TRIM_REASONS.rowOversize];
  const trimmed = { ...row };
  if (Array.isArray(trimmed.args) && trimmed.args.length) {
    trimmed.args = [];
    trimReasons.push(TRIM_REASONS.callSitesClearArgs);
  }
  if (Array.isArray(trimmed.evidence) && trimmed.evidence.length) {
    trimmed.evidence = [];
    trimReasons.push(TRIM_REASONS.callSitesClearEvidence);
  }
  if (trimmed.kwargs) {
    trimmed.kwargs = null;
    trimReasons.push(TRIM_REASONS.callSitesClearKwargs);
  }
  if (trimmed.snippetHash) {
    trimmed.snippetHash = null;
    trimReasons.push(TRIM_REASONS.callSitesClearSnippetHash);
  }
  const nextBytes = measureRowBytes(trimmed);
  if (nextBytes <= MAX_ROW_BYTES) return { row: trimmed, trimmed: true, trimReasons };
  return {
    row: null,
    trimmed: false,
    trimReasons: [...trimReasons, TRIM_REASONS.dropRowOverBudget]
  };
};

const buildCallSiteRow = ({ chunk, detail, stats, semanticRef = null }) => {
  const calleeRaw = detail.source === 'tree-sitter' && typeof detail.calleeRaw === 'string'
    ? detail.calleeRaw : normalizeText(detail.calleeRaw || detail.callee);
  const calleeNormalized = normalizeText(detail.calleeNormalized) || deriveCalleeNormalized(calleeRaw);
  const file = normalizePathIdentity(chunk.file);
  const start = Number.isFinite(detail.start) ? detail.start : null;
  const end = Number.isFinite(detail.end) ? detail.end : null;
  const startLine = Number.isFinite(detail.startLine) ? detail.startLine : null;
  const startCol = Number.isFinite(detail.startCol) ? detail.startCol : null;
  const endLine = Number.isFinite(detail.endLine) ? detail.endLine : null;
  const endCol = Number.isFinite(detail.endCol) ? detail.endCol : null;
  const invalid = () => {
    if (detail.source === 'tree-sitter') {
      throw Object.assign(new Error('Syntax call occurrence cannot satisfy canonical call-site identity.'),
        { code: 'ERR_SYNTAX_CALL_SITE_INVALID', file, start, end });
    }
    recordTrimStats(stats, { dropped: true, trimReasons: [TRIM_REASONS.dropRequiredFields] });
    return null;
  };
  if (!file || !calleeRaw || !calleeNormalized || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end < start) return invalid();
  if ([startLine, startCol, endLine, endCol].some(value => !Number.isSafeInteger(value) || value < 1)
    || endLine < startLine || (endLine === startLine && endCol < startCol)) {
    return invalid();
  }
  const args = normalizeArgs(detail.args);
  const evidence = normalizeEvidence(detail.evidence);
  const callSiteId = buildCallSiteId({ file, startLine, startCol, endLine, endCol, calleeRaw });
  if (!callSiteId) return invalid();
  const row = {
    callSiteId,
    callerChunkUid: normalizeText(chunk.chunkUid || chunk.metaV2?.chunkUid) || null,
    callerDocId: Number.isFinite(chunk.id) ? chunk.id : null,
    file,
    languageId: normalizeText(chunk.metaV2?.lang || chunk.lang) || null,
    segmentId: normalizeText(chunk.segment?.segmentId || chunk.metaV2?.segment?.segmentId) || null,
    start,
    end,
    startLine,
    startCol,
    endLine,
    endCol,
    calleeRaw,
    calleeNormalized,
    receiver: normalizeText(detail.receiver) || null,
    args,
    kwargs: detail.kwargs && typeof detail.kwargs === 'object' ? detail.kwargs : null,
    confidence: Number.isFinite(detail.confidence) ? detail.confidence : null,
    evidence,
    targetChunkUid: normalizeText(detail.targetChunkUid) || null,
    targetDocId: Number.isFinite(detail.targetDocId) ? detail.targetDocId : null,
    targetCandidates: Array.isArray(detail.targetCandidates) ? detail.targetCandidates.filter(Boolean) : [],
    snippetHash: detail.snippetHash || buildSnippetHash(calleeRaw, args)
  };
  if (detail.source === 'tree-sitter' && detail.coordinateSystem === 'utf16') {
    const status = detail.calleeRef?.status || (row.targetChunkUid ? 'resolved' : detail.resolution);
    row.extensions = { syntax: {
      producer: 'tree-sitter', coordinateSystem: 'utf16', role: detail.role || 'call',
      resolution: ['resolved', 'ambiguous', 'unresolved'].includes(status) ? status : 'unresolved',
      reason: status === 'resolved' ? 'source-qualified-target'
        : status === 'ambiguous' ? 'ambiguous-target'
          : detail.calleeRef?.reason || detail.reason || 'syntax-target-unresolved',
      rawPreviewTruncated: detail.rawPreviewTruncated === true
    } };
  }
  row.extensions ||= {};
  row.extensions.semanticRef = semanticRef || unavailableCallSiteSemanticRef();
  row.extensions.arguments = resolveCallArguments(detail);
  if (Array.isArray(detail.argLiterals)) row.extensions.argLiterals = detail.argLiterals.slice(0, MAX_ARGS_PER_CALL);
  const trimmedResult = maybeTrimRow(row);
  if (!trimmedResult.row) {
    if (detail.source === 'tree-sitter') {
      throw Object.assign(new Error('Syntax call occurrence exceeds canonical row budget.'),
        { code: 'ERR_SYNTAX_CALL_SITE_OVERSIZE', file, start, end });
    }
    recordTrimStats(stats, { dropped: true, trimReasons: trimmedResult.trimReasons });
    return null;
  }
  recordTrimStats(stats, {
    rowBytes: measureRowBytes(trimmedResult.row),
    trimmed: trimmedResult.trimmed,
    trimReasons: trimmedResult.trimReasons
  });
  return trimmedResult.row;
};

export const compareCallSites = (a, b) => {
  const fileCmp = String(a.file || '').localeCompare(String(b.file || ''));
  if (fileCmp) return fileCmp;
  const callerCmp = String(a.callerChunkUid || '').localeCompare(String(b.callerChunkUid || ''));
  if (callerCmp) return callerCmp;
  if (a.start !== b.start) return a.start - b.start;
  if (a.end !== b.end) return a.end - b.end;
  const calleeCmp = String(a.calleeNormalized || '').localeCompare(String(b.calleeNormalized || ''));
  if (calleeCmp) return calleeCmp;
  return String(a.calleeRaw || '').localeCompare(String(b.calleeRaw || ''));
};

function* iterateCallSites(chunks, stats) {
  for (const chunk of chunks || []) {
    for (const detail of chunk?.codeRelations?.callDetails || []) {
      if (!detail || typeof detail !== 'object') {
        recordTrimStats(stats, { dropped: true, trimReasons: [TRIM_REASONS.dropRequiredFields] });
        continue;
      }
      const row = buildCallSiteRow({ chunk, detail, stats });
      if (row) yield row;
    }
  }
}

// Small in-memory callers retain the canonical comparator and row normalization.
export const createCallSites = ({ chunks, stats = null } = {}) =>
  [...iterateCallSites(chunks, stats)].sort(compareCallSites);

const collectCallSites = async ({ state, chunks, outDir, buildRoot, buildId, maxJsonBytes, abortSignal, maxBufferBytes, maxBufferRows }) => {
  const stats = createTrimStats();
  const spillStats = createTrimStats();
  const collector = createRowSpillCollector({ outDir, runPrefix: 'call_sites', compare: compareCallSites,
    maxJsonBytes, maxBufferBytes, maxBufferRows, stats: spillStats });
  const semanticRefs = createCallSiteSemanticRefResolver({ state, outDir, buildRoot, buildId, signal: abortSignal });
  stats.semanticReferences = { available: 0, unavailable: 0 };
  for (const chunk of chunks || []) {
    if (!chunk?.codeRelations?.callDetails?.length) continue;
    await semanticRefs.withChunk(chunk, async resolveRef => {
      for (const detail of chunk.codeRelations.callDetails) {
        throwIfAborted(abortSignal);
        if (!detail || typeof detail !== 'object') {
          recordTrimStats(stats, { dropped: true, trimReasons: [TRIM_REASONS.dropRequiredFields] });
          continue;
        }
        const semanticRef = await resolveRef(detail);
        const row = buildCallSiteRow({ chunk, detail, stats, semanticRef });
        if (row) {
          stats.semanticReferences[semanticRef.status] += 1;
          // Await each spill before admitting another bounded row.
          await collector.append(row);
        }
      }
    });
  }
  throwIfAborted(abortSignal);
  const collected = await collector.finalize();
  Object.assign(stats, { runsSpilled: spillStats.runsSpilled, spillBytes: spillStats.spillBytes });
  return { ...collected, stats };
};

export const enqueueCallSitesArtifacts = async ({
  state,
  outDir,
  buildRoot = null,
  buildId = null,
  abortSignal = null,
  spillBufferBytes = 2 * 1024 * 1024,
  spillBufferRows = 5000,
  maxJsonBytes = null,
  byteBudget = null,
  compression = null,
  gzipOptions = null,
  forceEmpty = false,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  log = null,
  stageCheckpoints
}) => {
  throwIfAborted(abortSignal);
  const resolvedMaxBytes = Number.isFinite(Number(maxJsonBytes)) ? Math.max(0, Math.floor(Number(maxJsonBytes))) : 0;
  const collected = await collectCallSites({ state, chunks: state?.chunks || [], outDir, buildRoot, buildId,
    maxJsonBytes: resolvedMaxBytes, abortSignal,
    maxBufferBytes: Math.min(2 * 1024 * 1024, Math.max(1, spillBufferBytes)),
    maxBufferRows: Math.min(5000, Math.max(1, spillBufferRows)) });
  const { stats } = collected;
  const totalRows = stats.totalRows;
  if (state) state.callSitesCoverage = { schemaVersion: 1,
    status: stats.droppedRows ? 'incomplete' : 'complete', emitted: totalRows,
    dropped: stats.droppedRows, trimmed: stats.trimmedRows, semanticReferences: stats.semanticReferences };
  if (!totalRows && !forceEmpty) { await collected.cleanup(); return null; }
  const totalBytes = stats.totalBytes, maxLineBytes = stats.maxRowBytes;
  const withRows = async write => {
    let merged = null;
    try {
      throwIfAborted(abortSignal);
      const readRun = async function* (file) {
        for await (const row of readJsonlRows(file)) { throwIfAborted(abortSignal); yield row; }
      };
      if (collected.runs) {
        merged = await mergeRunsWithPlanner({ runs: collected.runs,
          outputPath: path.join(outDir, 'call_sites.runs', 'ordered.jsonl'),
          tempDir: path.join(outDir, 'call_sites.runs'), runPrefix: 'call_sites-merge',
          checkpointPath: path.join(outDir, 'call_sites.runs', 'merge-checkpoint.json'),
          compare: compareCallSites, compareId: 'call-sites-canonical-v2',
          plannerInputKey: 'call-sites-canonical-v2', readRun, maxOpenRuns: 32, validateComparator: true });
      }
      const rows = merged ? readRun(merged.outputPath) : (async function* () {
        for (const row of collected.rows) { throwIfAborted(abortSignal); yield row; }
      })();
      const result = await write(rows);
      await merged?.cleanup();
      await collected.cleanup();
      return result;
    } catch (error) {
      // Retain input-bound runs/checkpoints for the failed candidate. Publication
      // cannot complete; the existing planner validates every input on replay.
      if (state?.callSitesCoverage) Object.assign(state.callSitesCoverage, { status: 'incomplete',
        reason: error?.code || 'call-site-write-failed' });
      throw error;
    }
  };
  const trimMetadata = buildTrimMetadata(stats);
  const jsonlExtension = resolveJsonlExtension(compression);
  const callSitesPath = path.join(outDir, `call_sites.${jsonlExtension}`);
  const callSitesMetaPath = path.join(outDir, 'call_sites.meta.json');
  const callSitesPartsDir = path.join(outDir, 'call_sites.parts');
  const offsetsConfig = compression ? null : { suffix: 'offsets.bin' };
  const offsetsPath = offsetsConfig ? `${callSitesPath}.${offsetsConfig.suffix}` : null;

  const removeJsonlVariants = async () => removeArtifacts(
    buildJsonlVariantPaths({ outDir, baseName: 'call_sites', includeOffsets: true })
  );

  if (resolvedMaxBytes && maxLineBytes > resolvedMaxBytes) {
    throw new Error(`call_sites row exceeds max JSON size (${maxLineBytes} bytes).`);
  }
  const useShards = resolvedMaxBytes && totalBytes > resolvedMaxBytes;
  const budgetInfo = applyByteBudget({
    budget: byteBudget,
    totalBytes,
    label: 'call_sites',
    stageCheckpoints,
    logger: log
  });
  recordArtifactTelemetry(stageCheckpoints, {
    stage: 'stage2',
    artifact: 'call_sites',
    rows: totalRows,
    bytes: totalBytes,
    maxRowBytes: Math.max(maxLineBytes, stats.maxRowBytes || 0),
    trimmedRows: stats.trimmedRows || 0,
    droppedRows: stats.droppedRows || 0,
    extra: {
      format: useShards ? 'jsonl-sharded' : 'jsonl',
      budget: budgetInfo,
      trim: trimMetadata
    }
  });
  if (!useShards) {
    enqueueWrite(
      formatArtifactLabel(callSitesPath),
      async () => {
        await removeJsonlVariants();
        await fs.rm(callSitesMetaPath, { force: true });
        await fs.rm(callSitesPartsDir, { recursive: true, force: true });
        await withRows(rows => writeJsonLinesFileAsync(callSitesPath, rows, {
          atomic: true,
          compression,
          gzipOptions,
          offsets: offsetsPath ? { path: offsetsPath, atomic: true } : null,
          maxBytes: resolvedMaxBytes || null,
          signal: abortSignal
        }));
      }
    );
    addPieceFile({
      type: 'relations',
      name: 'call_sites',
      format: 'jsonl',
      count: totalRows,
      compression: compression || null
    }, callSitesPath);
    if (offsetsPath) {
      addPieceFile({
        type: 'relations',
        name: 'call_sites_offsets',
        format: 'bin',
        count: totalRows
      }, offsetsPath);
    }
    return {
      name: 'call_sites',
      format: 'jsonl',
      sharded: false,
      entrypoint: formatArtifactLabel(callSitesPath),
      totalEntries: totalRows
    };
  }

  if (log) {
    log(`call_sites ~${Math.round(totalBytes / 1024)}KB; writing JSONL shards.`);
  }

  enqueueWrite(
    formatArtifactLabel(callSitesMetaPath),
    async () => {
      await removeJsonlVariants();
      const result = await withRows(async rows => {
        return writeJsonLinesShardedAsync({
          dir: outDir,
          partsDirName: 'call_sites.parts',
          partPrefix: 'call_sites.part-',
          items: rows,
          maxBytes: resolvedMaxBytes,
          atomic: true,
          compression,
          gzipOptions,
          offsets: offsetsConfig,
          signal: abortSignal
        });
      });
      const parts = buildShardedPartEntries(result);
      const offsetsMeta = createOffsetsMeta({
        suffix: offsetsConfig?.suffix || null,
        parts: result.offsets,
        compression: 'none'
      });
      await writeShardedJsonlMeta({
        metaPath: callSitesMetaPath,
        artifact: 'call_sites',
        compression,
        result,
        parts,
        extensions: {
          trim: trimMetadata,
          ...(offsetsMeta ? { offsets: offsetsMeta } : {})
        }
      });
      for (let i = 0; i < result.parts.length; i += 1) {
        const relPath = result.parts[i];
        const absPath = path.join(outDir, fromPosix(relPath));
        addPieceFile({
          type: 'relations',
          name: 'call_sites',
          format: 'jsonl',
          count: result.counts[i] || 0,
          compression: compression || null
        }, absPath);
      }
      if (Array.isArray(result.offsets)) {
        for (let i = 0; i < result.offsets.length; i += 1) {
          const relPath = result.offsets[i];
          if (!relPath) continue;
          const absPath = path.join(outDir, fromPosix(relPath));
          addPieceFile({
            type: 'relations',
            name: 'call_sites_offsets',
            format: 'bin',
            count: result.counts[i] || 0
          }, absPath);
        }
      }
      addPieceFile({ type: 'relations', name: 'call_sites_meta', format: 'json' }, callSitesMetaPath);
    }
  );
  return {
    name: 'call_sites',
    format: 'jsonl',
    sharded: true,
    entrypoint: formatArtifactLabel(callSitesMetaPath),
    totalEntries: totalRows
  };
};
