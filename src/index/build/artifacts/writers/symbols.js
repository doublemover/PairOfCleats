import fs from 'node:fs/promises';
import path from 'node:path';
import {
  writeJsonLinesFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
import { fromPosix } from '../../../../shared/files.js';
import {
  createOffsetsMeta,
  createTrimStats,
  recordArtifactTelemetry,
  recordTrimStats
} from '../helpers.js';
import { buildTrimMetadata, TRIM_REASONS } from '../trim-policy.js';
import {
  buildJsonlVariantPaths,
  buildShardedPartEntries,
  measureJsonlRows,
  removeArtifacts,
  resolveJsonlExtension,
  writeShardedJsonlMeta
} from './_common.js';

const MAX_ROW_BYTES = 32768;
const measureRowBytes = (row) => (
  Buffer.byteLength(JSON.stringify(row), 'utf8') + 1
);

const normalizeText = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const maybeTrimRow = (row) => {
  const fits = (value) => measureRowBytes(value) <= MAX_ROW_BYTES;
  if (fits(row)) return { row, trimmed: false, trimReasons: [] };
  const trimReasons = [TRIM_REASONS.rowOversize];
  const trimmed = { ...row };
  if (trimmed.signature) {
    trimmed.signature = null;
    trimReasons.push(TRIM_REASONS.symbolsClearSignature);
  }
  if (trimmed.name) {
    trimmed.name = null;
    trimReasons.push(TRIM_REASONS.symbolsClearName);
  }
  if (trimmed.kind) {
    trimmed.kind = null;
    trimReasons.push(TRIM_REASONS.symbolsClearKind);
  }
  if (trimmed.lang) {
    trimmed.lang = null;
    trimReasons.push(TRIM_REASONS.symbolsClearLang);
  }
  if (trimmed.extensions) {
    delete trimmed.extensions;
    trimReasons.push(TRIM_REASONS.symbolsDropExtensions);
  }
  if (fits(trimmed)) return { row: trimmed, trimmed: true, trimReasons };
  return {
    row: null,
    trimmed: false,
    trimReasons: [...trimReasons, TRIM_REASONS.dropRowOverBudget]
  };
};

const buildSymbolRow = (chunk, stats) => {
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
  const trimmedResult = maybeTrimRow(row);
  if (!trimmedResult.row) {
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

const buildRows = (chunks, stats = null) => {
  const rows = [];
  for (const chunk of chunks || []) {
    const row = buildSymbolRow(chunk, stats);
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

export const enqueueSymbolsArtifacts = async ({
  state,
  outDir,
  maxJsonBytes = null,
  log = null,
  compression = null,
  gzipOptions = null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  stageCheckpoints = null
}) => {
  const stats = createTrimStats();
  const rows = buildRows(state?.chunks || [], stats);
  const trimMetadata = buildTrimMetadata(stats);
  if (!rows.length) {
    await removeArtifacts([
      ...buildJsonlVariantPaths({ outDir, baseName: 'symbols' }),
      path.join(outDir, 'symbols.meta.json'),
      path.join(outDir, 'symbols.parts')
    ]);
    recordArtifactTelemetry(stageCheckpoints, {
      stage: 'stage2',
      artifact: 'symbols',
      rows: 0,
      bytes: 0,
      maxRowBytes: 0,
      trimmedRows: 0,
      droppedRows: stats.droppedRows || 0,
      extra: {
        format: 'none',
        trim: trimMetadata
      }
    });
    return;
  }

  const measurement = measureJsonlRows(rows);
  if (maxJsonBytes && measurement.maxLineBytes > maxJsonBytes) {
    throw new Error(`symbols row exceeds max JSON size (${measurement.maxLineBytes} bytes).`);
  }
  const useShards = maxJsonBytes && measurement.totalBytes > maxJsonBytes;
  recordArtifactTelemetry(stageCheckpoints, {
    stage: 'stage2',
    artifact: 'symbols',
    rows: stats.totalRows || rows.length,
    bytes: measurement.totalBytes,
    maxRowBytes: Math.max(measurement.maxLineBytes, stats.maxRowBytes || 0),
    trimmedRows: stats.trimmedRows || 0,
    droppedRows: stats.droppedRows || 0,
    extra: {
      format: useShards ? 'jsonl-sharded' : 'jsonl',
      trim: trimMetadata
    }
  });
  const jsonlExtension = resolveJsonlExtension(compression);
  const symbolsPath = path.join(outDir, `symbols.${jsonlExtension}`);
  const symbolsMetaPath = path.join(outDir, 'symbols.meta.json');
  const symbolsPartsDir = path.join(outDir, 'symbols.parts');
  const offsetsConfig = compression ? null : { suffix: 'offsets.bin' };
  const offsetsPath = offsetsConfig ? `${symbolsPath}.${offsetsConfig.suffix}` : null;

  const removeJsonlVariants = async () => removeArtifacts(
    buildJsonlVariantPaths({ outDir, baseName: 'symbols', includeOffsets: true })
  );

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
      const parts = buildShardedPartEntries(result);
      const offsetsMeta = createOffsetsMeta({
        suffix: offsetsConfig?.suffix || null,
        parts: result.offsets,
        compression: 'none'
      });
      await writeShardedJsonlMeta({
        metaPath: symbolsMetaPath,
        artifact: 'symbols',
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
