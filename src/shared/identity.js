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
  const identity = buildChunkIdentityEnvelopeFromArtifactRow(chunk);
  if (!identity) return null;
  return {
    docId: identity.docId,
    chunkUid: identity.chunkUid,
    chunkId: identity.chunkId,
    file: identity.file,
    segmentUid: identity.segmentUid,
    segmentId: identity.segmentId,
    range: identity.range
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

const normalizeIdentityText = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const normalizeFiniteNumber = (value) => (
  Number.isFinite(value) ? Number(value) : null
);

const buildRangeEnvelope = ({ start, end } = {}) => {
  const safeStart = normalizeFiniteNumber(start);
  const safeEnd = normalizeFiniteNumber(end);
  if (!Number.isFinite(safeStart) || !Number.isFinite(safeEnd)) return undefined;
  return { start: safeStart, end: safeEnd };
};

export const buildSegmentIdentityEnvelope = (input = {}) => {
  if (!input || typeof input !== 'object') return null;
  const segmentUid = normalizeIdentityText(input.segmentUid);
  const segmentId = normalizeIdentityText(input.segmentId);
  const virtualPath = normalizeIdentityText(input.virtualPath);
  const file = normalizeIdentityText(input.file);
  const languageId = normalizeIdentityText(input.languageId);
  const range = buildRangeEnvelope({
    start: input.start ?? input.segmentStart,
    end: input.end ?? input.segmentEnd
  });
  if (!segmentUid && !segmentId && !virtualPath && !file && !languageId && !range) {
    return null;
  }
  return {
    segmentUid,
    segmentId,
    virtualPath,
    file,
    languageId,
    range
  };
};

export const buildChunkIdentityEnvelope = (input = {}) => {
  if (!input || typeof input !== 'object') return null;
  const segmentEnvelope = buildSegmentIdentityEnvelope(input.segment || input);
  const docId = normalizeFiniteNumber(input.docId ?? input.id);
  const chunkUid = normalizeIdentityText(input.chunkUid);
  const chunkId = normalizeIdentityText(input.chunkId);
  const file = normalizeIdentityText(input.file);
  const virtualPath = normalizeIdentityText(
    input.virtualPath ?? segmentEnvelope?.virtualPath
  );
  const languageId = normalizeIdentityText(
    input.languageId ?? input.lang ?? segmentEnvelope?.languageId
  );
  const range = buildRangeEnvelope({ start: input.start, end: input.end });
  if (
    docId === null
    && !chunkUid
    && !chunkId
    && !file
    && !virtualPath
    && !languageId
    && !range
    && !segmentEnvelope
  ) {
    return null;
  }
  return {
    docId,
    chunkUid,
    chunkId,
    file,
    virtualPath,
    languageId,
    segmentUid: segmentEnvelope?.segmentUid || null,
    segmentId: segmentEnvelope?.segmentId || null,
    range
  };
};

export const buildChunkIdentityEnvelopeFromArtifactRow = (row) => {
  if (!row || typeof row !== 'object') return null;
  const meta = row.metaV2 && typeof row.metaV2 === 'object' ? row.metaV2 : {};
  const segment = row.segment && typeof row.segment === 'object'
    ? row.segment
    : (meta.segment && typeof meta.segment === 'object' ? meta.segment : null);
  return buildChunkIdentityEnvelope({
    docId: row.id ?? row.docId,
    chunkUid: row.chunkUid ?? meta.chunkUid,
    chunkId: row.chunkId ?? meta.chunkId,
    file: row.file ?? meta.file,
    virtualPath: row.virtualPath ?? meta.virtualPath ?? segment?.virtualPath,
    languageId: row.lang ?? meta.lang ?? segment?.languageId,
    start: row.start,
    end: row.end,
    segment
  });
};

export const assertSegmentIdentityEnvelope = (
  envelope,
  {
    label = 'segment',
    requireSegmentUid = false,
    requireVirtualPath = false
  } = {}
) => {
  const identity = buildSegmentIdentityEnvelope(envelope);
  if (!identity) {
    throw new Error(`${label} missing identity envelope`);
  }
  if (requireSegmentUid && !identity.segmentUid) {
    throw new Error(`${label} missing segmentUid`);
  }
  if (requireVirtualPath && !identity.virtualPath) {
    throw new Error(`${label} missing virtualPath`);
  }
  return identity;
};

export const assertChunkIdentityEnvelope = (
  envelope,
  {
    label = 'chunk',
    requireChunkUid = false,
    requireVirtualPath = false,
    requireSegmentUid = false,
    requireFile = false
  } = {}
) => {
  const identity = buildChunkIdentityEnvelope(envelope);
  if (!identity) {
    throw new Error(`${label} missing identity envelope`);
  }
  if (requireChunkUid && !identity.chunkUid) {
    throw new Error(`${label} missing chunkUid`);
  }
  if (identity.chunkUid && !isCanonicalChunkUid(identity.chunkUid)) {
    throw new Error(`${label} invalid canonical chunkUid (${identity.chunkUid})`);
  }
  if (requireVirtualPath && !identity.virtualPath) {
    throw new Error(`${label} missing virtualPath`);
  }
  if (requireSegmentUid && !identity.segmentUid) {
    throw new Error(`${label} missing segmentUid`);
  }
  if (requireFile && !identity.file) {
    throw new Error(`${label} missing file`);
  }
  return identity;
};
