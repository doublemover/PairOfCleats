import fs from 'node:fs/promises';
import path from 'node:path';
import {
  writeJsonLinesFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
import { sha1 } from '../../../../shared/hash.js';
import { fromPosix } from '../../../../shared/files.js';
import { buildCallSiteId } from '../../../callsite-id.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../../contracts/versioning.js';

const MAX_ARGS_PER_CALL = 5;
const MAX_ARG_TEXT_LEN = 80;
const MAX_EVIDENCE_ITEMS = 6;
const MAX_EVIDENCE_LEN = 32;
const MAX_ROW_BYTES = 32768;

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
  const byteLength = Buffer.byteLength(JSON.stringify(row), 'utf8');
  if (byteLength <= MAX_ROW_BYTES) return row;
  const trimmed = { ...row };
  if (Array.isArray(trimmed.args) && trimmed.args.length) {
    trimmed.args = [];
  }
  if (Array.isArray(trimmed.evidence) && trimmed.evidence.length) {
    trimmed.evidence = [];
  }
  if (trimmed.kwargs) trimmed.kwargs = null;
  if (trimmed.snippetHash) trimmed.snippetHash = null;
  const nextBytes = Buffer.byteLength(JSON.stringify(trimmed), 'utf8');
  if (nextBytes <= MAX_ROW_BYTES) return trimmed;
  return null;
};

const buildCallSiteRow = ({ chunk, detail }) => {
  const calleeRaw = normalizeText(detail.calleeRaw || detail.callee);
  const calleeNormalized = normalizeText(detail.calleeNormalized) || deriveCalleeNormalized(calleeRaw);
  const file = normalizeText(chunk.file);
  const start = Number.isFinite(detail.start) ? detail.start : null;
  const end = Number.isFinite(detail.end) ? detail.end : null;
  const startLine = Number.isFinite(detail.startLine) ? detail.startLine : null;
  const startCol = Number.isFinite(detail.startCol) ? detail.startCol : null;
  const endLine = Number.isFinite(detail.endLine) ? detail.endLine : null;
  const endCol = Number.isFinite(detail.endCol) ? detail.endCol : null;
  if (!file || !calleeRaw || !calleeNormalized || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (!Number.isFinite(startLine) || !Number.isFinite(startCol) || !Number.isFinite(endLine) || !Number.isFinite(endCol)) {
    return null;
  }
  const args = normalizeArgs(detail.args);
  const evidence = normalizeEvidence(detail.evidence);
  const callSiteId = buildCallSiteId({ file, startLine, startCol, endLine, endCol, calleeRaw });
  if (!callSiteId) return null;
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
  return maybeTrimRow(row);
};

const sortCallSites = (rows) => {
  rows.sort((a, b) => {
    const fileCmp = String(a.file || '').localeCompare(String(b.file || ''));
    if (fileCmp) return fileCmp;
    const callerCmp = String(a.callerChunkUid || '').localeCompare(String(b.callerChunkUid || ''));
    if (callerCmp) return callerCmp;
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return a.end - b.end;
    const calleeCmp = String(a.calleeNormalized || '').localeCompare(String(b.calleeNormalized || ''));
    if (calleeCmp) return calleeCmp;
    return String(a.calleeRaw || '').localeCompare(String(b.calleeRaw || ''));
  });
  return rows;
};

export const createCallSites = ({ chunks }) => {
  const rows = [];
  for (const chunk of chunks || []) {
    const details = Array.isArray(chunk?.codeRelations?.callDetails)
      ? chunk.codeRelations.callDetails
      : [];
    if (!details.length) continue;
    for (const detail of details) {
      const row = buildCallSiteRow({ chunk, detail });
      if (row) rows.push(row);
    }
  }
  return sortCallSites(rows);
};

export const enqueueCallSitesArtifacts = ({
  state,
  outDir,
  maxJsonBytes = null,
  compression = null,
  gzipOptions = null,
  forceEmpty = false,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  log = null
}) => {
  const rows = createCallSites({ chunks: state?.chunks || [] });
  if (!rows.length && !forceEmpty) return null;

  const resolvedMaxBytes = Number.isFinite(Number(maxJsonBytes)) ? Math.floor(Number(maxJsonBytes)) : 0;
  let totalBytes = 0;
  for (const row of rows) {
    const line = JSON.stringify(row);
    totalBytes += Buffer.byteLength(line, 'utf8') + 1;
  }

  const resolveJsonlExtension = (value) => {
    if (value === 'gzip') return 'jsonl.gz';
    if (value === 'zstd') return 'jsonl.zst';
    return 'jsonl';
  };
  const jsonlExtension = resolveJsonlExtension(compression);
  const callSitesPath = path.join(outDir, `call_sites.${jsonlExtension}`);
  const callSitesMetaPath = path.join(outDir, 'call_sites.meta.json');
  const callSitesPartsDir = path.join(outDir, 'call_sites.parts');

  const removeJsonlVariants = async () => {
    await fs.rm(path.join(outDir, 'call_sites.jsonl'), { force: true });
    await fs.rm(path.join(outDir, 'call_sites.jsonl.gz'), { force: true });
    await fs.rm(path.join(outDir, 'call_sites.jsonl.zst'), { force: true });
  };

  const useShards = resolvedMaxBytes && totalBytes > resolvedMaxBytes;
  if (!useShards) {
    enqueueWrite(
      formatArtifactLabel(callSitesPath),
      async () => {
        await removeJsonlVariants();
        await fs.rm(callSitesMetaPath, { force: true });
        await fs.rm(callSitesPartsDir, { recursive: true, force: true });
        await writeJsonLinesFile(callSitesPath, rows, { atomic: true, compression, gzipOptions });
      }
    );
    addPieceFile({
      type: 'relations',
      name: 'call_sites',
      format: 'jsonl',
      count: rows.length,
      compression: compression || null
    }, callSitesPath);
    return {
      name: 'call_sites',
      format: 'jsonl',
      sharded: false,
      entrypoint: formatArtifactLabel(callSitesPath),
      totalEntries: rows.length
    };
  }

  if (log) {
    log(`call_sites ~${Math.round(totalBytes / 1024)}KB; writing JSONL shards.`);
  }

  enqueueWrite(
    formatArtifactLabel(callSitesMetaPath),
    async () => {
      await removeJsonlVariants();
      const result = await writeJsonLinesSharded({
        dir: outDir,
        partsDirName: 'call_sites.parts',
        partPrefix: 'call_sites.part-',
        items: rows,
        maxBytes: resolvedMaxBytes,
        atomic: true,
        compression,
        gzipOptions
      });
      const parts = result.parts.map((part, index) => ({
        path: part,
        records: result.counts[index] || 0,
        bytes: result.bytes[index] || 0
      }));
      await writeJsonObjectFile(callSitesMetaPath, {
        fields: {
          schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
          artifact: 'call_sites',
          format: 'jsonl-sharded',
          generatedAt: new Date().toISOString(),
          compression: compression || 'none',
          totalRecords: result.total,
          totalBytes: result.totalBytes,
          maxPartRecords: result.maxPartRecords,
          maxPartBytes: result.maxPartBytes,
          targetMaxBytes: result.targetMaxBytes,
          parts
        },
        atomic: true
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
      addPieceFile({ type: 'relations', name: 'call_sites_meta', format: 'json' }, callSitesMetaPath);
    }
  );
  return {
    name: 'call_sites',
    format: 'jsonl',
    sharded: true,
    entrypoint: formatArtifactLabel(callSitesMetaPath),
    totalEntries: rows.length
  };
};
