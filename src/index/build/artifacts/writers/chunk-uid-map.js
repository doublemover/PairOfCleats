import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_JSON_BYTES } from '../../../../shared/artifact-io.js';
import { ensureDiskSpace } from '../../../../shared/disk-space.js';
import {
  writeJsonLinesFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
import { fromPosix } from '../../../../shared/files.js';
import { applyByteBudget } from '../../byte-budget.js';
import {
  buildJsonlVariantPaths,
  buildShardedPartEntries,
  measureJsonlRows,
  removeArtifacts,
  resolveJsonlExtension,
  writeShardedJsonlMeta
} from './_common.js';

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
  byteBudget = null,
  compression = null,
  gzipOptions = null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  stageCheckpoints
}) => {
  const rows = buildRows(chunks);
  if (!rows.length) {
    await removeArtifacts([
      ...buildJsonlVariantPaths({ outDir, baseName: 'chunk_uid_map' }),
      path.join(outDir, 'chunk_uid_map.meta.json'),
      path.join(outDir, 'chunk_uid_map.parts')
    ]);
    return;
  }

  const measurement = measureJsonlRows(rows);
  if (maxJsonBytes && measurement.maxLineBytes > maxJsonBytes) {
    throw new Error(`chunk_uid_map row exceeds max JSON size (${measurement.maxLineBytes} bytes).`);
  }
  applyByteBudget({
    budget: byteBudget,
    totalBytes: measurement.totalBytes,
    label: 'chunk_uid_map',
    stageCheckpoints,
    logger: null
  });
  const useShards = maxJsonBytes && measurement.totalBytes > maxJsonBytes;
  const jsonlExtension = resolveJsonlExtension(compression);
  const jsonlName = `chunk_uid_map.${jsonlExtension}`;
  const jsonlPath = path.join(outDir, jsonlName);

  if (useShards) {
    await removeArtifacts(buildJsonlVariantPaths({ outDir, baseName: 'chunk_uid_map' }));
  } else {
    await removeArtifacts([
      path.join(outDir, 'chunk_uid_map.meta.json'),
      path.join(outDir, 'chunk_uid_map.parts')
    ]);
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
        const parts = buildShardedPartEntries(result);
        await writeShardedJsonlMeta({
          metaPath,
          artifact: 'chunk_uid_map',
          compression,
          result,
          parts
        });
        for (let i = 0; i < result.parts.length; i += 1) {
          const relPath = result.parts[i];
          const absPath = path.join(outDir, fromPosix(relPath));
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
