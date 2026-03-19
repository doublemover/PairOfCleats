import { readJsonFile } from '../../../shared/artifact-io.js';
import { sha1 } from '../../../shared/hash.js';
import { stableStringifyForSignature } from '../../../shared/stable-json.js';
import { atomicWriteText } from '../../../shared/io/atomic-write.js';
import { stripIndexStateNondeterministicFields } from './reporting.js';

export const readStableIndexStateHash = async (indexStatePath, { maxBytes }) => {
  try {
    const parsed = readJsonFile(indexStatePath, { maxBytes });
    const fields = parsed?.fields && typeof parsed.fields === 'object' ? parsed.fields : parsed;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
    const stableState = stripIndexStateNondeterministicFields(fields, { forStableHash: true });
    return sha1(stableStringifyForSignature(stableState));
  } catch {
    return null;
  }
};

/**
 * Aggregate per-chunk boilerplate metadata into a compact reference catalog.
 *
 * @param {Array<object>} chunks
 * @returns {Array<{ref:string,count:number,positions:Record<string,number>,tags:Array<string>,sampleFiles:Array<string>}>}
 */
export const buildBoilerplateCatalog = (chunks) => {
  if (!Array.isArray(chunks) || !chunks.length) return [];
  const byRef = new Map();
  for (const chunk of chunks) {
    const docmeta = chunk?.docmeta;
    const ref = typeof docmeta?.boilerplateRef === 'string' ? docmeta.boilerplateRef : null;
    if (!ref) continue;
    const row = byRef.get(ref) || {
      ref,
      count: 0,
      positions: {},
      tags: new Set(),
      sampleFiles: []
    };
    row.count += 1;
    const position = typeof docmeta?.boilerplatePosition === 'string'
      ? docmeta.boilerplatePosition
      : 'unknown';
    row.positions[position] = (row.positions[position] || 0) + 1;
    const tags = Array.isArray(docmeta?.boilerplateTags) ? docmeta.boilerplateTags : [];
    for (const tag of tags) {
      if (typeof tag === 'string' && tag.trim()) row.tags.add(tag.trim());
    }
    const file = typeof chunk?.file === 'string' ? chunk.file : null;
    if (file && row.sampleFiles.length < 8 && !row.sampleFiles.includes(file)) {
      row.sampleFiles.push(file);
    }
    byRef.set(ref, row);
  }
  return Array.from(byRef.values())
    .map((row) => ({
      ref: row.ref,
      count: row.count,
      positions: row.positions,
      tags: Array.from(row.tags).sort(),
      sampleFiles: row.sampleFiles
    }))
    .sort((a, b) => b.count - a.count || a.ref.localeCompare(b.ref));
};

/**
 * Atomically publish a binary artifact payload (temp file + fsync + rename).
 *
 * Reuses the shared atomic-write primitive so binary outputs are crash-safe and
 * never observed partially written.
 *
 * @param {string} filePath
 * @param {Buffer|Uint8Array|ArrayBuffer} payload
 * @returns {Promise<void>}
 */
export const writeBinaryArtifactAtomically = async (filePath, payload) => {
  let bytes = null;
  if (Buffer.isBuffer(payload)) {
    bytes = payload;
  } else if (payload instanceof Uint8Array) {
    bytes = Buffer.from(payload);
  } else if (payload instanceof ArrayBuffer) {
    bytes = Buffer.from(payload);
  } else if (ArrayBuffer.isView(payload)) {
    bytes = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  } else {
    bytes = Buffer.from([]);
  }
  await atomicWriteText(filePath, bytes, { newline: false });
};
