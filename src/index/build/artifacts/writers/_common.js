import path from 'node:path';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../../contracts/versioning.js';
import { resolveJsonlExtension, writeJsonObjectFile } from '../../../../shared/json-stream.js';
import { removePathWithRetry } from '../../../../shared/io/remove-path-with-retry.js';
export { resolveJsonlExtension };

export const resolveJsonExtension = (value) => {
  if (value === 'gzip') return 'json.gz';
  if (value === 'zstd') return 'json.zst';
  return 'json';
};

export const measureJsonlRows = (rows, { serialize = JSON.stringify } = {}) => {
  let totalBytes = 0;
  let maxLineBytes = 0;
  for (const row of rows || []) {
    const line = serialize(row);
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
    totalBytes += lineBytes;
    if (lineBytes > maxLineBytes) maxLineBytes = lineBytes;
  }
  return { totalBytes, maxLineBytes };
};

export const removeArtifacts = async (targetPaths) => {
  for (const targetPath of targetPaths || []) {
    if (!targetPath) continue;
    await removePathWithRetry(targetPath, { recursive: true, force: true });
  }
};

export const buildJsonlVariantPaths = ({ outDir, baseName, includeOffsets = false } = {}) => {
  if (!outDir || !baseName) return [];
  const paths = [
    path.join(outDir, `${baseName}.jsonl`),
    path.join(outDir, `${baseName}.jsonl.gz`),
    path.join(outDir, `${baseName}.jsonl.zst`)
  ];
  if (includeOffsets) {
    paths.push(path.join(outDir, `${baseName}.jsonl.offsets.bin`));
  }
  return paths;
};

export const buildJsonVariantPaths = ({ outDir, baseName } = {}) => {
  if (!outDir || !baseName) return [];
  return [
    path.join(outDir, `${baseName}.json`),
    path.join(outDir, `${baseName}.json.gz`),
    path.join(outDir, `${baseName}.json.zst`)
  ];
};

export const buildShardedPartEntries = (result) => (result?.parts || []).map((part, index) => ({
  path: part,
  records: result?.counts?.[index] || 0,
  bytes: result?.bytes?.[index] || 0
}));

export const buildShardedJsonlMetaFields = ({
  artifact,
  compression = null,
  result,
  parts = [],
  extensions = undefined,
  extraFields = null
} = {}) => ({
  schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
  artifact,
  format: 'jsonl-sharded',
  generatedAt: new Date().toISOString(),
  compression: compression || 'none',
  totalRecords: result?.total ?? 0,
  totalBytes: result?.totalBytes ?? 0,
  maxPartRecords: result?.maxPartRecords ?? 0,
  maxPartBytes: result?.maxPartBytes ?? 0,
  targetMaxBytes: result?.targetMaxBytes ?? null,
  ...(extensions ? { extensions } : {}),
  ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
  parts
});

export const writeShardedJsonlMeta = async ({
  metaPath,
  artifact,
  compression = null,
  result,
  parts = [],
  extensions = undefined,
  extraFields = null
} = {}) => {
  await writeJsonObjectFile(metaPath, {
    fields: buildShardedJsonlMetaFields({
      artifact,
      compression,
      result,
      parts,
      extensions,
      extraFields
    }),
    atomic: true
  });
};
