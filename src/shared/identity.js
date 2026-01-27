import { sha1 } from './hash.js';

/**
 * @typedef {{start:number,end:number}} Range
 *
 * @typedef {object} ChunkRef
 * @property {number|null} docId
 * @property {string|null} chunkUid
 * @property {string|null} chunkId
 * @property {string|null} file
 * @property {string|null} segmentUid
 * @property {string|null} segmentId
 * @property {Range|undefined} range
 *
 * @typedef {object} SymbolRef
 * @property {string} symbolKey
 * @property {string|null|undefined} symbolId
 * @property {string|null|undefined} scopedId
 * @property {string|null|undefined} signatureKey
 * @property {string|null|undefined} kind
 * @property {string|null|undefined} qualifiedName
 * @property {string|null|undefined} languageId
 * @property {ChunkRef|null|undefined} definingChunk
 * @property {{scheme:'scip'|'lsif'|'lsp'|'heuristic-v1'|'chunkUid',confidence:'high'|'medium'|'low',notes?:string}|null|undefined} evidence
 */

const SEMANTIC_ID_PREFIX = /^(scip:|lsif:|lsp:)/i;

/**
 * Build a ChunkRef from an in-memory chunk record.
 * @param {object} chunk
 * @returns {ChunkRef|null}
 */
export const buildChunkRef = (chunk) => {
  if (!chunk || typeof chunk !== 'object') return null;
  const meta = chunk.metaV2 || {};
  const segment = chunk.segment || meta.segment || null;
  return {
    docId: Number.isFinite(chunk.id) ? chunk.id : null,
    chunkUid: chunk.chunkUid || meta.chunkUid || null,
    chunkId: chunk.chunkId || meta.chunkId || null,
    file: chunk.file || meta.file || null,
    segmentUid: segment?.segmentUid || null,
    segmentId: segment?.segmentId || null,
    range: Number.isFinite(chunk.start) && Number.isFinite(chunk.end)
      ? { start: chunk.start, end: chunk.end }
      : undefined
  };
};

export const isSemanticSymbolId = (value) => {
  if (!value) return false;
  return SEMANTIC_ID_PREFIX.test(String(value));
};

/**
 * Resolve a stable join key for a symbol reference.
 * @param {SymbolRef|null|undefined} symbol
 * @param {{allowSymbolKey?:boolean}} options
 * @returns {{type:'symbolId'|'scopedId'|'symbolKey',key:string}|null}
 */
export const resolveSymbolJoinKey = (symbol, options = {}) => {
  if (!symbol) return null;
  if (symbol.symbolId && isSemanticSymbolId(symbol.symbolId)) {
    return { type: 'symbolId', key: symbol.symbolId };
  }
  if (symbol.scopedId) return { type: 'scopedId', key: symbol.scopedId };
  if (options.allowSymbolKey && symbol.symbolKey) {
    return { type: 'symbolKey', key: symbol.symbolKey };
  }
  return null;
};

/**
 * Resolve a stable join key for a chunk reference.
 * @param {ChunkRef|null|undefined} chunk
 * @returns {{type:'chunkUid'|'legacy',key:string}|null}
 */
export const resolveChunkJoinKey = (chunk) => {
  if (!chunk) return null;
  if (chunk.chunkUid) return { type: 'chunkUid', key: chunk.chunkUid };
  if (chunk.file && (chunk.segmentUid || chunk.segmentId) && chunk.chunkId) {
    const seg = chunk.segmentUid || chunk.segmentId || '';
    return { type: 'legacy', key: `${chunk.file}::${seg}::${chunk.chunkId}` };
  }
  return null;
};

export const buildSymbolKey = ({ virtualPath, name, chunkId }) => {
  if (!virtualPath) return null;
  const suffix = name || chunkId || '';
  if (!suffix) return null;
  return `ts:heur:v1:${virtualPath}:${suffix}`;
};

export const buildSignatureKey = (signature) => {
  if (!signature) return null;
  return `sig:v1:${sha1(String(signature))}`;
};

export const buildScopedSymbolId = (symbolKey, signatureKey) => {
  if (!symbolKey || !signatureKey) return null;
  return `sid:v1:${sha1(`${symbolKey}|${signatureKey}`)}`;
};
