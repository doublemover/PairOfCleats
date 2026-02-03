import fs from 'node:fs/promises';
import path from 'node:path';
import {
  writeJsonLinesFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
import { fromPosix } from '../../../../shared/files.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../../contracts/versioning.js';

const MAX_ROW_BYTES = 32768;

const resolveJsonlExtension = (value) => {
  if (value === 'gzip') return 'jsonl.gz';
  if (value === 'zstd') return 'jsonl.zst';
  return 'jsonl';
};

const normalizeText = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const trimSymbolRef = (ref) => {
  if (!ref || typeof ref !== 'object') return ref;
  const trimmed = { ...ref };
  if (Array.isArray(trimmed.candidates) && trimmed.candidates.length) {
    trimmed.candidates = trimmed.candidates.slice(0, Math.min(trimmed.candidates.length, 5));
  }
  if (trimmed.importHint) trimmed.importHint = null;
  return trimmed;
};

const maybeTrimRow = (row) => {
  const fits = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8') + 1 <= MAX_ROW_BYTES;
  if (fits(row)) return row;
  const trimmed = { ...row };
  if (trimmed.evidence) delete trimmed.evidence;
  if (trimmed.reason) trimmed.reason = null;
  if (Number.isFinite(trimmed.confidence)) trimmed.confidence = null;
  if (fits(trimmed)) return trimmed;
  trimmed.to = trimSymbolRef(trimmed.to);
  if (fits(trimmed)) return trimmed;
  return null;
};

const buildRows = (chunks) => {
  const rows = [];
  for (const chunk of chunks || []) {
    if (!chunk) continue;
    const meta = chunk.metaV2 || {};
    const file = normalizeText(meta.file || chunk.file);
    const chunkUid = normalizeText(meta.chunkUid || chunk.chunkUid);
    if (!file || !chunkUid) continue;
    const from = { file, chunkUid };
    const relations = chunk.codeRelations || {};
    const linkGroups = [
      Array.isArray(relations.callLinks) ? relations.callLinks : null,
      Array.isArray(relations.usageLinks) ? relations.usageLinks : null
    ];
    for (const links of linkGroups) {
      if (!links) continue;
      for (const link of links) {
        const ref = link?.to || link?.ref || null;
        if (!ref) continue;
        const row = maybeTrimRow({
          v: 1,
          type: link?.edgeKind || 'call',
          from,
          to: ref,
          confidence: Number.isFinite(link?.confidence) ? link.confidence : null,
          reason: normalizeText(link?.reason),
          evidence: link?.evidence || undefined
        });
        if (row) rows.push(row);
      }
    }
  }

  rows.sort((a, b) => {
    const fromCmp = String(a.from?.chunkUid || '').localeCompare(String(b.from?.chunkUid || ''));
    if (fromCmp) return fromCmp;
    const typeCmp = String(a.type || '').localeCompare(String(b.type || ''));
    if (typeCmp) return typeCmp;
    const nameCmp = String(a.to?.targetName || '').localeCompare(String(b.to?.targetName || ''));
    if (nameCmp) return nameCmp;
    return String(a.to?.status || '').localeCompare(String(b.to?.status || ''));
  });

  return rows;
};

const measureRows = (rows) => {
  let totalBytes = 0;
  let maxLineBytes = 0;
  for (const row of rows) {
    const line = JSON.stringify(row);
    const bytes = Buffer.byteLength(line, 'utf8') + 1;
    totalBytes += bytes;
    if (bytes > maxLineBytes) maxLineBytes = bytes;
  }
  return { totalBytes, maxLineBytes };
};

export const enqueueSymbolEdgesArtifacts = async ({
  state,
  outDir,
  maxJsonBytes = null,
  log = null,
  compression = null,
  gzipOptions = null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
}) => {
  const rows = buildRows(state?.chunks || []);
  if (!rows.length) {
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl.gz'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl.zst'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_edges.meta.json'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_edges.parts'), { recursive: true, force: true }).catch(() => {});
    return;
  }

  const measurement = measureRows(rows);
  if (maxJsonBytes && measurement.maxLineBytes > maxJsonBytes) {
    throw new Error(`symbol_edges row exceeds max JSON size (${measurement.maxLineBytes} bytes).`);
  }
  const useShards = maxJsonBytes && measurement.totalBytes > maxJsonBytes;
  const jsonlExtension = resolveJsonlExtension(compression);
  const edgesPath = path.join(outDir, `symbol_edges.${jsonlExtension}`);
  const edgesMetaPath = path.join(outDir, 'symbol_edges.meta.json');
  const edgesPartsDir = path.join(outDir, 'symbol_edges.parts');

  const removeJsonlVariants = async () => {
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl'), { force: true });
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl.gz'), { force: true });
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl.zst'), { force: true });
  };

  if (!useShards) {
    enqueueWrite(
      formatArtifactLabel(edgesPath),
      async () => {
        await removeJsonlVariants();
        await fs.rm(edgesMetaPath, { force: true });
        await fs.rm(edgesPartsDir, { recursive: true, force: true });
        await writeJsonLinesFile(edgesPath, rows, { atomic: true, compression, gzipOptions });
      }
    );
    addPieceFile({
      type: 'symbols',
      name: 'symbol_edges',
      format: 'jsonl',
      count: rows.length,
      compression: compression || null
    }, edgesPath);
    return;
  }

  if (log) {
    log(`symbol_edges ~${Math.round(measurement.totalBytes / 1024)}KB; writing JSONL shards.`);
  }
  enqueueWrite(
    formatArtifactLabel(edgesMetaPath),
    async () => {
      await removeJsonlVariants();
      const result = await writeJsonLinesSharded({
        dir: outDir,
        partsDirName: 'symbol_edges.parts',
        partPrefix: 'symbol_edges.part-',
        items: rows,
        maxBytes: maxJsonBytes,
        atomic: true,
        compression,
        gzipOptions
      });
      const parts = result.parts.map((part, index) => ({
        path: part,
        records: result.counts[index] || 0,
        bytes: result.bytes[index] || 0
      }));
      await writeJsonObjectFile(edgesMetaPath, {
        fields: {
          schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
          artifact: 'symbol_edges',
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
          type: 'symbols',
          name: 'symbol_edges',
          format: 'jsonl',
          count: result.counts[i] || 0,
          compression: compression || null
        }, absPath);
      }
      addPieceFile({ type: 'symbols', name: 'symbol_edges_meta', format: 'json' }, edgesMetaPath);
    }
  );
};
