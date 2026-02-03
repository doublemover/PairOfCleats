import { zstdCompress, zstdDecompress } from 'node:zlib';
import { promisify } from 'node:util';

const zstdCompressAsync = promisify(zstdCompress);
const zstdDecompressAsync = promisify(zstdDecompress);

const CACHE_MAGIC = Buffer.from('PCEB', 'ascii');
const CACHE_VERSION = 1;
const CACHE_ENTRY_SUFFIX = '.embcache.zst';
const HEADER_BYTES = 12;

const isVectorLike = (value) => (
  Array.isArray(value)
  || (ArrayBuffer.isView(value) && !(value instanceof DataView))
);

const toUint8 = (vec) => {
  if (!isVectorLike(vec) || !vec.length) return new Uint8Array(0);
  if (vec instanceof Uint8Array) return vec;
  if (ArrayBuffer.isView(vec)) {
    return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
  }
  return Uint8Array.from(vec);
};

const normalizeVectors = (vectors, count) => {
  if (!Array.isArray(vectors)) {
    return Array.from({ length: count }, () => new Uint8Array(0));
  }
  const out = new Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = toUint8(vectors[i]);
  }
  return out;
};

const resolveLengthEncoding = (vectors) => {
  let maxLen = 0;
  for (const vec of vectors) {
    if (vec.length > maxLen) maxLen = vec.length;
  }
  return maxLen > 0xffff ? 'u32' : 'u16';
};

const writeLengths = (lengths, encoding) => {
  const bytesPer = encoding === 'u32' ? 4 : 2;
  const buffer = Buffer.allocUnsafe(lengths.length * bytesPer);
  for (let i = 0; i < lengths.length; i += 1) {
    const len = lengths[i] || 0;
    if (encoding === 'u32') {
      buffer.writeUInt32LE(len, i * bytesPer);
    } else {
      buffer.writeUInt16LE(len, i * bytesPer);
    }
  }
  return buffer;
};

const readLengths = (buffer, offset, count, encoding) => {
  const bytesPer = encoding === 'u32' ? 4 : 2;
  const lengths = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const pos = offset + i * bytesPer;
    lengths[i] = encoding === 'u32'
      ? buffer.readUInt32LE(pos)
      : buffer.readUInt16LE(pos);
  }
  return { lengths, bytes: count * bytesPer };
};

const encodeVectorSection = (vectors, encoding) => {
  const lengths = vectors.map((vec) => vec.length || 0);
  const lengthsBuffer = writeLengths(lengths, encoding);
  const totalBytes = lengths.reduce((sum, len) => sum + len, 0);
  const dataBuffer = Buffer.allocUnsafe(totalBytes);
  let offset = 0;
  for (const vec of vectors) {
    if (!vec.length) continue;
    dataBuffer.set(vec, offset);
    offset += vec.length;
  }
  return { lengthsBuffer, dataBuffer };
};

const decodeVectorSection = (buffer, offset, count, encoding) => {
  const { lengths, bytes } = readLengths(buffer, offset, count, encoding);
  const dataOffset = offset + bytes;
  const totalBytes = lengths.reduce((sum, len) => sum + len, 0);
  const data = buffer.subarray(dataOffset, dataOffset + totalBytes);
  const vectors = new Array(count);
  let cursor = 0;
  for (let i = 0; i < count; i += 1) {
    const len = lengths[i];
    if (!len) {
      vectors[i] = new Uint8Array(0);
      continue;
    }
    vectors[i] = data.subarray(cursor, cursor + len);
    cursor += len;
  }
  return { vectors, bytes: bytes + totalBytes };
};

/**
 * Resolve the cache entry file suffix.
 * @returns {string}
 */
export function getEmbeddingsCacheSuffix() {
  return CACHE_ENTRY_SUFFIX;
}

/**
 * Encode embeddings cache payload into a compressed binary buffer.
 * @param {{key?:string,file?:string,hash?:string,chunkSignature?:string,cacheMeta?:object,codeVectors?:Array<any>,docVectors?:Array<any>,mergedVectors?:Array<any>}} payload
 * @param {{level?:number}} [options]
 * @returns {Promise<Buffer>}
 */
export async function encodeEmbeddingsCache(payload, options = {}) {
  const codeVectors = Array.isArray(payload?.codeVectors) ? payload.codeVectors : [];
  const docVectors = Array.isArray(payload?.docVectors) ? payload.docVectors : [];
  const mergedVectors = Array.isArray(payload?.mergedVectors) ? payload.mergedVectors : [];
  const count = Math.max(codeVectors.length, docVectors.length, mergedVectors.length);
  const code = normalizeVectors(codeVectors, count);
  const doc = normalizeVectors(docVectors, count);
  const merged = normalizeVectors(mergedVectors, count);
  const codeEncoding = resolveLengthEncoding(code);
  const docEncoding = resolveLengthEncoding(doc);
  const mergedEncoding = resolveLengthEncoding(merged);

  const header = {
    version: CACHE_VERSION,
    key: payload?.key || null,
    file: payload?.file || null,
    hash: payload?.hash || null,
    chunkSignature: payload?.chunkSignature || null,
    cacheMeta: payload?.cacheMeta || null,
    vectors: {
      count,
      encoding: 'uint8',
      order: ['code', 'doc', 'merged'],
      lengths: {
        code: codeEncoding,
        doc: docEncoding,
        merged: mergedEncoding
      }
    }
  };
  const headerJson = JSON.stringify(header);
  const headerBuffer = Buffer.from(headerJson, 'utf8');

  const codeSection = encodeVectorSection(code, codeEncoding);
  const docSection = encodeVectorSection(doc, docEncoding);
  const mergedSection = encodeVectorSection(merged, mergedEncoding);

  const totalSize = HEADER_BYTES
    + headerBuffer.length
    + codeSection.lengthsBuffer.length
    + codeSection.dataBuffer.length
    + docSection.lengthsBuffer.length
    + docSection.dataBuffer.length
    + mergedSection.lengthsBuffer.length
    + mergedSection.dataBuffer.length;

  const buffer = Buffer.allocUnsafe(totalSize);
  CACHE_MAGIC.copy(buffer, 0);
  buffer.writeUInt32LE(CACHE_VERSION, 4);
  buffer.writeUInt32LE(headerBuffer.length, 8);
  let offset = HEADER_BYTES;
  headerBuffer.copy(buffer, offset);
  offset += headerBuffer.length;

  codeSection.lengthsBuffer.copy(buffer, offset);
  offset += codeSection.lengthsBuffer.length;
  codeSection.dataBuffer.copy(buffer, offset);
  offset += codeSection.dataBuffer.length;

  docSection.lengthsBuffer.copy(buffer, offset);
  offset += docSection.lengthsBuffer.length;
  docSection.dataBuffer.copy(buffer, offset);
  offset += docSection.dataBuffer.length;

  mergedSection.lengthsBuffer.copy(buffer, offset);
  offset += mergedSection.lengthsBuffer.length;
  mergedSection.dataBuffer.copy(buffer, offset);

  const level = Number.isFinite(Number(options.level)) ? Math.floor(Number(options.level)) : undefined;
  return zstdCompressAsync(buffer, level ? { level } : undefined);
}

/**
 * Decode a compressed embeddings cache buffer into the original payload.
 * @param {Buffer} buffer
 * @returns {Promise<{key?:string,file?:string,hash?:string,chunkSignature?:string,cacheMeta?:object,codeVectors:any[],docVectors:any[],mergedVectors:any[]}>}
 */
export async function decodeEmbeddingsCache(buffer) {
  if (!buffer || !buffer.length) {
    throw new Error('[embeddings] Cache buffer is empty.');
  }
  const raw = await zstdDecompressAsync(buffer);
  if (raw.length < HEADER_BYTES) {
    throw new Error('[embeddings] Cache buffer too small.');
  }
  const magic = raw.subarray(0, 4);
  if (!magic.equals(CACHE_MAGIC)) {
    throw new Error('[embeddings] Cache header mismatch.');
  }
  const version = raw.readUInt32LE(4);
  if (version !== CACHE_VERSION) {
    throw new Error(`[embeddings] Unsupported cache version ${version}.`);
  }
  const headerLen = raw.readUInt32LE(8);
  const headerStart = HEADER_BYTES;
  const headerEnd = headerStart + headerLen;
  if (raw.length < headerEnd) {
    throw new Error('[embeddings] Cache header truncated.');
  }
  const header = JSON.parse(raw.subarray(headerStart, headerEnd).toString('utf8'));
  const vectors = header?.vectors || {};
  const count = Number.isFinite(Number(vectors.count)) ? Math.max(0, Number(vectors.count)) : 0;
  const lengths = vectors.lengths || {};
  const codeEncoding = lengths.code === 'u32' ? 'u32' : 'u16';
  const docEncoding = lengths.doc === 'u32' ? 'u32' : 'u16';
  const mergedEncoding = lengths.merged === 'u32' ? 'u32' : 'u16';

  let offset = headerEnd;
  const codeSection = decodeVectorSection(raw, offset, count, codeEncoding);
  offset += codeSection.bytes;
  const docSection = decodeVectorSection(raw, offset, count, docEncoding);
  offset += docSection.bytes;
  const mergedSection = decodeVectorSection(raw, offset, count, mergedEncoding);

  return {
    key: header?.key || null,
    file: header?.file || null,
    hash: header?.hash || null,
    chunkSignature: header?.chunkSignature || null,
    cacheMeta: header?.cacheMeta || null,
    codeVectors: codeSection.vectors,
    docVectors: docSection.vectors,
    mergedVectors: mergedSection.vectors
  };
}
