import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createTempPath, replaceFile } from './json-stream/atomic.js';
import { joinPathSafe } from './path-normalize.js';
import { resolveBinaryArtifactPath } from './artifact-io/manifest.js';
import { decodeDenseVectorValidity } from './dense-vector-validity.js';
import { assertQuantizedEmbeddingRow, resolveEmbeddingQuantizationSpec, resolveDenseQuantizationSpec } from './embedding-quantization-spec.js';
import { readVerifiedContainedFile, readVerifiedContainedFileSync } from './contained-file.js';
import { createContainedFileResource } from './contained-file-resource.js';
import { observeStorageResource } from './storage/failure-observation.js';
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
  return Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
};

const DENSE_BINARY_WRITE_CHUNK_BYTES = 1024 * 1024;

/** Bind metadata-selected bytes to the strict manifest's binary authority. */
export const resolveDenseVectorBinaryPayloadPath = ({ dir, baseName, meta, manifest = null, strict = false }) => {
  const relPath = typeof meta?.path === 'string' && meta.path ? meta.path : `${baseName}.bin`;
  const selectedPath = joinPathSafe(dir, [relPath]);
  if (!selectedPath) {
    if (strict) throw Object.assign(new Error(`Invalid dense vector binary path: ${relPath}`), { code: 'ERR_MANIFEST_PATH' });
    return null;
  }
  if (!strict) return selectedPath;
  const descriptor = Object.values(DENSE_VECTOR_BINARY_ARTIFACTS).find(entry => entry.baseName === baseName);
  if (!descriptor) throw new Error(`Unknown strict dense vector binary family: ${baseName}`);
  const declaredPath = resolveBinaryArtifactPath(dir, descriptor.binName, { manifest, strict: true });
  const canonical = file => {
    let result = path.resolve(file);
    try { result = fs.realpathSync(result); } catch { /* The read reports missing/unreadable payloads. */ }
    return process.platform === 'win32' ? result.toLowerCase() : result;
  };
  if (!declaredPath || canonical(selectedPath) !== canonical(declaredPath)) {
    throw Object.assign(new Error(`Dense vector metadata path ${relPath} disagrees with the manifested binary for ${descriptor.binName}.`), {
      code: 'ERR_DENSE_VECTOR_PATH_MISMATCH'
    });
  }
  return declaredPath;
};

const fillDenseBinaryRow = (buffer, offset, rowWidth, vec, paddingValue) => {
  buffer.fill(paddingValue, offset, offset + rowWidth);
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
  dims,
  quantization = {}
}) => {
  const count = Array.isArray(vectors) ? vectors.length : 0;
  const rowWidth = toPositiveInteger(dims);
  if (!Array.isArray(vectors) || count > 0 && !rowWidth || rowWidth > 16 * 1024 * 1024
    || !Number.isSafeInteger(rowWidth * count)) throw Object.assign(new Error('Invalid dense vector binary dimensions/count.'), { code: 'ERR_DENSE_VECTOR_INVALID' });
  const spec = resolveEmbeddingQuantizationSpec(quantization);
  for (const row of vectors || []) {
    if (row !== null) assertQuantizedEmbeddingRow(row, { spec, dims: rowWidth });
  }
  const totalBytes = rowWidth > 0 ? rowWidth * count : 0;
  const tempBinPath = createTempPath(binPath);
  await fsPromises.mkdir(path.dirname(binPath), { recursive: true });
  try {
    const handle = await fsPromises.open(tempBinPath, 'w');
    const owner = createContainedFileResource({ handle, sync: false, additionalMethods: ['write', 'sync'] });
    await owner.run(async () => {
      const descriptor = owner.operations;
      if (rowWidth > 0 && count > 0) {
        const rowsPerChunk = Math.max(1, Math.floor(DENSE_BINARY_WRITE_CHUNK_BYTES / rowWidth));
        const chunk = Buffer.alloc(rowsPerChunk * rowWidth);
        let chunkRows = 0;
        const flushChunk = async () => {
          if (chunkRows <= 0) return;
          const bytesToWrite = chunkRows * rowWidth;
          let offset = 0;
          while (offset < bytesToWrite) {
            const remaining = bytesToWrite - offset;
            const { bytesWritten } = await descriptor.write(chunk, offset, remaining);
            if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > remaining) {
              throw Object.assign(new Error('Dense vector write did not make valid forward progress.'),
                { code: 'ERR_DENSE_VECTOR_SHORT_WRITE' });
            }
            offset += bytesWritten;
          }
          chunkRows = 0;
        };
        for (let docId = 0; docId < count; docId += 1) {
          const rowOffset = chunkRows * rowWidth;
          fillDenseBinaryRow(chunk, rowOffset, rowWidth, vectors[docId], spec.paddingValue);
          chunkRows += 1;
          if (chunkRows >= rowsPerChunk) {
            await flushChunk();
          }
        }
        await flushChunk();
      }
      await descriptor.sync();
    });
    await replaceFile(tempBinPath, binPath);
    return { count, rowWidth, totalBytes };
  } catch (error) {
    // A failed original close retains the temporary file and its exact owner.
    // Namespace cleanup cannot erase an unresolved native resource prerequisite.
    observeStorageResource(error, { phase: 'dense-vector-binary-write' }).requireSettled();
    try { await fsPromises.rm(tempBinPath, { force: true }); }
    catch (cleanupError) {
      throw Object.assign(new AggregateError([error, cleanupError],
        'Dense vector write and temporary cleanup failed.', { cause: error }), { code: error.code });
    }
    throw error;
  }
};

const hydrateDenseVectorFromBinaryBuffer = ({
  buffer,
  meta,
  baseName,
  modelId = null
}) => {
  const normalizedMeta = normalizeDenseVectorMeta(meta);
  if (!normalizedMeta) return null;
  if (Object.hasOwn(normalizedMeta, 'format') && normalizedMeta.format !== 'uint8-row-major') return null;
  const spec = resolveDenseQuantizationSpec(normalizedMeta);
  const relPath = typeof normalizedMeta.path === 'string' && normalizedMeta.path
    ? normalizedMeta.path
    : `${baseName}.bin`;
  const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const { dims, count, requiredBytes } = resolveDenseVectorCountFromBuffer(normalizedMeta, view.length);
  if (!dims || view.length !== requiredBytes) return null;
  const validity = decodeDenseVectorValidity({ ...normalizedMeta, count });
  for (let row = 0; row < count; row++) {
    if (validity && !(validity[row >> 3] & (1 << (row & 7)))) continue;
    assertQuantizedEmbeddingRow(view.subarray(row * dims, (row + 1) * dims), { spec, dims, allowEmpty: false });
  }
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
  modelId = null,
  manifest = null,
  strict = false
}) => {
  const normalizedMeta = normalizeDenseVectorMeta(meta);
  if (!dir || !baseName || !normalizedMeta) {
    if (strict) throw Object.assign(new Error('Invalid declared dense vector binary metadata.'), { code: 'ERR_DENSE_VECTOR_INVALID' });
    return null;
  }
  const absPath = resolveDenseVectorBinaryPayloadPath({ dir, baseName, meta: normalizedMeta, manifest, strict });
  if (!absPath) return null;
  try {
    const extent = (await fsPromises.stat(absPath)).size;
    const shape = resolveDenseVectorCountFromBuffer(normalizedMeta, extent);
    if (!shape.dims) throw Object.assign(new Error('Dense binary extent disagrees with declared dimensions/count.'), { code: 'ERR_DENSE_VECTOR_INVALID' });
    const { buffer } = await readVerifiedContainedFile(dir, absPath, { maxBytes: extent, expectedBytes: shape.requiredBytes });
    const loaded = hydrateDenseVectorFromBinaryBuffer({
      buffer,
      meta: normalizedMeta,
      baseName,
      modelId
    });
    if (!loaded && strict) {
      throw Object.assign(new Error(`Declared dense vector binary payload is truncated or invalid: ${absPath}`), { code: 'ERR_DENSE_VECTOR_INVALID' });
    }
    return loaded;
  } catch (error) {
    observeStorageResource(error, { phase: 'dense-vector-binary-read' }).requireSettled();
    if (strict) throw error;
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
  modelId = null,
  manifest = null,
  strict = false
}) => {
  const normalizedMeta = normalizeDenseVectorMeta(meta);
  if (!dir || !baseName || !normalizedMeta) {
    if (strict) throw Object.assign(new Error('Invalid declared dense vector binary metadata.'), { code: 'ERR_DENSE_VECTOR_INVALID' });
    return null;
  }
  const absPath = resolveDenseVectorBinaryPayloadPath({ dir, baseName, meta: normalizedMeta, manifest, strict });
  if (!absPath) return null;
  try {
    const extent = fs.statSync(absPath).size;
    const shape = resolveDenseVectorCountFromBuffer(normalizedMeta, extent);
    if (!shape.dims) throw Object.assign(new Error('Dense binary extent disagrees with declared dimensions/count.'), { code: 'ERR_DENSE_VECTOR_INVALID' });
    const { buffer } = readVerifiedContainedFileSync(dir, absPath, { maxBytes: extent, expectedBytes: shape.requiredBytes });
    const loaded = hydrateDenseVectorFromBinaryBuffer({
      buffer,
      meta: normalizedMeta,
      baseName,
      modelId
    });
    if (!loaded && strict) {
      throw Object.assign(new Error(`Declared dense vector binary payload is truncated or invalid: ${absPath}`), { code: 'ERR_DENSE_VECTOR_INVALID' });
    }
    return loaded;
  } catch (error) {
    observeStorageResource(error, { phase: 'dense-vector-binary-read-sync' }).requireSettled();
    if (strict) throw error;
    return null;
  }
};
