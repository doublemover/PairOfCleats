import fs from 'node:fs/promises';
import path from 'node:path';
import {
  writeJsonLinesFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
import { fromPosix } from '../../../../shared/files.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../../contracts/versioning.js';
import { createOffsetsMeta } from '../helpers.js';

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

const maybeTrimRow = (row) => {
  const fits = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8') + 1 <= MAX_ROW_BYTES;
  if (fits(row)) return row;
  const trimmed = { ...row };
  if (trimmed.signature) trimmed.signature = null;
  if (trimmed.name) trimmed.name = null;
  if (trimmed.kind) trimmed.kind = null;
  if (trimmed.lang) trimmed.lang = null;
  if (trimmed.extensions) delete trimmed.extensions;
  if (fits(trimmed)) return trimmed;
  return null;
};

const buildSymbolRow = (chunk) => {
  if (!chunk) return null;
  const meta = chunk.metaV2 || {};
  const symbol = meta.symbol || null;
  if (!symbol) return null;
  const symbolId = normalizeText(symbol.symbolId);
  const scopedId = normalizeText(symbol.scopedId);
  const symbolKey = normalizeText(symbol.symbolKey);
  const qualifiedName = normalizeText(symbol.qualifiedName);
  const kindGroup = normalizeText(symbol.kindGroup);
  const file = normalizeText(meta.file || chunk.file);
  const virtualPath = normalizeText(meta.virtualPath || chunk.virtualPath || chunk.segment?.virtualPath);
  const chunkUid = normalizeText(meta.chunkUid || chunk.chunkUid);
  if (!symbolId || !scopedId || !symbolKey || !qualifiedName || !kindGroup || !file || !virtualPath || !chunkUid) {
    return null;
  }
  const row = {
    v: 1,
    symbolId,
    scopedId,
    scheme: normalizeText(symbol.scheme),
    symbolKey,
    signatureKey: normalizeText(symbol.signatureKey),
    chunkUid,
    virtualPath,
    segmentUid: normalizeText(chunk.segment?.segmentUid || meta.segment?.segmentUid),
    file,
    lang: normalizeText(meta.lang || chunk.lang),
    kind: normalizeText(meta.kind || chunk.kind),
    kindGroup,
    name: normalizeText(meta.name || chunk.name),
    qualifiedName,
    signature: normalizeText(meta.signature || chunk.docmeta?.signature)
  };
  return maybeTrimRow(row);
};

const buildRows = (chunks) => {
  const rows = [];
  for (const chunk of chunks || []) {
    const row = buildSymbolRow(chunk);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => {
    const idA = String(a.symbolId || '');
    const idB = String(b.symbolId || '');
    if (idA !== idB) return idA.localeCompare(idB);
    const pathA = String(a.virtualPath || '');
    const pathB = String(b.virtualPath || '');
    if (pathA !== pathB) return pathA.localeCompare(pathB);
    const nameA = String(a.qualifiedName || '');
    const nameB = String(b.qualifiedName || '');
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    const kindA = String(a.kindGroup || '');
    const kindB = String(b.kindGroup || '');
    if (kindA !== kindB) return kindA.localeCompare(kindB);
    return String(a.chunkUid || '').localeCompare(String(b.chunkUid || ''));
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

export const enqueueSymbolsArtifacts = async ({
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
    await fs.rm(path.join(outDir, 'symbols.jsonl'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbols.jsonl.gz'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbols.jsonl.zst'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbols.meta.json'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbols.parts'), { recursive: true, force: true }).catch(() => {});
    return;
  }

  const measurement = measureRows(rows);
  if (maxJsonBytes && measurement.maxLineBytes > maxJsonBytes) {
    throw new Error(`symbols row exceeds max JSON size (${measurement.maxLineBytes} bytes).`);
  }
  const useShards = maxJsonBytes && measurement.totalBytes > maxJsonBytes;
  const jsonlExtension = resolveJsonlExtension(compression);
  const symbolsPath = path.join(outDir, `symbols.${jsonlExtension}`);
  const symbolsMetaPath = path.join(outDir, 'symbols.meta.json');
  const symbolsPartsDir = path.join(outDir, 'symbols.parts');
  const offsetsConfig = compression ? null : { suffix: 'offsets.bin' };
  const offsetsPath = offsetsConfig ? `${symbolsPath}.${offsetsConfig.suffix}` : null;

  const removeJsonlVariants = async () => {
    await fs.rm(path.join(outDir, 'symbols.jsonl'), { force: true });
    await fs.rm(path.join(outDir, 'symbols.jsonl.gz'), { force: true });
    await fs.rm(path.join(outDir, 'symbols.jsonl.zst'), { force: true });
    await fs.rm(path.join(outDir, 'symbols.jsonl.offsets.bin'), { force: true });
  };

  if (!useShards) {
    enqueueWrite(
      formatArtifactLabel(symbolsPath),
      async () => {
        await removeJsonlVariants();
        await fs.rm(symbolsMetaPath, { force: true });
        await fs.rm(symbolsPartsDir, { recursive: true, force: true });
        await writeJsonLinesFile(symbolsPath, rows, {
          atomic: true,
          compression,
          gzipOptions,
          offsets: offsetsPath ? { path: offsetsPath, atomic: true } : null,
          maxBytes: maxJsonBytes
        });
      }
    );
    addPieceFile({
      type: 'symbols',
      name: 'symbols',
      format: 'jsonl',
      count: rows.length,
      compression: compression || null
    }, symbolsPath);
    if (offsetsPath) {
      addPieceFile({
        type: 'symbols',
        name: 'symbols_offsets',
        format: 'bin',
        count: rows.length
      }, offsetsPath);
    }
    return;
  }

  if (log) {
    log(`symbols ~${Math.round(measurement.totalBytes / 1024)}KB; writing JSONL shards.`);
  }
  enqueueWrite(
    formatArtifactLabel(symbolsMetaPath),
    async () => {
      await removeJsonlVariants();
      const result = await writeJsonLinesSharded({
        dir: outDir,
        partsDirName: 'symbols.parts',
        partPrefix: 'symbols.part-',
        items: rows,
        maxBytes: maxJsonBytes,
        atomic: true,
        compression,
        gzipOptions,
        offsets: offsetsConfig
      });
      const parts = result.parts.map((part, index) => ({
        path: part,
        records: result.counts[index] || 0,
        bytes: result.bytes[index] || 0
      }));
      const offsetsMeta = createOffsetsMeta({
        suffix: offsetsConfig?.suffix || null,
        parts: result.offsets,
        compression: 'none'
      });
      await writeJsonObjectFile(symbolsMetaPath, {
        fields: {
          schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
          artifact: 'symbols',
          format: 'jsonl-sharded',
          generatedAt: new Date().toISOString(),
          compression: compression || 'none',
          totalRecords: result.total,
          totalBytes: result.totalBytes,
          maxPartRecords: result.maxPartRecords,
          maxPartBytes: result.maxPartBytes,
          targetMaxBytes: result.targetMaxBytes,
          extensions: offsetsMeta ? { offsets: offsetsMeta } : undefined,
          parts
        },
        atomic: true
      });
      for (let i = 0; i < result.parts.length; i += 1) {
        const relPath = result.parts[i];
        const absPath = path.join(outDir, fromPosix(relPath));
        addPieceFile({
          type: 'symbols',
          name: 'symbols',
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
            type: 'symbols',
            name: 'symbols_offsets',
            format: 'bin',
            count: result.counts[i] || 0
          }, absPath);
        }
      }
      addPieceFile({ type: 'symbols', name: 'symbols_meta', format: 'json' }, symbolsMetaPath);
    }
  );
};
