import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { createSemanticSourceSnapshot } from '../../index/semantic/source.js';
import { readSemanticSourceCapability } from '../../index/semantic/source-capability.js';
import { validateSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';

const owners = new WeakMap();
const key = canonicalSemanticJson;
const text = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096;
const fields = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype
  && !Object.getOwnPropertySymbols(value).length && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), 'value'));
const fail = message => { throw new TypeError('Sparse token view: ' + message); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const boundary = (source, offset) => offset === 0 || offset === source.length
  || !(source.charCodeAt(offset - 1) >= 0xd800 && source.charCodeAt(offset - 1) <= 0xdbff
    && source.charCodeAt(offset) >= 0xdc00 && source.charCodeAt(offset) <= 0xdfff);
const spanValid = (span, source) => Array.isArray(span) && span.length === 2
  && span.every(value => Number.isSafeInteger(value) && value >= 0 && value <= source.length && boundary(source, value))
  && span[0] <= span[1];
const completeCoverage = (ranges, length) => {
  let end = 0;
  for (const [start, finish] of ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (start > end) return false;
    end = Math.max(end, finish);
  }
  return end === length;
};

/** Hand-authored exact-natural tensors; preserves source tails and distinguishes missing encoded windows. */
export const createNaturalSparseTokenView = ({ profile, role, documents, maxBytes = 8 * 1024 * 1024 }) => {
  if (!fields(profile, ['generation', 'repositoryNamespace', 'contextKey', 'modelId', 'tokenizerId', 'lexicalSpaceId',
    'queryRole', 'documentRole', 'aggregation', 'numeric']) || !validateSemanticEnvelope('generation', profile.generation).ok
    || Object.entries(profile).some(([name, value]) => name !== 'generation' && !text(value))
    || profile.aggregation !== 'maxsim-all-window-tokens-v1' || profile.numeric !== 'exact-natural-v1'
    || !['query', 'document'].includes(role) || !Array.isArray(documents) || documents.length > 256 || !Number.isSafeInteger(maxBytes)
    || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) fail('unsupported bounded profile');
  let sourceBytes = 0, metadataBytes = 0, tokenCount = 0, coordinateCount = 0;
  const docs = [], ids = new Set();
  for (const document of documents) {
    if (!fields(document, ['id', 'snapshot', 'windows']) || !text(document.id) || ids.has(document.id)
      || !Array.isArray(document.windows) || document.windows.length > 1024) fail('invalid document inventory');
    ids.add(document.id);
    const owned = readSemanticSourceCapability(document.snapshot?.sourceCapability), manifest = document.snapshot?.manifest;
    if (!owned || !manifest || manifest.repositoryNamespace !== profile.repositoryNamespace) fail('owned source required');
    sourceBytes += owned.byteLength;
    if (sourceBytes > maxBytes) throw new RangeError('Sparse source allowance exceeded.');
    const verified = createSemanticSourceSnapshot({ bytes: Buffer.from(owned.text), repositoryNamespace: manifest.repositoryNamespace,
      path: manifest.path, language: manifest.language, dialect: manifest.dialect, mapping: manifest.mapping });
    if (key(verified.manifest) !== key(manifest)) fail('source manifest does not match its owned bytes');
    const tokens = [], windows = [], windowIds = new Set(), tokenIds = new Set(), ranges = [];
    for (const window of document.windows) {
      if (!fields(window, ['id', 'span', 'status', 'tokens']) || !text(window.id) || windowIds.has(window.id)
        || !spanValid(window.span, owned.text) || !['encoded', 'missing'].includes(window.status)
        || !Array.isArray(window.tokens) || window.tokens.length > 16384
        || window.status === 'missing' && window.tokens.length) fail('invalid window coverage');
      windowIds.add(window.id);
      metadataBytes += Buffer.byteLength(key({ id: window.id, span: window.span, status: window.status }));
      if (metadataBytes > maxBytes) throw new RangeError('Sparse window allowance exceeded.');
      if (window.status === 'encoded') ranges.push([...window.span]);
      const admittedTokens = [];
      for (const token of window.tokens) {
        if (!fields(token, ['id', 'span', 'weights']) || !text(token.id) || tokenIds.has(token.id)
          || token.span !== null && (!spanValid(token.span, owned.text)
            || token.span[0] < window.span[0] || token.span[1] > window.span[1])
          || !Array.isArray(token.weights) || token.weights.length > 128 || ++tokenCount > 16384) fail('invalid token mapping');
        tokenIds.add(token.id);
        const coordinates = new Set();
        for (const pair of token.weights) {
          if (!Array.isArray(pair) || pair.length !== 2 || !text(pair[0]) || coordinates.has(pair[0])
            || typeof pair[1] !== 'string' || !/^[1-9][0-9]{0,31}$/.test(pair[1]) || ++coordinateCount > 65536) fail('invalid nonnegative integer coordinates');
          coordinates.add(pair[0]);
        }
        metadataBytes += Buffer.byteLength(key(token));
        if (metadataBytes > maxBytes) throw new RangeError('Sparse tensor allowance exceeded.');
        const admitted = { ...token, windowId: window.id };
        admittedTokens.push(admitted); tokens.push(admitted);
      }
      windows.push({ id: window.id, span: window.span, status: window.status, tokens: admittedTokens });
    }
    const pooled = new Map();
    for (const token of tokens) for (const [coordinate, amount] of token.weights) {
      const value = BigInt(amount), prior = pooled.get(coordinate);
      if (!prior || value > prior.value) pooled.set(coordinate, { value, tokenId: token.id });
    }
    docs.push({ id: document.id, manifest: verified.manifest, windows, tokens, source: owned.text,
      encodedCoverageComplete: completeCoverage(ranges, owned.text.length), pooled });
  }
  const identity = { profile, role, documents: docs.map(doc => ({ id: doc.id, manifest: doc.manifest, windows: doc.windows })) };
  if (Buffer.byteLength(key(identity)) > maxBytes) throw new RangeError('Sparse manifest allowance exceeded.');
  const immutable = freeze(JSON.parse(key(identity)));
  const handle = Object.freeze({ rootId: semanticHash('pairofcleats.natural-sparse-token-view.v1', immutable),
    profile: immutable.profile, role, documentCount: docs.length, tokenCount, sourceBytes,
    encodedCoverageComplete: docs.every(doc => doc.encodedCoverageComplete), numeric: 'exact-natural-v1' });
  // Copy token/window metadata separately from input objects; only immutable strings and private maps remain.
  for (let index = 0; index < docs.length; index++) {
    docs[index].manifest = immutable.documents[index].manifest;
    docs[index].windows = immutable.documents[index].windows;
    docs[index].tokens = docs[index].windows.flatMap(window => window.tokens);
  }
  owners.set(handle, docs);
  return handle;
};

/** Exact integer bounds avoid silently borrowing float rounding laws from a different score target. */
export const openNaturalSparseTokenView = ({ view, queryView, release = () => {} }) => {
  const docs = owners.get(view), queryDocs = owners.get(queryView);
  if (!docs || !queryDocs || view.role !== 'document' || queryView.role !== 'query'
    || queryDocs.length !== 1 || key(view.profile) !== key(queryView.profile)
    || !queryView.encodedCoverageComplete || typeof release !== 'function') fail('compatible complete query representation required');
  const query = queryDocs[0].tokens;
  if (query.length > 64) fail('query token allowance exceeded');
  const states = new Map();
  for (const doc of docs) {
    let upper = 0n, lower = 0n;
    for (const token of query) {
      let bestCoordinate = 0n;
      for (const [coordinate, amount] of token.weights) {
        const contribution = BigInt(amount) * (doc.pooled.get(coordinate)?.value || 0n);
        upper += contribution; if (contribution > bestCoordinate) bestCoordinate = contribution;
      }
      lower += bestCoordinate;
    }
    states.set(doc.id, { doc, offset: 0, queryOffset: 0, maxima: query.map(() => 0n),
      lower, upper, complete: query.length === 0 || doc.tokens.length === 0 });
  }
  let closed = false;
  const get = id => { if (closed || !states.has(id)) fail('closed view or unknown document'); return states.get(id); };
  const describe = state => ({ id: state.doc.id,
    interval: state.doc.encodedCoverageComplete ? { lower: state.lower.toString(), upper: state.upper.toString() } : null,
    scoreStatus: !state.doc.encodedCoverageComplete ? 'missing-encoded-coverage' : state.complete ? 'exact-natural' : 'bounded-natural',
    tokenRowsVisited: state.offset, totalTokenRows: state.doc.tokens.length,
    encodedCoverageComplete: state.doc.encodedCoverageComplete, retainedSourceComplete: true });
  return Object.freeze({ viewRoot: view.rootId, queryRoot: queryView.rootId,
    enumerate() { if (closed) fail('closed view'); return [...states.values()].map(describe); },
    refine(id, { maxWork = 1024, signal = null } = {}) {
      const state = get(id);
      if (!Number.isSafeInteger(maxWork) || maxWork < 0 || maxWork > 65536) fail('invalid token-pair work allowance');
      let work = 0;
      while (!state.complete && work < maxWork && !signal?.aborted) {
        const token = state.doc.tokens[state.offset], values = new Map(token.weights.map(([coordinate, value]) => [coordinate, BigInt(value)]));
        let score = 0n;
        for (const [coordinate, amount] of query[state.queryOffset].weights) score += BigInt(amount) * (values.get(coordinate) || 0n);
        if (score > state.maxima[state.queryOffset]) state.maxima[state.queryOffset] = score;
        work++; state.queryOffset++;
        if (state.queryOffset === query.length) { state.queryOffset = 0; state.offset++; }
        state.complete = state.offset === state.doc.tokens.length;
      }
      const sampled = state.maxima.reduce((sum, value) => sum + value, 0n);
      if (sampled > state.lower) state.lower = sampled;
      if (state.complete) state.lower = state.upper = sampled;
      return { ...describe(state), work, reason: signal?.aborted ? 'cancelled' : state.complete ? null : 'work-budget' };
    },
    expand(id, tokenId) {
      const state = get(id), token = state.doc.tokens.find(row => row.id === tokenId);
      if (!token) fail('token outside retained view');
      return { sourceUnitId: state.doc.manifest.sourceUnitId, tokenId, windowId: token.windowId,
        span: token.span, text: token.span === null ? null : state.doc.source.slice(...token.span),
        mapping: token.span === null ? 'synthetic-no-source' : 'declared-source-span', semanticAuthority: 'not-implied' };
    },
    close() { if (!closed) { closed = true; states.clear(); release(); } }
  });
};

/** Full-domain consumer; zero/unmatched documents remain in the explicit deterministic target. */
export const rankNaturalSparseTokenView = ({ view, queryView, signal = null }) => {
  const reader = openNaturalSparseTokenView({ view, queryView });
  try {
    const rows = reader.enumerate();
    if (rows.some(row => !row.encodedCoverageComplete)) return { status: 'unavailable', reason: 'missing-encoded-coverage', hits: [] };
    const hits = [];
    for (const row of rows) {
      let refined = row;
      while (refined.scoreStatus !== 'exact-natural' && !signal?.aborted) refined = reader.refine(row.id, { maxWork: 65536, signal });
      if (signal?.aborted) return { status: 'cancelled', hits: [], complete: false };
      hits.push({ id: row.id, score: refined.interval.lower });
    }
    hits.sort((a, b) => BigInt(a.score) > BigInt(b.score) ? -1 : BigInt(a.score) < BigInt(b.score) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return { status: 'complete-exact-natural', viewRoot: view.rootId, queryRoot: queryView.rootId, hits,
      semanticClosure: 'not-implied', rankingUnit: 'all-window-tokens-per-document', numeric: 'exact-natural-v1' };
  } finally { reader.close(); }
};
