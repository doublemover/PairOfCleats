import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../../../shared/progress.js';
import { MAX_JSON_BYTES } from '../../../../shared/artifact-io.js';
import { ensureDiskSpace } from '../../../../shared/disk-space.js';
import {
  writeJsonLinesFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../../contracts/versioning.js';

const MAX_ROW_BYTES = 32 * 1024;

const sortVfsRows = (rows) => rows.sort((a, b) => {
  if (a.containerPath !== b.containerPath) return a.containerPath.localeCompare(b.containerPath);
  if (a.segmentStart !== b.segmentStart) return a.segmentStart - b.segmentStart;
  if (a.segmentEnd !== b.segmentEnd) return a.segmentEnd - b.segmentEnd;
  if (a.languageId !== b.languageId) return a.languageId.localeCompare(b.languageId);
  if (a.effectiveExt !== b.effectiveExt) return a.effectiveExt.localeCompare(b.effectiveExt);
  const segA = a.segmentUid || '';
  const segB = b.segmentUid || '';
  if (segA !== segB) return segA.localeCompare(segB);
  return a.virtualPath.localeCompare(b.virtualPath);
});

const maybeTrimRow = (row) => {
  const bytes = Buffer.byteLength(JSON.stringify(row), 'utf8');
  if (bytes <= MAX_ROW_BYTES) return row;
  let trimmed = { ...row };
  if (trimmed.extensions) delete trimmed.extensions;
  let trimmedBytes = Buffer.byteLength(JSON.stringify(trimmed), 'utf8');
  if (trimmedBytes <= MAX_ROW_BYTES) return trimmed;
  if (trimmed.segmentId) trimmed.segmentId = null;
  trimmedBytes = Buffer.byteLength(JSON.stringify(trimmed), 'utf8');
  if (trimmedBytes <= MAX_ROW_BYTES) return trimmed;
  return null;
};

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

export const enqueueVfsManifestArtifacts = async ({
  outDir,
  mode,
  rows,
  maxJsonBytes = MAX_JSON_BYTES,
  compression = null,
  gzipOptions = null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
}) => {
  const vfsRows = Array.isArray(rows) ? rows.slice() : [];
  const trimmedRows = vfsRows
    .map((row) => maybeTrimRow(row))
    .filter(Boolean);
  if (!trimmedRows.length) {
    await fs.rm(path.join(outDir, 'vfs_manifest.jsonl'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'vfs_manifest.jsonl.gz'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'vfs_manifest.jsonl.zst'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'vfs_manifest.meta.json'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(outDir, 'vfs_manifest.parts'), { recursive: true, force: true }).catch(() => {});
    return;
  }
  sortVfsRows(trimmedRows);
  const measurement = measureRows(trimmedRows);
  if (maxJsonBytes && measurement.maxLineBytes > maxJsonBytes) {
    throw new Error(`vfs_manifest row exceeds max JSON size (${measurement.maxLineBytes} bytes).`);
  }
  const useShards = maxJsonBytes && measurement.totalBytes > maxJsonBytes;
  const jsonlExtension = resolveJsonlExtension(compression);
  const jsonlName = `vfs_manifest.${jsonlExtension}`;
  const jsonlPath = path.join(outDir, jsonlName);
  const removeArtifact = async (targetPath) => {
    try { await fs.rm(targetPath, { recursive: true, force: true }); } catch {}
  };
  if (useShards) {
    await removeArtifact(path.join(outDir, 'vfs_manifest.jsonl'));
    await removeArtifact(path.join(outDir, 'vfs_manifest.jsonl.gz'));
    await removeArtifact(path.join(outDir, 'vfs_manifest.jsonl.zst'));
  } else {
    await removeArtifact(path.join(outDir, 'vfs_manifest.meta.json'));
    await removeArtifact(path.join(outDir, 'vfs_manifest.parts'));
  }
  await ensureDiskSpace({
    targetPath: outDir,
    requiredBytes: measurement.totalBytes,
    label: mode ? `${mode} vfs_manifest` : 'vfs_manifest'
  });

  if (useShards) {
    const metaPath = path.join(outDir, 'vfs_manifest.meta.json');
    enqueueWrite(
      formatArtifactLabel(metaPath),
      async () => {
        const result = await writeJsonLinesSharded({
          dir: outDir,
          partsDirName: 'vfs_manifest.parts',
          partPrefix: 'vfs_manifest.part-',
          items: trimmedRows,
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
            artifact: 'vfs_manifest',
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
            name: 'vfs_manifest',
            format: 'jsonl',
            count: result.counts[i] || 0,
            compression: compression || null
          }, absPath);
        }
        addPieceFile({ type: 'tooling', name: 'vfs_manifest_meta', format: 'json' }, metaPath);
      }
    );
    return;
  }

  enqueueWrite(
    formatArtifactLabel(jsonlPath),
    () => writeJsonLinesFile(
      jsonlPath,
      trimmedRows,
      { atomic: true, compression, gzipOptions }
    )
  );
  addPieceFile({
    type: 'tooling',
    name: 'vfs_manifest',
    format: 'jsonl',
    count: trimmedRows.length,
    compression: compression || null
  }, jsonlPath);
  if (measurement.totalBytes > MAX_JSON_BYTES * 0.9) {
    log(`[vfs] vfs_manifest ~${Math.round(measurement.totalBytes / 1024)}KB; consider sharding.`);
  }
};
