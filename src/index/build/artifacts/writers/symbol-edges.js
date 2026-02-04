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
  compareSymbolEdgeRows,
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

export const enqueueSymbolEdgesArtifacts = async ({
  state,
  outDir,
  maxJsonBytes = null,
  log = null,
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
  const useShards = maxJsonBytes && totalBytes > maxJsonBytes;
  recordArtifactTelemetry(stageCheckpoints, {
    stage: 'stage2',
    artifact: 'symbol_edges',
    rows: totalRows,
    bytes: totalBytes,
    maxRowBytes,
    trimmedRows: stats?.trimmedRows || 0,
    droppedRows: stats?.droppedRows || 0,
    extra: { format: useShards ? 'jsonl-sharded' : 'jsonl' }
  });
  if (!totalRows) {
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl.gz'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl.zst'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_edges.meta.json'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'symbol_edges.parts'), { recursive: true, force: true }).catch(() => {});
    if (collected?.cleanup) await collected.cleanup();
    return;
  }

  const jsonlExtension = resolveJsonlExtension(compression);
  const edgesPath = path.join(outDir, `symbol_edges.${jsonlExtension}`);
  const edgesMetaPath = path.join(outDir, 'symbol_edges.meta.json');
  const edgesPartsDir = path.join(outDir, 'symbol_edges.parts');
  const offsetsConfig = compression ? null : { suffix: 'offsets.bin' };
  const offsetsPath = offsetsConfig ? `${edgesPath}.${offsetsConfig.suffix}` : null;

  const removeJsonlVariants = async () => {
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl'), { force: true });
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl.gz'), { force: true });
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl.zst'), { force: true });
    await fs.rm(path.join(outDir, 'symbol_edges.jsonl.offsets.bin'), { force: true });
  };

  if (!useShards) {
    enqueueWrite(
      formatArtifactLabel(edgesPath),
      async () => {
        await removeJsonlVariants();
        await fs.rm(edgesMetaPath, { force: true });
        await fs.rm(edgesPartsDir, { recursive: true, force: true });
        const items = runs ? mergeSortedRuns(runs, { compare: compareSymbolEdgeRows }) : rows;
        await writeJsonLinesFileAsync(edgesPath, items, {
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
      const items = runs ? mergeSortedRuns(runs, { compare: compareSymbolEdgeRows }) : rows;
      const result = runs
        ? await writeJsonLinesShardedAsync({
          dir: outDir,
          partsDirName: 'symbol_edges.parts',
          partPrefix: 'symbol_edges.part-',
          items,
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
