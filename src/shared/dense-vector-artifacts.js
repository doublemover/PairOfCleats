import path from 'node:path';
import {
  writeJsonLinesSharded,
  writeJsonObjectFile
} from './json-stream.js';
export {
  DENSE_VECTOR_BINARY_ARTIFACTS,
  loadDenseVectorBinaryFromMetaAsync,
  loadDenseVectorBinaryFromMetaSync,
  resolveDenseVectorBinaryArtifact,
  writeDenseVectorBinaryFile
} from './dense-vector-binary.js';
export {
  isDenseVectorPayloadAvailable,
  materializeDenseVectorRows,
  normalizeDenseVectorMeta
} from './dense-vector-meta.js';
import { writeDenseVectorBinaryFile } from './dense-vector-binary.js';

/**
 * Write dense-vector artifacts in JSONL-sharded and optional binary form.
 *
 * Monolithic JSON output is intentionally disabled so downstream ANN backends
 * and validation paths consume only sharded/binary artifacts.
 *
 * @param {{
 *   indexDir:string,
 *   baseName:string,
 *   vectorFields:Record<string, any>,
 *   vectors:any[],
 *   shardMaxBytes?:number,
 *   writeBinary?:boolean
 * }} input
 * @returns {Promise<{metaPath:string,binPath:string|null,binMetaPath:string|null}>}
 */
export const writeDenseVectorArtifacts = async ({
  indexDir,
  baseName,
  vectorFields,
  vectors,
  shardMaxBytes = 8 * 1024 * 1024,
  writeBinary = false
}) => {
  const rowIterable = {
    [Symbol.iterator]: function* iterateRows() {
      for (let i = 0; i < vectors.length; i += 1) {
        yield { vector: vectors[i] };
      }
    }
  };
  const sharded = await writeJsonLinesSharded({
    dir: indexDir,
    partsDirName: `${baseName}.parts`,
    partPrefix: `${baseName}.part-`,
    items: rowIterable,
    maxBytes: shardMaxBytes,
    atomic: true,
    offsets: { suffix: 'offsets.bin' }
  });
  const parts = sharded.parts.map((part, index) => ({
    path: part,
    records: sharded.counts[index] || 0,
    bytes: sharded.bytes[index] || 0
  }));
  const metaPath = path.join(indexDir, `${baseName}.meta.json`);
  await writeJsonObjectFile(metaPath, {
    fields: {
      schemaVersion: '1.0.0',
      artifact: baseName,
      format: 'jsonl-sharded',
      generatedAt: new Date().toISOString(),
      compression: 'none',
      totalRecords: sharded.total,
      totalBytes: sharded.totalBytes,
      maxPartRecords: sharded.maxPartRecords,
      maxPartBytes: sharded.maxPartBytes,
      targetMaxBytes: sharded.targetMaxBytes,
      parts,
      offsets: sharded.offsets || [],
      ...vectorFields
    },
    atomic: true
  });
  let binPath = null;
  let binMetaPath = null;
  if (writeBinary) {
    binPath = path.join(indexDir, `${baseName}.bin`);
    const binaryWrite = await writeDenseVectorBinaryFile({
      binPath,
      vectors,
      dims: vectorFields?.dims
    });
    binMetaPath = path.join(indexDir, `${baseName}.bin.meta.json`);
    await writeJsonObjectFile(binMetaPath, {
      fields: {
        schemaVersion: '1.0.0',
        artifact: baseName,
        format: 'uint8-row-major',
        generatedAt: new Date().toISOString(),
        path: path.basename(binPath),
        count: binaryWrite.count,
        dims: binaryWrite.rowWidth,
        bytes: binaryWrite.totalBytes,
        ...vectorFields
      },
      atomic: true
    });
  }
  return { metaPath, binPath, binMetaPath };
};
