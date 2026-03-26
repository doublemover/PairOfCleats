import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from './file-read.js';
import { createTempPath, replaceFile } from './json-stream.js';
import { joinPathSafe } from './path-normalize.js';
import {
  normalizeDenseVectorMeta,
  resolveDenseVectorCountFromBuffer
} from './dense-vector-meta.js';

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

const DENSE_BINARY_WRITE_CHUNK_BYTES = 1024 * 1024;

const fillDenseBinaryRow = (buffer, offset, rowWidth, vec) => {
  buffer.fill(0, offset, offset + rowWidth);
  if (!vec || typeof vec.length !== 'number') return;
  if (ArrayBuffer.isView(vec) && vec.BYTES_PER_ELEMENT === 1) {
    const copyLength = Math.min(rowWidth, Math.max(0, Math.floor(Number(vec.length) || 0)));
    if (copyLength <= 0) return;
    const source = new Uint8Array(vec.buffer, vec.byteOffset, copyLength);
    buffer.set(source, offset);
    return;
  }
  for (let i = 0; i < rowWidth; i += 1) {
    const value = Number(vec[i]);
    buffer[offset + i] = Number.isFinite(value)
      ? Math.max(0, Math.min(255, Math.floor(value)))
      : 0;
  }
};

/**
 * Stream a uint8 row-major dense vector binary artifact to disk atomically.
 *
 * @param {{
 *   binPath:string,
 *   vectors:Array<any>,
 *   dims:number
 * }} input
 * @returns {Promise<{count:number,rowWidth:number,totalBytes:number}>}
 */
export const writeDenseVectorBinaryFile = async ({
  binPath,
  vectors,
  dims
}) => {
  const count = Array.isArray(vectors) ? vectors.length : 0;
  const rowWidth = toPositiveInteger(dims);
  const totalBytes = rowWidth > 0 ? rowWidth * count : 0;
  const tempBinPath = createTempPath(binPath);
  await fsPromises.mkdir(path.dirname(binPath), { recursive: true });
  const handle = await fsPromises.open(tempBinPath, 'w');
  try {
    if (rowWidth > 0 && count > 0) {
      const rowsPerChunk = Math.max(1, Math.floor(DENSE_BINARY_WRITE_CHUNK_BYTES / rowWidth));
      const chunk = Buffer.alloc(rowsPerChunk * rowWidth);
      let chunkRows = 0;
      const flushChunk = async () => {
        if (chunkRows <= 0) return;
        const bytesToWrite = chunkRows * rowWidth;
        await handle.write(chunk, 0, bytesToWrite);
        chunkRows = 0;
      };
      for (let docId = 0; docId < count; docId += 1) {
        const rowOffset = chunkRows * rowWidth;
        fillDenseBinaryRow(chunk, rowOffset, rowWidth, vectors[docId]);
        chunkRows += 1;
        if (chunkRows >= rowsPerChunk) {
          await flushChunk();
        }
      }
      await flushChunk();
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  await replaceFile(tempBinPath, binPath);
  return { count, rowWidth, totalBytes };
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
