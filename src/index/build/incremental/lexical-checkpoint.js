import { createHash } from 'node:crypto';
import { TOKEN_ID_META } from '../../../shared/token-id.js';
import { stableStringifyForSignature } from '../../../shared/stable-json.js';
import { MINHASH_HASH_IDENTITY } from '../../minhash.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../semantic/analysis-versions.js';

export const LEXICAL_CHECKPOINT_VERSION = 1;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROW_BYTES = 512 * 1024;
const MAX_ROWS = 8192;
const BASE_FIELDS = ['tokens', 'seq', 'tokenIds', 'minhashSig', 'minhashHashIdentity', 'stats'];
const CLASS_FIELDS = ['identifierTokens', 'keywordTokens', 'operatorTokens', 'literalTokens'];
const RUNTIME_FIELDS = ['treeSitterEnabled', 'treeSitterDisabledReason', 'maxChunkBytes', 'maxFileBytes',
  'maxChunksPerFile', 'maxBytesPerFile', 'remainingChunks', 'remainingBytes', 'fileBytes'];
const digest = value => createHash('sha256').update(value).digest('hex');
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const uint = value => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
const strings = values => Array.isArray(values) && values.length <= 131072
  && values.every(value => typeof value === 'string' && value.length <= 65536);
const runtimeState = runtime => runtime ? Object.fromEntries(RUNTIME_FIELDS.map(key => [key, runtime[key] ?? null])) : null;
const sameState = (left, right) => JSON.stringify(left) === JSON.stringify(right);
// Refuse before copying/encoding an unbounded graph. The conservative allowance includes JSON escaping.
const admittedJson = (value, maximum) => {
  const pending = [{ value, depth: 0 }]; const seen = new WeakSet(); let bytes = 0, nodes = 0;
  while (pending.length) {
    const item = pending.pop(); const value = item.value;
    if (++nodes > 300000 || item.depth > 12) return false;
    if (value === null || typeof value === 'boolean' || value === undefined) bytes += 6;
    else if (typeof value === 'number') { if (!Number.isFinite(value)) return false; bytes += 32; }
    else if (typeof value === 'string') bytes += 2 + Buffer.byteLength(value) * 6;
    else {
      if (!value || typeof value !== 'object' || seen.has(value)
        || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) return false;
      seen.add(value); bytes += 2;
      for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) return false;
        bytes += Buffer.byteLength(key) * 6 + 4; pending.push({ value: child, depth: item.depth + 1 });
      }
    }
    if (bytes > maximum) return false;
  }
  return bytes;
};
const validRuntime = value => value === null || (value && Object.keys(value).length === RUNTIME_FIELDS.length
  && typeof value.treeSitterEnabled === 'boolean'
  && (value.treeSitterDisabledReason === null || typeof value.treeSitterDisabledReason === 'string')
  && RUNTIME_FIELDS.slice(2).every(key => value[key] === null || (Number.isFinite(value[key]) && value[key] >= 0)));
const validPayload = (payload, classificationEnabled) => payload && strings(payload.tokens) && payload.tokens.length > 0
  && strings(payload.seq) && payload.seq.length > 0 && Array.isArray(payload.tokenIds)
  && payload.tokenIds.length === payload.tokens.length && payload.tokenIds.every(value => typeof value === 'string' && /^[0-9a-f]{16}$/.test(value))
  && payload.minhashHashIdentity === MINHASH_HASH_IDENTITY && Array.isArray(payload.minhashSig)
  && payload.minhashSig.length === 128 && payload.minhashSig.every(uint)
  && payload.stats && Number.isSafeInteger(payload.stats.unique) && payload.stats.unique >= 0
  && Number.isSafeInteger(payload.stats.sum) && payload.stats.sum === payload.tokens.length
  && Number.isFinite(payload.stats.entropy) && payload.stats.entropy >= 0
  && (!classificationEnabled || CLASS_FIELDS.every(key => strings(payload[key])));

/** A verified bundle supplies the outer integrity authority; each product additionally binds exact transformed text. */
export const createLexicalCheckpointSession = ({ cached = null, dependencies, fileHash, fileHashAlgo,
  policy, classificationEnabled = false, treeSitterEnabled = false, metrics = {} }) => {
  if (typeof dependencies?.lexical !== 'string' || !dependencies.lexical || dependencies.lexical.length > 256
    || typeof dependencies?.parse !== 'string' || !dependencies.parse || dependencies.parse.length > 256
    || !['sha1', 'sha256'].includes(fileHashAlgo) || typeof fileHash !== 'string'
    || !(fileHashAlgo === 'sha1' ? /^[0-9a-f]{40}$/ : /^[0-9a-f]{64}$/).test(fileHash) || !admittedJson(policy, 1024 * 1024)) return null;
  const policyKey = digest(stableStringifyForSignature({ dependencies: { parse: dependencies.parse, lexical: dependencies.lexical }, policy, classificationEnabled, treeSitterEnabled,
    producers: { lexicalAnalyzer: SEMANTIC_ANALYSIS_VERSIONS.lexicalAnalyzer,
      sourceChunking: SEMANTIC_ANALYSIS_VERSIONS.sourceChunking, vfsRouting: SEMANTIC_ANALYSIS_VERSIONS.vfsRouting }, tokenIds: TOKEN_ID_META, minhash: MINHASH_HASH_IDENTITY, node: process.versions.node,
    checkpointVersion: LEXICAL_CHECKPOINT_VERSION }));
  const previous = new Map();
  if (cached?.version === LEXICAL_CHECKPOINT_VERSION && cached.policyKey === policyKey
    && cached.fileHash === fileHash && cached.fileHashAlgo === fileHashAlgo && Array.isArray(cached.rows)
    && cached.rows.length <= MAX_ROWS && admittedJson(cached, MAX_BYTES)) {
    for (const row of cached.rows) {
      if (!Number.isSafeInteger(row?.index) || row.index < 0 || !hex(row.key) || previous.has(row.index)
        || !strings(row.phraseTokens) || row.phraseTokensCasePreserved !== true
        || typeof row.classificationReusable !== 'boolean' || !validRuntime(row.before) || !validRuntime(row.after)
        || !validPayload(row.payload, classificationEnabled) || !admittedJson(row, MAX_ROW_BYTES)) {
        previous.clear(); metrics.checkpointState = 'invalid'; break;
      }
      previous.set(row.index, row);
    }
  }
  const rows = []; let encodedBytes = 512, admittedBytes = 4096;
  return {
    key({ index, start, end, text, mode, ext, languageId, segmentUid }) {
      const hash = createHash('sha256').update(stableStringifyForSignature({ index, start, end, mode, ext, languageId, segmentUid })).update('\0');
      // JS tokenization observes UTF-16 code units, including unpaired surrogates.
      for (let offset = 0; offset < text.length; offset += 16384) hash.update(text.slice(offset, offset + 16384), 'utf16le');
      return hash.digest('hex');
    },
    before: runtimeState,
    has: (index, key) => previous.get(index)?.key === key,
    resolve(index, key, before, runtime) {
      const row = previous.get(index);
      if (!row || row.key !== key || !sameState(row.before, before)) {
        metrics.productMisses = (metrics.productMisses || 0) + 1; return null;
      }
      metrics.productHits = (metrics.productHits || 0) + 1;
      const classificationReusable = row.classificationReusable;
      if (classificationReusable) metrics.classificationHits = (metrics.classificationHits || 0) + 1;
      else metrics.classificationRecomputes = (metrics.classificationRecomputes || 0) + 1;
      if (classificationReusable && row.after && runtime) Object.assign(runtime, structuredClone(row.after));
      return { payload: structuredClone(row.payload), phraseTokens: row.phraseTokens.slice(), classificationReusable };
    },
    capture(index, key, payload, phraseTokens, before, runtime) {
      const after = runtimeState(runtime);
      const classificationReusable = !classificationEnabled || !treeSitterEnabled || before?.treeSitterEnabled === false
        || (Number.isFinite(before?.remainingChunks) && after?.remainingChunks < before.remainingChunks);
      const projection = Object.fromEntries([...BASE_FIELDS, ...CLASS_FIELDS].filter(field => payload[field] !== undefined)
        .map(field => [field, payload[field]]));
      const row = { index, key, payload: projection, phraseTokens, phraseTokensCasePreserved: true,
        classificationReusable, before, after };
      const allowance = admittedJson(row, MAX_ROW_BYTES);
      if (rows.length >= MAX_ROWS || !validPayload(projection, classificationEnabled)
        || !strings(phraseTokens) || !allowance || admittedBytes + allowance > MAX_BYTES) { metrics.captureDeclines = (metrics.captureDeclines || 0) + 1; return; }
      const bytes = Buffer.byteLength(JSON.stringify(row)) + 1;
      if (encodedBytes + bytes > MAX_BYTES) { metrics.captureDeclines = (metrics.captureDeclines || 0) + 1; return; }
      admittedBytes += allowance; encodedBytes += bytes; rows.push(structuredClone(row));
    },
    finish() {
      metrics.checkpointRows = rows.length; metrics.checkpointBytes = encodedBytes; metrics.admittedBytes = admittedBytes;
      return { version: LEXICAL_CHECKPOINT_VERSION, policyKey, fileHash, fileHashAlgo, rows };
    }
  };
};
