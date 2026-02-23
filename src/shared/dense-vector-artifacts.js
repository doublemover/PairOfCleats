import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createTempPath,
  replaceFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from './json-stream.js';

/**
 * Write dense-vector artifacts in JSON, JSONL-sharded, and optional binary form.
 *
 * @param {{
 *   indexDir:string,
 *   baseName:string,
 *   vectorFields:Record<string, any>,
 *   vectors:any[],
 *   shardMaxBytes?:number,
 *   writeBinary?:boolean
 * }} input
 * @returns {Promise<{jsonPath:string,metaPath:string,binPath:string|null,binMetaPath:string|null}>}
 */
export const writeDenseVectorArtifacts = async ({
  indexDir,
  baseName,
  vectorFields,
  vectors,
  shardMaxBytes = 8 * 1024 * 1024,
  writeBinary = false
}) => {
  const jsonPath = path.join(indexDir, `${baseName}.json`);
  await writeJsonObjectFile(jsonPath, {
    fields: vectorFields,
    arrays: { vectors },
    atomic: true
  });
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
    const dims = Number(vectorFields?.dims);
    const count = Array.isArray(vectors) ? vectors.length : 0;
    const rowWidth = Number.isFinite(dims) && dims > 0 ? Math.floor(dims) : 0;
    const totalBytes = rowWidth > 0 ? rowWidth * count : 0;
    const bytes = Buffer.alloc(totalBytes);
    for (let docId = 0; docId < count; docId += 1) {
      const vec = vectors[docId];
      if (!vec || typeof vec.length !== 'number') continue;
      const start = docId * rowWidth;
      const end = start + rowWidth;
      if (end > bytes.length) break;
      if (ArrayBuffer.isView(vec) && vec.BYTES_PER_ELEMENT === 1) {
        bytes.set(vec.subarray(0, rowWidth), start);
        continue;
      }
      for (let i = 0; i < rowWidth; i += 1) {
        const value = Number(vec[i]);
        bytes[start + i] = Number.isFinite(value)
          ? Math.max(0, Math.min(255, Math.floor(value)))
          : 0;
      }
    }
    binPath = path.join(indexDir, `${baseName}.bin`);
    const tempBinPath = createTempPath(binPath);
    await fs.writeFile(tempBinPath, bytes);
    await replaceFile(tempBinPath, binPath);
    binMetaPath = path.join(indexDir, `${baseName}.bin.meta.json`);
    await writeJsonObjectFile(binMetaPath, {
      fields: {
        schemaVersion: '1.0.0',
        artifact: baseName,
        format: 'uint8-row-major',
        generatedAt: new Date().toISOString(),
        path: path.basename(binPath),
        count,
        dims: rowWidth,
        bytes: totalBytes,
        ...vectorFields
      },
      atomic: true
    });
  }
  return { jsonPath, metaPath, binPath, binMetaPath };
};
