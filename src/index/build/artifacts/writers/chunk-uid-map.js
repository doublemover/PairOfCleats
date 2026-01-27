import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_JSON_BYTES } from '../../../../shared/artifact-io.js';
import { ensureDiskSpace } from '../../../../shared/disk-space.js';
import {
  writeJsonLinesFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../../contracts/versioning.js';

const resolveJsonlExtension = (value) => {
  if (value === 'gzip') return 'jsonl.gz';
  if (value === 'zstd') return 'jsonl.zst';
  return 'jsonl';
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

const buildRows = (chunks) => {
  const rows = [];
  for (const chunk of chunks || []) {
    if (!chunk || !Number.isFinite(chunk.id)) continue;
    rows.push({
      docId: chunk.id,
      chunkUid: chunk.chunkUid || chunk.metaV2?.chunkUid || null,
      chunkId: chunk.chunkId || chunk.metaV2?.chunkId || null,
      file: chunk.file || chunk.metaV2?.file || null,
      segmentUid: chunk.segment?.segmentUid || chunk.metaV2?.segment?.segmentUid || null,
      segmentId: chunk.segment?.segmentId || chunk.metaV2?.segment?.segmentId || null,
      start: Number.isFinite(chunk.start) ? chunk.start : null,
      end: Number.isFinite(chunk.end) ? chunk.end : null
    });
  }
  rows.sort((a, b) => a.docId - b.docId);
  return rows;
};

export const enqueueChunkUidMapArtifacts = async ({
  outDir,
  mode,
  chunks,
  maxJsonBytes = MAX_JSON_BYTES,
  compression = null,
  gzipOptions = null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
}) => {
  const rows = buildRows(chunks);
  if (!rows.length) {
    await fs.rm(path.join(outDir, 'chunk_uid_map.jsonl'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'chunk_uid_map.jsonl.gz'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'chunk_uid_map.jsonl.zst'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'chunk_uid_map.meta.json'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'chunk_uid_map.parts'), { recursive: true, force: true }).catch(() => {});
    return;
  }

  const measurement = measureRows(rows);
  if (maxJsonBytes && measurement.maxLineBytes > maxJsonBytes) {
    throw new Error(`chunk_uid_map row exceeds max JSON size (${measurement.maxLineBytes} bytes).`);
  }
  const useShards = maxJsonBytes && measurement.totalBytes > maxJsonBytes;
  const jsonlExtension = resolveJsonlExtension(compression);
  const jsonlName = `chunk_uid_map.${jsonlExtension}`;
  const jsonlPath = path.join(outDir, jsonlName);

  const removeArtifact = async (targetPath) => {
    try { await fs.rm(targetPath, { recursive: true, force: true }); } catch {}
  };

  if (useShards) {
    await removeArtifact(path.join(outDir, 'chunk_uid_map.jsonl'));
    await removeArtifact(path.join(outDir, 'chunk_uid_map.jsonl.gz'));
    await removeArtifact(path.join(outDir, 'chunk_uid_map.jsonl.zst'));
  } else {
    await removeArtifact(path.join(outDir, 'chunk_uid_map.meta.json'));
    await removeArtifact(path.join(outDir, 'chunk_uid_map.parts'));
  }

  await ensureDiskSpace({
    targetPath: outDir,
    requiredBytes: measurement.totalBytes,
    label: mode ? `${mode} chunk_uid_map` : 'chunk_uid_map'
  });

  if (useShards) {
    const metaPath = path.join(outDir, 'chunk_uid_map.meta.json');
    enqueueWrite(
      formatArtifactLabel(metaPath),
      async () => {
        const result = await writeJsonLinesSharded({
          dir: outDir,
          partsDirName: 'chunk_uid_map.parts',
          partPrefix: 'chunk_uid_map.part-',
          items: rows,
          maxBytes: maxJsonBytes,
          maxItems: 100000,
          atomic: true,
          compression,
          gzipOptions
        });
        const parts = result.parts.map((part, index) => ({
          path: part,
          records: result.counts[index] || 0,
          bytes: result.bytes[index] || 0
        }));
        await writeJsonObjectFile(metaPath, {
          fields: {
            schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
            artifact: 'chunk_uid_map',
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
            type: 'tooling',
            name: 'chunk_uid_map',
            format: 'jsonl',
            count: result.counts[i] || 0,
            compression: compression || null
          }, absPath);
        }
        addPieceFile({ type: 'tooling', name: 'chunk_uid_map_meta', format: 'json' }, metaPath);
      }
    );
    return;
  }

  enqueueWrite(
    formatArtifactLabel(jsonlPath),
    () => writeJsonLinesFile(jsonlPath, rows, { atomic: true, compression, gzipOptions })
  );
  addPieceFile({
    type: 'tooling',
    name: 'chunk_uid_map',
    format: 'jsonl',
    count: rows.length,
    compression: compression || null
  }, jsonlPath);
};
