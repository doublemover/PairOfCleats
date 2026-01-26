import path from 'node:path';
import { writeJsonArrayFile, writeJsonLinesSharded, writeJsonObjectFile } from '../../../shared/json-stream.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../contracts/versioning.js';

export function measureRepoMap({ repoMapIterator, maxJsonBytes }) {
  let totalEntries = 0;
  let totalBytes = 2;
  let totalJsonlBytes = 0;
  for (const entry of repoMapIterator()) {
    const line = JSON.stringify(entry);
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (maxJsonBytes && (lineBytes + 1) > maxJsonBytes) {
      throw new Error(`repo_map entry exceeds max JSON size (${lineBytes} bytes).`);
    }
    totalBytes += lineBytes + (totalEntries > 0 ? 1 : 0);
    totalJsonlBytes += lineBytes + 1;
    totalEntries += 1;
  }
  return { totalEntries, totalBytes, totalJsonlBytes };
}

export async function enqueueRepoMapArtifacts({
  outDir,
  repoMapIterator,
  repoMapMeasurement,
  useRepoMapJsonl,
  maxJsonBytes,
  repoMapCompression,
  compressionGzipOptions,
  log,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  removeArtifact
}) {
  const resolveJsonExtension = (value) => {
    if (value === 'gzip') return 'json.gz';
    if (value === 'zstd') return 'json.zst';
    return 'json';
  };
  const repoMapPath = path.join(outDir, `repo_map.${resolveJsonExtension(repoMapCompression)}`);
  const repoMapMetaPath = path.join(outDir, 'repo_map.meta.json');
  const repoMapPartsDir = path.join(outDir, 'repo_map.parts');
  const removeRepoMapJsonl = async () => {
    await removeArtifact(path.join(outDir, 'repo_map.jsonl'));
    await removeArtifact(path.join(outDir, 'repo_map.jsonl.gz'));
    await removeArtifact(path.join(outDir, 'repo_map.jsonl.zst'));
  };
  const removeRepoMapJson = async () => {
    await removeArtifact(path.join(outDir, 'repo_map.json'));
    await removeArtifact(path.join(outDir, 'repo_map.json.gz'));
    await removeArtifact(path.join(outDir, 'repo_map.json.zst'));
  };

  if (!useRepoMapJsonl) {
    enqueueWrite(
      formatArtifactLabel(repoMapPath),
      async () => {
        await removeRepoMapJsonl();
        await removeRepoMapJson();
        await removeArtifact(repoMapMetaPath);
        await removeArtifact(repoMapPartsDir);
        await writeJsonArrayFile(repoMapPath, repoMapIterator(), {
          atomic: true,
          compression: repoMapCompression
        });
      }
    );
    addPieceFile({
      type: 'chunks',
      name: 'repo_map',
      format: 'json',
      compression: repoMapCompression || null
    }, repoMapPath);
  } else {
    log(`repo_map ~${Math.round(repoMapMeasurement.totalJsonlBytes / 1024)}KB; writing JSONL shards.`);
    enqueueWrite(
      formatArtifactLabel(repoMapMetaPath),
      async () => {
        await removeRepoMapJson();
        await removeRepoMapJsonl();
        const result = await writeJsonLinesSharded({
          dir: outDir,
          partsDirName: 'repo_map.parts',
          partPrefix: 'repo_map.part-',
          items: repoMapIterator(),
          maxBytes: maxJsonBytes,
          atomic: true,
          compression: repoMapCompression,
          gzipOptions: repoMapCompression === 'gzip' ? compressionGzipOptions : null
        });
        const parts = result.parts.map((part, index) => ({
          path: part,
          records: result.counts[index] || 0,
          bytes: result.bytes[index] || 0
        }));
        await writeJsonObjectFile(repoMapMetaPath, {
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
        });
        for (let i = 0; i < result.parts.length; i += 1) {
          const relPath = result.parts[i];
          const absPath = path.join(outDir, relPath.split('/').join(path.sep));
          addPieceFile({
            type: 'chunks',
            name: 'repo_map',
            format: 'jsonl',
            count: result.counts[i] || 0,
            compression: repoMapCompression || null
          }, absPath);
        }
        addPieceFile({ type: 'chunks', name: 'repo_map_meta', format: 'json' }, repoMapMetaPath);
      }
    );
  }
}
