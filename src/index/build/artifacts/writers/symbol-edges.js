import fs from 'node:fs/promises';
import path from 'node:path';
import {
  writeJsonLinesFile,
  writeJsonLinesFileAsync,
  writeJsonLinesSharded,
  writeJsonLinesShardedAsync,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
import { fromPosix, toPosix } from '../../../../shared/files.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../../contracts/versioning.js';
import { mergeSortedRuns } from '../../../../shared/merge.js';
import {
  compareSymbolEdgeRows,
  createOffsetsIndexMeta,
  createOffsetsMeta,
  createRowSpillCollector,
  createTrimStats,
  recordArtifactTelemetry,
  writePerFileVarintIndex
} from '../helpers.js';
import { applyByteBudget } from '../../byte-budget.js';

const MAX_ROW_BYTES = 32768;

const resolveJsonlExtension = (value) => {
  if (value === 'gzip') return 'jsonl.gz';
  if (value === 'zstd') return 'jsonl.zst';
  return 'jsonl';
};

const measureRowBytes = (row) => (
  Buffer.byteLength(JSON.stringify(row), 'utf8') + 1
);

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
  const required = (value) => (
    value?.from?.file && value?.from?.chunkUid && value?.to && value?.type
  );
  const rowBytes = measureRowBytes(row);
  if (rowBytes <= MAX_ROW_BYTES) {
    return { row: required(row) ? row : null, trimmed: false };
  }
  const trimmed = { ...row };
  if (trimmed.evidence) delete trimmed.evidence;
  if (trimmed.reason) trimmed.reason = null;
  if (Number.isFinite(trimmed.confidence)) trimmed.confidence = null;
  if (fits(trimmed)) return { row: required(trimmed) ? trimmed : null, trimmed: true };
  trimmed.to = trimSymbolRef(trimmed.to);
  if (fits(trimmed)) return { row: required(trimmed) ? trimmed : null, trimmed: true };
  return { row: null, trimmed: false };
};

const collectRows = async (chunks, { outDir, maxJsonBytes }) => {
  const stats = createTrimStats();
  const collector = createRowSpillCollector({
    outDir,
    runPrefix: 'symbol_edges',
    compare: compareSymbolEdgeRows,
    maxBufferBytes: 2 * 1024 * 1024,
    maxBufferRows: 5000,
    maxJsonBytes,
    stats
  });
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
        const { row, trimmed } = maybeTrimRow({
          v: 1,
          type: link?.edgeKind || 'call',
          from,
          to: ref,
          confidence: Number.isFinite(link?.confidence) ? link.confidence : null,
          reason: normalizeText(link?.reason),
          evidence: link?.evidence || undefined
        });
        await collector.append(row, { trimmed, dropped: !row });
      }
    }
  }

  return collector.finalize();
};

const buildSymbolEdgesColumnar = async (items) => {
  const typeTable = new Map();
  const typeList = [];
  const resolveType = (value) => {
    if (!value) return null;
    if (typeTable.has(value)) return typeTable.get(value);
    const index = typeList.length;
    typeList.push(value);
    typeTable.set(value, index);
    return index;
  };
  const columns = [
    'v',
    'type',
    'from_file',
    'from_chunkUid',
    'to',
    'confidence',
    'reason',
    'evidence'
  ];
  const arrays = Object.fromEntries(columns.map((key) => [key, []]));
  let length = 0;
  for await (const row of items) {
    if (!row || typeof row !== 'object') continue;
    arrays.v.push(Number.isFinite(row.v) ? row.v : null);
    arrays.type.push(resolveType(row.type));
    arrays.from_file.push(row.from?.file ?? null);
    arrays.from_chunkUid.push(row.from?.chunkUid ?? null);
    arrays.to.push(row.to ?? null);
    arrays.confidence.push(Number.isFinite(row.confidence) ? row.confidence : null);
    arrays.reason.push(row.reason ?? null);
    arrays.evidence.push(row.evidence ?? null);
    length += 1;
  }
  return {
    format: 'columnar',
    length,
    columns,
    arrays,
    tables: {
      type: typeList
    }
  };
};

const createPerFileTracker = ({ fileIdByPath, chunkUidToFileId, fileCount }) => {
  if (!Number.isFinite(fileCount) || fileCount <= 0) return null;
  if (!fileIdByPath && !chunkUidToFileId) return null;
  const perFileRows = Array.from({ length: fileCount }, () => []);
  const resolveFileId = (row) => {
    const file = row?.from?.file || null;
    if (file && fileIdByPath?.has?.(file)) {
      return fileIdByPath.get(file);
    }
    const chunkUid = row?.from?.chunkUid || null;
    if (chunkUid && chunkUidToFileId?.has?.(chunkUid)) {
      return chunkUidToFileId.get(chunkUid);
    }
    return null;
  };
  const recordRow = (row, rowIndex) => {
    const fileId = resolveFileId(row);
    if (!Number.isFinite(fileId)) return;
    if (fileId < 0 || fileId >= perFileRows.length) return;
    perFileRows[fileId].push(rowIndex);
  };
  return { perFileRows, recordRow };
};

const trackRows = (items, recordRow) => {
  let rowIndex = 0;
  if (items?.[Symbol.asyncIterator]) {
    return (async function* trackedRows() {
      for await (const row of items) {
        if (recordRow) recordRow(row, rowIndex);
        rowIndex += 1;
        yield row;
      }
    })();
  }
  return (function* trackedRows() {
    for (const row of items || []) {
      if (recordRow) recordRow(row, rowIndex);
      rowIndex += 1;
      yield row;
    }
  })();
};

export const enqueueSymbolEdgesArtifacts = async ({
  state,
  fileIdByPath = null,
  chunkUidToFileId = null,
  outDir,
  maxJsonBytes = null,
  byteBudget = null,
  log = null,
  format = null,
  compression = null,
  gzipOptions = null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  stageCheckpoints
}) => {
  const collected = await collectRows(state?.chunks || [], { outDir, maxJsonBytes });
  const rows = collected?.rows || null;
  const runs = collected?.runs || null;
  const stats = collected?.stats || null;
  const totalRows = stats?.totalRows || 0;
  const totalBytes = stats?.totalBytes || 0;
  const maxRowBytes = stats?.maxRowBytes || 0;
  const perFileBaseName = 'symbol_edges.by-file';
  const perFileMetaPath = path.join(outDir, `${perFileBaseName}.meta.json`);
  const perFileDataPath = path.join(outDir, `${perFileBaseName}.bin`);
  const perFileOffsetsPath = path.join(outDir, `${perFileBaseName}.offsets.bin`);
  const fileCount = fileIdByPath?.size ?? 0;
  let useColumnar = format === 'columnar';
  if (useColumnar && maxJsonBytes && totalBytes > maxJsonBytes) {
    useColumnar = false;
  }
  const useShards = maxJsonBytes && totalBytes > maxJsonBytes && !useColumnar;
  const formatLabel = useColumnar ? 'columnar' : (useShards ? 'jsonl-sharded' : 'jsonl');
  const budgetInfo = applyByteBudget({
    budget: byteBudget,
    totalBytes,
    label: 'symbol_edges',
    stageCheckpoints,
    logger: log
  });
  recordArtifactTelemetry(stageCheckpoints, {
    stage: 'stage2',
    artifact: 'symbol_edges',
    rows: totalRows,
    bytes: totalBytes,
    maxRowBytes,
    trimmedRows: stats?.trimmedRows || 0,
    droppedRows: stats?.droppedRows || 0,
    extra: {
      format: formatLabel,
      budget: budgetInfo,
      runsSpilled: stats?.runsSpilled || 0,
      spillBytes: stats?.spillBytes || 0
    }
  });
  if (!totalRows) {
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl.gz'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl.zst'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_edges.meta.json'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_edges.parts'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(perFileMetaPath, { recursive: true, force: true }).catch(() => {});
    await fs.rm(perFileDataPath, { recursive: true, force: true }).catch(() => {});
    await fs.rm(perFileOffsetsPath, { recursive: true, force: true }).catch(() => {});
    if (collected?.cleanup) await collected.cleanup();
    return;
  }

  const jsonlExtension = resolveJsonlExtension(compression);
  const edgesPath = path.join(outDir, `symbol_edges.${jsonlExtension}`);
  const edgesMetaPath = path.join(outDir, 'symbol_edges.meta.json');
  const edgesPartsDir = path.join(outDir, 'symbol_edges.parts');
  const columnarPath = path.join(outDir, 'symbol_edges.columnar.json');
  const offsetsConfig = compression ? null : { suffix: 'offsets.bin' };
  const offsetsPath = offsetsConfig ? `${edgesPath}.${offsetsConfig.suffix}` : null;

  const removeJsonlVariants = async () => {
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl'), { force: true });
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl.gz'), { force: true });
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl.zst'), { force: true });
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl.offsets.bin'), { force: true });
  };
  const removePerFileIndex = async () => {
    await fs.rm(perFileMetaPath, { force: true });
    await fs.rm(perFileDataPath, { force: true });
    await fs.rm(perFileOffsetsPath, { force: true });
  };

  if (useColumnar) {
    enqueueWrite(
      formatArtifactLabel(columnarPath),
      async () => {
        await removeJsonlVariants();
        await removePerFileIndex();
        await fs.rm(edgesMetaPath, { force: true });
        await fs.rm(edgesPartsDir, { recursive: true, force: true });
        const items = runs ? mergeSortedRuns(runs, { compare: compareSymbolEdgeRows }) : rows;
        const payload = await buildSymbolEdgesColumnar(items);
        await writeJsonObjectFile(columnarPath, { fields: payload, atomic: true });
        if (collected?.cleanup) await collected.cleanup();
      }
    );
    addPieceFile({
      type: 'symbols',
      name: 'symbol_edges',
      format: 'columnar',
      count: totalRows
    }, columnarPath);
    return;
  }

  if (!useShards) {
    enqueueWrite(
      formatArtifactLabel(edgesPath),
      async () => {
        await removeJsonlVariants();
        await removePerFileIndex();
        await fs.rm(columnarPath, { force: true });
        await fs.rm(edgesMetaPath, { force: true });
        await fs.rm(edgesPartsDir, { recursive: true, force: true });
        const items = runs ? mergeSortedRuns(runs, { compare: compareSymbolEdgeRows }) : rows;
        const tracker = createPerFileTracker({ fileIdByPath, chunkUidToFileId, fileCount });
        const trackedItems = trackRows(items, tracker?.recordRow);
        await writeJsonLinesFileAsync(edgesPath, trackedItems, {
          atomic: true,
          compression,
          gzipOptions,
          offsets: offsetsPath ? { path: offsetsPath, atomic: true } : null,
          maxBytes: maxJsonBytes
        });
        if (tracker?.perFileRows && offsetsPath) {
          const perFileIndex = await writePerFileVarintIndex({
            outDir,
            baseName: perFileBaseName,
            fileCount,
            perFileRows: tracker.perFileRows,
            atomic: true
          });
          if (perFileIndex) {
            const relativeJsonl = toPosix(path.relative(outDir, edgesPath));
            const relativeOffsets = toPosix(path.relative(outDir, offsetsPath));
            const meta = {
              format: 'varint-delta',
              encoding: 'uvarint',
              value: 'rowIndex',
              fileCount,
              rows: totalRows,
              data: toPosix(path.relative(outDir, perFileIndex.dataPath)),
              offsets: createOffsetsIndexMeta({
                path: toPosix(path.relative(outDir, perFileIndex.offsetsPath)),
                count: fileCount + 1,
                compression: 'none'
              }),
              jsonl: {
                format: 'jsonl',
                parts: [relativeJsonl],
                counts: [totalRows],
                offsets: [relativeOffsets]
              }
            };
            await writeJsonObjectFile(perFileMetaPath, { fields: meta, atomic: true });
            addPieceFile({
              type: 'symbols',
              name: 'symbol_edges_by_file',
              format: 'bin',
              count: fileCount
            }, perFileIndex.dataPath);
            addPieceFile({
              type: 'symbols',
              name: 'symbol_edges_by_file_offsets',
              format: 'bin',
              count: fileCount + 1
            }, perFileIndex.offsetsPath);
            addPieceFile({
              type: 'symbols',
              name: 'symbol_edges_by_file_meta',
              format: 'json'
            }, perFileMetaPath);
          }
        }
        if (collected?.cleanup) await collected.cleanup();
      }
    );
    addPieceFile({
      type: 'symbols',
      name: 'symbol_edges',
      format: 'jsonl',
      count: totalRows,
      compression: compression || null
    }, edgesPath);
    if (offsetsPath) {
      addPieceFile({
        type: 'symbols',
        name: 'symbol_edges_offsets',
        format: 'bin',
        count: totalRows
      }, offsetsPath);
    }
    return;
  }

  if (log) {
    log(`symbol_edges ~${Math.round(totalBytes / 1024)}KB; writing JSONL shards.`);
  }
  enqueueWrite(
    formatArtifactLabel(edgesMetaPath),
    async () => {
      await removeJsonlVariants();
      await removePerFileIndex();
      await fs.rm(columnarPath, { force: true });
      const items = runs ? mergeSortedRuns(runs, { compare: compareSymbolEdgeRows }) : rows;
      const tracker = createPerFileTracker({ fileIdByPath, chunkUidToFileId, fileCount });
      const trackedItems = trackRows(items, tracker?.recordRow);
      const result = runs
        ? await writeJsonLinesShardedAsync({
          dir: outDir,
          partsDirName: 'symbol_edges.parts',
          partPrefix: 'symbol_edges.part-',
          items: trackedItems,
          maxBytes: maxJsonBytes,
          atomic: true,
          compression,
          gzipOptions,
          offsets: offsetsConfig
        })
        : await writeJsonLinesSharded({
          dir: outDir,
          partsDirName: 'symbol_edges.parts',
          partPrefix: 'symbol_edges.part-',
          items: trackedItems,
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
          extensions: {
            trim: {
              trimmedRows: stats?.trimmedRows || 0,
              droppedRows: stats?.droppedRows || 0,
              maxRowBytes: stats?.maxRowBytes || 0
            },
            ...(offsetsMeta ? { offsets: offsetsMeta } : {})
          },
          parts
        },
        atomic: true
      });
      if (tracker?.perFileRows && Array.isArray(result.offsets) && result.offsets.length) {
        const perFileIndex = await writePerFileVarintIndex({
          outDir,
          baseName: perFileBaseName,
          fileCount,
          perFileRows: tracker.perFileRows,
          atomic: true
        });
        if (perFileIndex) {
          const parts = result.parts.map((part) => part);
          const offsets = result.offsets.map((part) => part);
          const counts = result.counts.map((count) => count || 0);
          const meta = {
            format: 'varint-delta',
            encoding: 'uvarint',
            value: 'rowIndex',
            fileCount,
            rows: totalRows,
            data: toPosix(path.relative(outDir, perFileIndex.dataPath)),
            offsets: createOffsetsIndexMeta({
              path: toPosix(path.relative(outDir, perFileIndex.offsetsPath)),
              count: fileCount + 1,
              compression: 'none'
            }),
            jsonl: {
              format: 'jsonl-sharded',
              parts,
              counts,
              offsets
            }
          };
          await writeJsonObjectFile(perFileMetaPath, { fields: meta, atomic: true });
          addPieceFile({
            type: 'symbols',
            name: 'symbol_edges_by_file',
            format: 'bin',
            count: fileCount
          }, perFileIndex.dataPath);
          addPieceFile({
            type: 'symbols',
            name: 'symbol_edges_by_file_offsets',
            format: 'bin',
            count: fileCount + 1
          }, perFileIndex.offsetsPath);
          addPieceFile({
            type: 'symbols',
            name: 'symbol_edges_by_file_meta',
            format: 'json'
          }, perFileMetaPath);
        }
      }
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
      if (Array.isArray(result.offsets)) {
        for (let i = 0; i < result.offsets.length; i += 1) {
          const relPath = result.offsets[i];
          if (!relPath) continue;
          const absPath = path.join(outDir, fromPosix(relPath));
          addPieceFile({
            type: 'symbols',
            name: 'symbol_edges_offsets',
            format: 'bin',
            count: result.counts[i] || 0
          }, absPath);
        }
      }
      addPieceFile({ type: 'symbols', name: 'symbol_edges_meta', format: 'json' }, edgesMetaPath);
      if (collected?.cleanup) await collected.cleanup();
    }
  );
};
