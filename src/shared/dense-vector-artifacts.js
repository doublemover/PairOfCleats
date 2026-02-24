import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from './files.js';
import { joinPathSafe } from './path-normalize.js';
import {
  createTempPath,
  replaceFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from './json-stream.js';

export const DENSE_VECTOR_BINARY_ARTIFACTS = Object.freeze({
  dense_vectors: Object.freeze({
    baseName: 'dense_vectors_uint8',
    metaName: 'dense_vectors_binary_meta',
    binName: 'dense_vectors'
  }),
  dense_vectors_doc: Object.freeze({
    baseName: 'dense_vectors_doc_uint8',
    metaName: 'dense_vectors_doc_binary_meta',
    binName: 'dense_vectors_doc'
  }),
  dense_vectors_code: Object.freeze({
    baseName: 'dense_vectors_code_uint8',
    metaName: 'dense_vectors_code_binary_meta',
    binName: 'dense_vectors_code'
  })
});

/**
 * Resolve dense-vector binary artifact naming details from logical artifact name.
 *
 * @param {string} artifactName
 * @returns {{baseName:string,metaName:string,binName:string}|null}
 */
export const resolveDenseVectorBinaryArtifact = (artifactName) => {
  if (typeof artifactName !== 'string') return null;
  return DENSE_VECTOR_BINARY_ARTIFACTS[artifactName] || null;
};

const toPositiveInteger = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : 0;
};

/**
 * Normalize dense-vector metadata envelopes that may be wrapped in `{fields}`.
 *
 * @param {any} metaRaw
 * @returns {Record<string, any>|null}
 */
export const normalizeDenseVectorMeta = (metaRaw) => {
  const raw = metaRaw?.fields && typeof metaRaw.fields === 'object'
    ? metaRaw.fields
    : metaRaw;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw;
};

const resolveDenseVectorCountFromBuffer = (meta, bufferLength) => {
  const dims = toPositiveInteger(meta?.dims);
  if (!dims) {
    return { dims: 0, count: 0, requiredBytes: 0 };
  }
  const countFromMeta = toPositiveInteger(meta?.count);
  const countFromBuffer = Math.floor(Math.max(0, bufferLength) / dims);
  const count = countFromMeta || countFromBuffer;
  return {
    dims,
    count,
    requiredBytes: dims * count
  };
};

const hydrateDenseVectorFromBinaryBuffer = ({
  buffer,
  meta,
  baseName,
  modelId = null
}) => {
  const normalizedMeta = normalizeDenseVectorMeta(meta);
  if (!normalizedMeta) return null;
  const relPath = typeof normalizedMeta.path === 'string' && normalizedMeta.path
    ? normalizedMeta.path
    : `${baseName}.bin`;
  const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const { dims, count, requiredBytes } = resolveDenseVectorCountFromBuffer(normalizedMeta, view.length);
  if (!dims || !count || view.length < requiredBytes) return null;
  return {
    ...normalizedMeta,
    model: normalizedMeta.model || modelId || null,
    dims,
    count,
    path: relPath,
    buffer: view
  };
};

/**
 * Load one dense-vector binary payload from a parsed `.bin.meta.json` envelope.
 *
 * @param {{
 *   dir:string,
 *   baseName:string,
 *   meta:any,
 *   modelId?:string|null
 * }} input
 * @returns {Promise<object|null>}
 */
export const loadDenseVectorBinaryFromMetaAsync = async ({
  dir,
  baseName,
  meta,
  modelId = null
}) => {
  const normalizedMeta = normalizeDenseVectorMeta(meta);
  if (!dir || !baseName || !normalizedMeta) return null;
  const relPath = typeof normalizedMeta.path === 'string' && normalizedMeta.path
    ? normalizedMeta.path
    : `${baseName}.bin`;
  const absPath = joinPathSafe(dir, [relPath]);
  if (!absPath) return null;
  if (!await pathExists(absPath)) return null;
  try {
    const buffer = await fsPromises.readFile(absPath);
    return hydrateDenseVectorFromBinaryBuffer({
      buffer,
      meta: normalizedMeta,
      baseName,
      modelId
    });
  } catch {
    return null;
  }
};

/**
 * Synchronous variant of dense-vector binary payload loading.
 *
 * @param {{
 *   dir:string,
 *   baseName:string,
 *   meta:any,
 *   modelId?:string|null
 * }} input
 * @returns {object|null}
 */
export const loadDenseVectorBinaryFromMetaSync = ({
  dir,
  baseName,
  meta,
  modelId = null
}) => {
  const normalizedMeta = normalizeDenseVectorMeta(meta);
  if (!dir || !baseName || !normalizedMeta) return null;
  const relPath = typeof normalizedMeta.path === 'string' && normalizedMeta.path
    ? normalizedMeta.path
    : `${baseName}.bin`;
  const absPath = joinPathSafe(dir, [relPath]);
  if (!absPath || !fs.existsSync(absPath)) return null;
  try {
    const buffer = fs.readFileSync(absPath);
    return hydrateDenseVectorFromBinaryBuffer({
      buffer,
      meta: normalizedMeta,
      baseName,
      modelId
    });
  } catch {
    return null;
  }
};

/**
 * Check whether a dense-vector payload has usable vectors or binary buffer data.
 *
 * @param {any} denseVec
 * @returns {boolean}
 */
export const isDenseVectorPayloadAvailable = (denseVec) => {
  if (Array.isArray(denseVec?.vectors) && denseVec.vectors.length > 0) return true;
  const buffer = denseVec?.buffer;
  if (!ArrayBuffer.isView(buffer) || buffer.BYTES_PER_ELEMENT !== 1) return false;
  const { dims, count, requiredBytes } = resolveDenseVectorCountFromBuffer(denseVec, buffer.length);
  return !!(dims && count && buffer.length >= requiredBytes);
};

/**
 * Materialize dense-vector rows from either `vectors[]` payloads or binary buffers.
 *
 * @param {any} denseVec
 * @returns {Array<Uint8Array|number[]>}
 */
export const materializeDenseVectorRows = (denseVec) => {
  if (Array.isArray(denseVec?.vectors)) return denseVec.vectors;
  const buffer = denseVec?.buffer;
  if (!ArrayBuffer.isView(buffer) || buffer.BYTES_PER_ELEMENT !== 1) return [];
  const { dims, count, requiredBytes } = resolveDenseVectorCountFromBuffer(denseVec, buffer.length);
  if (!dims || !count || buffer.length < requiredBytes) return [];
  const rows = new Array(count);
  for (let row = 0; row < count; row += 1) {
    const start = row * dims;
    rows[row] = buffer.subarray(start, start + dims);
  }
  return rows;
};

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
    await fsPromises.writeFile(tempBinPath, bytes);
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
  return { metaPath, binPath, binMetaPath };
};
