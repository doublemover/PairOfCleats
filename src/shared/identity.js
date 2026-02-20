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

const SEMANTIC_ID_PREFIX = /^(sym1:|scip:|lsif:|lsp:|ctags:)/i;
const CHUNK_UID_PATTERN = /^ck64:v1:.+:[a-f0-9]{16}(?::[a-f0-9]{16}){0,2}(?::ord[1-9][0-9]*)?$/;
const GENERATED_SYMBOL_ID_PATTERN = /^sym1:[a-z0-9._-]+:[a-f0-9]{40}$/;

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

export const isCanonicalChunkUid = (value) => (
  typeof value === 'string' && CHUNK_UID_PATTERN.test(value)
);

export const isCanonicalGeneratedSymbolId = (value) => (
  typeof value === 'string' && GENERATED_SYMBOL_ID_PATTERN.test(value)
);

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

export const buildSymbolKey = ({ virtualPath, qualifiedName, kindGroup, name, chunkId }) => {
  if (!virtualPath) return null;
  const safeName = qualifiedName || name || chunkId || '';
  if (!safeName) return null;
  const group = kindGroup || 'other';
  return `${virtualPath}::${safeName}::${group}`;
};

const normalizeSignature = (signature) => {
  if (!signature) return null;
  return String(signature).replace(/\s+/g, ' ').trim();
};

export const buildSignatureKey = ({ qualifiedName, signature }) => {
  const normalized = normalizeSignature(signature);
  if (!qualifiedName || !normalized) return null;
  return `${qualifiedName}::${normalized}`;
};

export const buildScopedSymbolId = ({ kindGroup, symbolKey, signatureKey, chunkUid }) => {
  if (!kindGroup || !symbolKey || !chunkUid) return null;
  const sig = signatureKey || '';
  return `${kindGroup}|${symbolKey}|${sig}|${chunkUid}`;
};

export const buildSymbolId = ({ scopedId, scheme = 'heur' }) => {
  if (!scopedId) return null;
  const prefix = `sym1:${scheme}:`;
  const symbolId = `${prefix}${sha1(String(scopedId))}`;
  return isCanonicalGeneratedSymbolId(symbolId) ? symbolId : null;
};
