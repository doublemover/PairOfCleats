import fs from 'node:fs/promises';
import path from 'node:path';
import {
  writeJsonLinesFile,
  writeJsonLinesFileAsync,
  writeJsonLinesSharded,
  writeJsonLinesShardedAsync,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
import { fromPosix } from '../../../../shared/files.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../../contracts/versioning.js';
import {
  compareSymbolOccurrenceRows,
  createRowSpillCollector,
  createTrimStats,
  mergeSortedRuns,
  recordArtifactTelemetry
} from '../helpers.js';

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
    value?.host?.file && value?.host?.chunkUid && value?.role && value?.ref
  );
  const rowBytes = measureRowBytes(row);
  if (rowBytes <= MAX_ROW_BYTES) {
    return { row: required(row) ? row : null, trimmed: false };
  }
  const trimmed = { ...row, range: null };
  if (fits(trimmed)) return { row: required(trimmed) ? trimmed : null, trimmed: true };
  trimmed.ref = trimSymbolRef(trimmed.ref);
  if (fits(trimmed)) return { row: required(trimmed) ? trimmed : null, trimmed: true };
  return { row: null, trimmed: false };
};

const buildRange = (detail) => (
  Number.isFinite(detail?.start) && Number.isFinite(detail?.end)
    ? { start: detail.start, end: detail.end }
    : null
);

const collectRows = async (chunks, { outDir, maxJsonBytes }) => {
  const stats = createTrimStats();
  const collector = createRowSpillCollector({
    outDir,
    runPrefix: 'symbol_occurrences',
    compare: compareSymbolOccurrenceRows,
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
    const host = { file, chunkUid };
    const relations = chunk.codeRelations || {};

    const callDetails = Array.isArray(relations.callDetails) ? relations.callDetails : null;
    if (callDetails && callDetails.length) {
      for (const detail of callDetails) {
        const ref = detail?.calleeRef || detail?.symbolRef || null;
        if (!ref) continue;
        const { row, trimmed } = maybeTrimRow({
          v: 1,
          host,
          role: 'call',
          ref,
          range: buildRange(detail)
        });
        await collector.append(row, { trimmed, dropped: !row });
      }
    } else if (Array.isArray(relations.callLinks)) {
      for (const link of relations.callLinks) {
        const ref = link?.to || link?.ref || null;
        if (!ref) continue;
        const { row, trimmed } = maybeTrimRow({
          v: 1,
          host,
          role: 'call',
          ref,
          range: null
        });
        await collector.append(row, { trimmed, dropped: !row });
      }
    }

    if (Array.isArray(relations.usageLinks)) {
      for (const link of relations.usageLinks) {
        const ref = link?.to || link?.ref || null;
        if (!ref) continue;
        const { row, trimmed } = maybeTrimRow({
          v: 1,
          host,
          role: 'usage',
          ref,
          range: null
        });
        await collector.append(row, { trimmed, dropped: !row });
      }
    }
  }

  return collector.finalize();
};

const buildSymbolOccurrencesColumnar = async (items) => {
  const roleTable = new Map();
  const roleList = [];
  const resolveRole = (value) => {
    if (!value) return null;
    if (roleTable.has(value)) return roleTable.get(value);
    const index = roleList.length;
    roleList.push(value);
    roleTable.set(value, index);
    return index;
  };
  const columns = [
    'v',
    'host_file',
    'host_chunkUid',
    'role',
    'ref',
    'range'
  ];
  const arrays = Object.fromEntries(columns.map((key) => [key, []]));
  let length = 0;
  for await (const row of items) {
    if (!row || typeof row !== 'object') continue;
    arrays.v.push(Number.isFinite(row.v) ? row.v : null);
    arrays.host_file.push(row.host?.file ?? null);
    arrays.host_chunkUid.push(row.host?.chunkUid ?? null);
    arrays.role.push(resolveRole(row.role));
    arrays.ref.push(row.ref ?? null);
    arrays.range.push(row.range ?? null);
    length += 1;
  }
  return {
    format: 'columnar',
    length,
    columns,
    arrays,
    tables: {
      role: roleList
    }
  };
};

export const enqueueSymbolOccurrencesArtifacts = async ({
  state,
  outDir,
  maxJsonBytes = null,
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
  let useColumnar = format === 'columnar';
  if (useColumnar && maxJsonBytes && totalBytes > maxJsonBytes) {
    useColumnar = false;
  }
  const useShards = maxJsonBytes && totalBytes > maxJsonBytes && !useColumnar;
  const formatLabel = useColumnar ? 'columnar' : (useShards ? 'jsonl-sharded' : 'jsonl');
  recordArtifactTelemetry(stageCheckpoints, {
    stage: 'stage2',
    artifact: 'symbol_occurrences',
    rows: totalRows,
    bytes: totalBytes,
    maxRowBytes,
    trimmedRows: stats?.trimmedRows || 0,
    droppedRows: stats?.droppedRows || 0,
    extra: { format: formatLabel }
  });
  if (!totalRows) {
    await fs.rm(path.join(outDir, 'symbol_occurrences.jsonl'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_occurrences.jsonl.gz'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_occurrences.jsonl.zst'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_occurrences.meta.json'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_occurrences.parts'), { recursive: true, force: true }).catch(() => {});
    if (collected?.cleanup) await collected.cleanup();
    return;
  }
  const jsonlExtension = resolveJsonlExtension(compression);
  const occurrencesPath = path.join(outDir, `symbol_occurrences.${jsonlExtension}`);
  const occurrencesMetaPath = path.join(outDir, 'symbol_occurrences.meta.json');
  const occurrencesPartsDir = path.join(outDir, 'symbol_occurrences.parts');
  const columnarPath = path.join(outDir, 'symbol_occurrences.columnar.json');
  const offsetsConfig = compression ? null : { suffix: 'offsets.bin' };
  const offsetsPath = offsetsConfig ? `${occurrencesPath}.${offsetsConfig.suffix}` : null;

  const removeJsonlVariants = async () => {
    await fs.rm(path.join(outDir, 'symbol_occurrences.jsonl'), { force: true });
    await fs.rm(path.join(outDir, 'symbol_occurrences.jsonl.gz'), { force: true });
    await fs.rm(path.join(outDir, 'symbol_occurrences.jsonl.zst'), { force: true });
    await fs.rm(path.join(outDir, 'symbol_occurrences.jsonl.offsets.bin'), { force: true });
  };

  if (useColumnar) {
    enqueueWrite(
      formatArtifactLabel(columnarPath),
      async () => {
        await removeJsonlVariants();
        await fs.rm(occurrencesMetaPath, { force: true });
        await fs.rm(occurrencesPartsDir, { recursive: true, force: true });
        const items = runs ? mergeSortedRuns(runs, { compare: compareSymbolOccurrenceRows }) : rows;
        const payload = await buildSymbolOccurrencesColumnar(items);
        await writeJsonObjectFile(columnarPath, { fields: payload, atomic: true });
        if (collected?.cleanup) await collected.cleanup();
      }
    );
    addPieceFile({
      type: 'symbols',
      name: 'symbol_occurrences',
      format: 'columnar',
      count: totalRows
    }, columnarPath);
    return;
  }

  if (!useShards) {
    enqueueWrite(
      formatArtifactLabel(occurrencesPath),
      async () => {
        await removeJsonlVariants();
        await fs.rm(columnarPath, { force: true });
        await fs.rm(occurrencesMetaPath, { force: true });
        await fs.rm(occurrencesPartsDir, { recursive: true, force: true });
        const items = runs ? mergeSortedRuns(runs, { compare: compareSymbolOccurrenceRows }) : rows;
        await writeJsonLinesFileAsync(occurrencesPath, items, {
          atomic: true,
          compression,
          gzipOptions,
          offsets: offsetsPath ? { path: offsetsPath, atomic: true } : null
        });
        if (collected?.cleanup) await collected.cleanup();
      }
    );
    addPieceFile({
      type: 'symbols',
      name: 'symbol_occurrences',
      format: 'jsonl',
      count: totalRows,
      compression: compression || null
    }, occurrencesPath);
    if (offsetsPath) {
      addPieceFile({
        type: 'symbols',
        name: 'symbol_occurrences_offsets',
        format: 'bin',
        count: totalRows
      }, offsetsPath);
    }
    return;
  }

  if (log) {
    log(`symbol_occurrences ~${Math.round(totalBytes / 1024)}KB; writing JSONL shards.`);
  }
  enqueueWrite(
    formatArtifactLabel(occurrencesMetaPath),
    async () => {
      await removeJsonlVariants();
      await fs.rm(columnarPath, { force: true });
      const items = runs ? mergeSortedRuns(runs, { compare: compareSymbolOccurrenceRows }) : rows;
      const result = runs
        ? await writeJsonLinesShardedAsync({
          dir: outDir,
          partsDirName: 'symbol_occurrences.parts',
          partPrefix: 'symbol_occurrences.part-',
          items,
          maxBytes: maxJsonBytes,
          atomic: true,
          compression,
          gzipOptions,
          offsets: offsetsConfig
        })
        : await writeJsonLinesSharded({
          dir: outDir,
          partsDirName: 'symbol_occurrences.parts',
          partPrefix: 'symbol_occurrences.part-',
          items,
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
      const offsetsMeta = result.offsets?.length
        ? {
          format: 'u64-le',
          suffix: offsetsConfig?.suffix || null,
          parts: result.offsets
        }
        : null;
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
      for (let i = 0; i < result.parts.length; i += 1) {
        const relPath = result.parts[i];
        const absPath = path.join(outDir, fromPosix(relPath));
        addPieceFile({
          type: 'symbols',
          name: 'symbol_occurrences',
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
            name: 'symbol_occurrences_offsets',
            format: 'bin',
            count: result.counts[i] || 0
          }, absPath);
        }
      }
      addPieceFile({ type: 'symbols', name: 'symbol_occurrences_meta', format: 'json' }, occurrencesMetaPath);
      if (collected?.cleanup) await collected.cleanup();
    }
  );
};
