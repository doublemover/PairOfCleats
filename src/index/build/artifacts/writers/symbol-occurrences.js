import fs from 'node:fs/promises';
import path from 'node:path';
import {
  writeJsonLinesFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
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
  const trimmed = { ...row, range: null };
  if (fits(trimmed)) return trimmed;
  trimmed.ref = trimSymbolRef(trimmed.ref);
  if (fits(trimmed)) return trimmed;
  return null;
};

const buildRange = (detail) => (
  Number.isFinite(detail?.start) && Number.isFinite(detail?.end)
    ? { start: detail.start, end: detail.end }
    : null
);

const buildRows = (chunks) => {
  const rows = [];
  for (const chunk of chunks || []) {
    if (!chunk) continue;
    const meta = chunk.metaV2 || {};
    const file = normalizeText(meta.file || chunk.file);
    const chunkUid = normalizeText(meta.chunkUid || chunk.chunkUid);
    if (!file || !chunkUid) continue;
    const host = { file, chunkUid };
    const relations = chunk.codeRelations || {};

    const callDetails = Array.isArray(relations.callDetails) ? relations.callDetails : null;
    if (callDetails && callDetails.length) {
      for (const detail of callDetails) {
        const ref = detail?.calleeRef || detail?.symbolRef || null;
        if (!ref) continue;
        const row = maybeTrimRow({
          v: 1,
          host,
          role: 'call',
          ref,
          range: buildRange(detail)
        });
        if (row) rows.push(row);
      }
    } else if (Array.isArray(relations.callLinks)) {
      for (const link of relations.callLinks) {
        const ref = link?.to || link?.ref || null;
        if (!ref) continue;
        const row = maybeTrimRow({
          v: 1,
          host,
          role: 'call',
          ref,
          range: null
        });
        if (row) rows.push(row);
      }
    }

    if (Array.isArray(relations.usageLinks)) {
      for (const link of relations.usageLinks) {
        const ref = link?.to || link?.ref || null;
        if (!ref) continue;
        const row = maybeTrimRow({
          v: 1,
          host,
          role: 'usage',
          ref,
          range: null
        });
        if (row) rows.push(row);
      }
    }
  }

  rows.sort((a, b) => {
    const fileCmp = String(a.host?.file || '').localeCompare(String(b.host?.file || ''));
    if (fileCmp) return fileCmp;
    const uidCmp = String(a.host?.chunkUid || '').localeCompare(String(b.host?.chunkUid || ''));
    if (uidCmp) return uidCmp;
    const roleCmp = String(a.role || '').localeCompare(String(b.role || ''));
    if (roleCmp) return roleCmp;
    const nameCmp = String(a.ref?.targetName || '').localeCompare(String(b.ref?.targetName || ''));
    if (nameCmp) return nameCmp;
    return String(a.ref?.status || '').localeCompare(String(b.ref?.status || ''));
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

export const enqueueSymbolOccurrencesArtifacts = async ({
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
    await fs.rm(path.join(outDir, 'symbol_occurrences.jsonl'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_occurrences.jsonl.gz'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_occurrences.jsonl.zst'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_occurrences.meta.json'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_occurrences.parts'), { recursive: true, force: true }).catch(() => {});
    return;
  }

  const measurement = measureRows(rows);
  if (maxJsonBytes && measurement.maxLineBytes > maxJsonBytes) {
    throw new Error(`symbol_occurrences row exceeds max JSON size (${measurement.maxLineBytes} bytes).`);
  }
  const useShards = maxJsonBytes && measurement.totalBytes > maxJsonBytes;
  const jsonlExtension = resolveJsonlExtension(compression);
  const occurrencesPath = path.join(outDir, `symbol_occurrences.${jsonlExtension}`);
  const occurrencesMetaPath = path.join(outDir, 'symbol_occurrences.meta.json');
  const occurrencesPartsDir = path.join(outDir, 'symbol_occurrences.parts');

  const removeJsonlVariants = async () => {
    await fs.rm(path.join(outDir, 'symbol_occurrences.jsonl'), { force: true });
    await fs.rm(path.join(outDir, 'symbol_occurrences.jsonl.gz'), { force: true });
    await fs.rm(path.join(outDir, 'symbol_occurrences.jsonl.zst'), { force: true });
  };

  if (!useShards) {
    enqueueWrite(
      formatArtifactLabel(occurrencesPath),
      async () => {
        await removeJsonlVariants();
        await fs.rm(occurrencesMetaPath, { force: true });
        await fs.rm(occurrencesPartsDir, { recursive: true, force: true });
        await writeJsonLinesFile(occurrencesPath, rows, { atomic: true, compression, gzipOptions });
      }
    );
    addPieceFile({
      type: 'symbols',
      name: 'symbol_occurrences',
      format: 'jsonl',
      count: rows.length,
      compression: compression || null
    }, occurrencesPath);
    return;
  }

  if (log) {
    log(`symbol_occurrences ~${Math.round(measurement.totalBytes / 1024)}KB; writing JSONL shards.`);
  }
  enqueueWrite(
    formatArtifactLabel(occurrencesMetaPath),
    async () => {
      await removeJsonlVariants();
      const result = await writeJsonLinesSharded({
        dir: outDir,
        partsDirName: 'symbol_occurrences.parts',
        partPrefix: 'symbol_occurrences.part-',
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
      await writeJsonObjectFile(occurrencesMetaPath, {
        fields: {
          schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
          artifact: 'symbol_occurrences',
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
        const absPath = path.join(outDir, relPath.split('/').join(path.sep));
        addPieceFile({
          type: 'symbols',
          name: 'symbol_occurrences',
          format: 'jsonl',
          count: result.counts[i] || 0,
          compression: compression || null
        }, absPath);
      }
      addPieceFile({ type: 'symbols', name: 'symbol_occurrences_meta', format: 'json' }, occurrencesMetaPath);
    }
  );
};
