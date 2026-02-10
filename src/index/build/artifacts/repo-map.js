import path from 'node:path';
import { writeJsonArrayFile, writeJsonLinesSharded, writeJsonObjectFile } from '../../../shared/json-stream.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../contracts/versioning.js';
import { fromPosix } from '../../../shared/files.js';
import { createOrderingHasher } from '../../../shared/order.js';
import { applyByteBudget } from '../byte-budget.js';

export function measureRepoMap({ repoMapIterator, maxJsonBytes, fileIdByPath = null }) {
  let totalEntries = 0;
  let totalBytes = 2;
  let totalJsonlBytes = 0;
  let totalDeltaJsonlBytes = 0;
  const hasDeltaMap = fileIdByPath && typeof fileIdByPath.get === 'function';
  let deltaEligible = hasDeltaMap;
  const kindTable = [];
  const kindIndex = new Map();
  const signatureTable = [null];
  const signatureIndex = new Map([[null, 0]]);
  const orderingHasher = createOrderingHasher();
  const pushTable = (value, table, index) => {
    const key = value == null ? null : String(value);
    if (index.has(key)) return index.get(key);
    const id = table.length;
    table.push(key);
    index.set(key, id);
    return id;
  };
  for (const entry of repoMapIterator()) {
    const line = JSON.stringify(entry);
    const lineBytes = Buffer.byteLength(line, 'utf8');
    orderingHasher.update(line);
    if (maxJsonBytes && (lineBytes + 1) > maxJsonBytes) {
      throw new Error(`repo_map entry exceeds max JSON size (${lineBytes} bytes).`);
    }
    totalBytes += lineBytes + (totalEntries > 0 ? 1 : 0);
    totalJsonlBytes += lineBytes + 1;
    if (deltaEligible) {
      const fileId = fileIdByPath.get(entry.file);
      if (Number.isFinite(fileId)) {
        const kindId = pushTable(entry.kind || null, kindTable, kindIndex);
        const signatureId = pushTable(entry.signature ?? null, signatureTable, signatureIndex);
        const deltaRow = [
          fileId,
          entry.ext || null,
          entry.name || null,
          kindId,
          signatureId,
          Number.isFinite(entry.startLine) ? entry.startLine : null,
          Number.isFinite(entry.endLine) ? entry.endLine : null,
          entry.exported ? 1 : 0
        ];
        const deltaLine = JSON.stringify(deltaRow);
        const deltaBytes = Buffer.byteLength(deltaLine, 'utf8');
        if (maxJsonBytes && (deltaBytes + 1) > maxJsonBytes) {
          throw new Error(`repo_map entry exceeds max JSON size (${deltaBytes} bytes).`);
        }
        totalDeltaJsonlBytes += deltaBytes + 1;
      } else {
        // Delta encoding requires total file-id coverage; fail closed if any row is missing.
        deltaEligible = false;
      }
    }
    totalEntries += 1;
  }
  const deltaEnabled = deltaEligible && totalEntries > 0;
  const orderingResult = totalEntries ? orderingHasher.digest() : null;
  const deltaRatio = (deltaEnabled && totalJsonlBytes > 0)
    ? totalDeltaJsonlBytes / totalJsonlBytes
    : null;
  return {
    totalEntries,
    totalBytes,
    totalJsonlBytes,
    delta: deltaEnabled ? {
      schemaVersion: 1,
      format: 'repo_map.delta.v1',
      totalJsonlBytes: totalDeltaJsonlBytes,
      ratio: deltaRatio,
      tables: {
        kind: kindTable.length,
        signature: signatureTable.length
      }
    } : null,
    orderingHash: orderingResult?.hash || null,
    orderingCount: orderingResult?.count || 0
  };
}

export async function enqueueRepoMapArtifacts({
  outDir,
  repoMapIterator,
  repoMapMeasurement,
  useRepoMapJsonl,
  maxJsonBytes,
  byteBudget = null,
  repoMapCompression,
  compressionGzipOptions,
  log,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  removeArtifact,
  stageCheckpoints,
  fileIdByPath = null,
  scheduleIo = null
}) {
  const schedule = typeof scheduleIo === 'function' ? scheduleIo : (fn) => fn();
  const resolveJsonExtension = (value) => {
    if (value === 'gzip') return 'json.gz';
    if (value === 'zstd') return 'json.zst';
    return 'json';
  };
  const repoMapPath = path.join(outDir, `repo_map.${resolveJsonExtension(repoMapCompression)}`);
  const repoMapMetaPath = path.join(outDir, 'repo_map.meta.json');
  const repoMapPartsDir = path.join(outDir, 'repo_map.parts');
  const repoMapJsonlPaths = [
    path.join(outDir, 'repo_map.jsonl'),
    path.join(outDir, 'repo_map.jsonl.gz'),
    path.join(outDir, 'repo_map.jsonl.zst')
  ];
  const repoMapJsonPaths = [
    path.join(outDir, 'repo_map.json'),
    path.join(outDir, 'repo_map.json.gz'),
    path.join(outDir, 'repo_map.json.zst')
  ];
  const removeRepoMapJsonl = async () => {
    for (const filePath of repoMapJsonlPaths) {
      await removeArtifact(filePath);
    }
  };
  const removeRepoMapJson = async (keepPath = null) => {
    for (const filePath of repoMapJsonPaths) {
      if (keepPath && filePath === keepPath) continue;
      await removeArtifact(filePath);
    }
  };
  const deltaMeasurement = repoMapMeasurement?.delta || null;
  const deltaEnabled = useRepoMapJsonl && deltaMeasurement && fileIdByPath && typeof fileIdByPath.get === 'function';
  const budgetBytes = useRepoMapJsonl
    ? (deltaEnabled && Number.isFinite(deltaMeasurement.totalJsonlBytes)
      ? deltaMeasurement.totalJsonlBytes
      : repoMapMeasurement.totalJsonlBytes)
    : repoMapMeasurement.totalBytes;
  applyByteBudget({
    budget: byteBudget,
    totalBytes: budgetBytes,
    label: 'repo_map',
    stageCheckpoints,
    logger: log
  });

  if (!useRepoMapJsonl) {
    enqueueWrite(
      formatArtifactLabel(repoMapPath),
      async () => {
        await writeJsonArrayFile(repoMapPath, repoMapIterator(), {
          atomic: true,
          compression: repoMapCompression
        });
        await removeRepoMapJsonl();
        await removeRepoMapJson(repoMapPath);
        await removeArtifact(repoMapMetaPath);
        await removeArtifact(repoMapPartsDir);
      }
    );
    addPieceFile({
      type: 'chunks',
      name: 'repo_map',
      format: 'json',
      compression: repoMapCompression || null
    }, repoMapPath);
  } else {
    const measuredBytes = deltaEnabled && Number.isFinite(deltaMeasurement.totalJsonlBytes)
      ? deltaMeasurement.totalJsonlBytes
      : repoMapMeasurement.totalJsonlBytes;
    log(`repo_map ~${Math.round(measuredBytes / 1024)}KB; writing JSONL shards.`);
    enqueueWrite(
      formatArtifactLabel(repoMapMetaPath),
      async () => {
        const kindTable = [];
        const kindIndex = new Map();
        const signatureTable = [null];
        const signatureIndex = new Map([[null, 0]]);
        const pushTable = (value, table, index) => {
          const key = value == null ? null : String(value);
          if (index.has(key)) return index.get(key);
          const id = table.length;
          table.push(key);
          index.set(key, id);
          return id;
        };
        const deltaItems = function* () {
          for (const entry of repoMapIterator()) {
            if (!deltaEnabled) {
              yield entry;
              continue;
            }
            const fileId = fileIdByPath.get(entry.file);
            if (!Number.isFinite(fileId)) {
              yield entry;
              continue;
            }
            const kindId = pushTable(entry.kind || null, kindTable, kindIndex);
            const signatureId = pushTable(entry.signature ?? null, signatureTable, signatureIndex);
            yield [
              fileId,
              entry.ext || null,
              entry.name || null,
              kindId,
              signatureId,
              Number.isFinite(entry.startLine) ? entry.startLine : null,
              Number.isFinite(entry.endLine) ? entry.endLine : null,
              entry.exported ? 1 : 0
            ];
          }
        };
        const result = await schedule(() => writeJsonLinesSharded({
          dir: outDir,
          partsDirName: 'repo_map.parts',
          partPrefix: 'repo_map.part-',
          items: deltaItems(),
          maxBytes: maxJsonBytes,
          atomic: true,
          compression: repoMapCompression,
          gzipOptions: repoMapCompression === 'gzip' ? compressionGzipOptions : null
        }));
        const parts = result.parts.map((part, index) => ({
          path: part,
          records: result.counts[index] || 0,
          bytes: result.bytes[index] || 0
        }));
        const deltaExtensions = deltaEnabled ? {
          schemaVersion: 1,
          format: 'repo_map.delta.v1',
          row: ['fileId', 'ext', 'name', 'kindId', 'signatureId', 'startLine', 'endLine', 'exported'],
          tables: {
            kind: kindTable,
            signature: signatureTable
          },
          ...(repoMapMeasurement?.delta?.ratio != null ? { ratio: repoMapMeasurement.delta.ratio } : {})
        } : null;
        await schedule(() => writeJsonObjectFile(repoMapMetaPath, {
          fields: {
            schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
            artifact: 'repo_map',
            format: 'jsonl-sharded',
            generatedAt: new Date().toISOString(),
            compression: repoMapCompression || 'none',
            totalRecords: result.total,
            totalBytes: result.totalBytes,
            maxPartRecords: result.maxPartRecords,
            maxPartBytes: result.maxPartBytes,
            targetMaxBytes: result.targetMaxBytes,
            parts
          },
          atomic: true
        }));
        await removeRepoMapJson();
        await removeRepoMapJsonl();
        for (let i = 0; i < result.parts.length; i += 1) {
          const relPath = result.parts[i];
          const absPath = path.join(outDir, fromPosix(relPath));
          addPieceFile({
            type: 'chunks',
            name: 'repo_map',
            format: 'jsonl',
            count: result.counts[i] || 0,
            compression: repoMapCompression || null
          }, absPath);
        }
        addPieceFile({ type: 'chunks', name: 'repo_map_meta', format: 'json' }, repoMapMetaPath);
        if (deltaExtensions) {
          await schedule(() => writeJsonObjectFile(repoMapMetaPath, {
            fields: {
              schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
              artifact: 'repo_map',
              format: 'jsonl-sharded',
              generatedAt: new Date().toISOString(),
              compression: repoMapCompression || 'none',
              totalRecords: result.total,
              totalBytes: result.totalBytes,
              maxPartRecords: result.maxPartRecords,
              maxPartBytes: result.maxPartBytes,
              targetMaxBytes: result.targetMaxBytes,
              parts,
              extensions: { delta: deltaExtensions }
            },
            atomic: true
          }));
        }
      }
    );
  }
}
