import { createHash } from 'node:crypto';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { stableStringify } from '../../shared/stable-json.js';
import { canonicalBundleSourceKey } from '../../shared/bundle-source-key.js';
import { MinHeap } from '../../shared/min-heap.js';
import { validateVectorEvaluationRecord } from '../../contracts/validators/vector-evaluation.js';
import { VECTOR_EVALUATION_VERSION } from '../../contracts/schemas/vector-evaluation.js';

const MAX_INPUT_BYTES = 16 * 1024 * 1024, MAX_OUTPUT_BYTES = 1024 * 1024;
const LIMITS = Object.freeze({ rows: 32768, coordinates: 2 * 1024 * 1024, work: 16 * 1024 * 1024,
  outputBytes: MAX_OUTPUT_BYTES, milliseconds: 1000, batchRows: 128, topK: 1024 });
const fail = message => Object.assign(new Error(message), { code: 'ERR_VECTOR_EVALUATION_RECORD' });
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const compare = (left, right) => right.score - left.score || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);

/** No ordinal, embedding model or generation participates in source joins. */
export const vectorEvaluationSourceKey = source => digest(['file-span-v1', source.repoId, source.mode,
  source.file, source.start, source.end, source.offsetUnit, source.contentDigest]);
export const vectorEvaluationCorpusDigest = rows => digest(rows.map(row => vectorEvaluationSourceKey(row.source)).sort());
export const vectorEvaluationEmbeddingKey = embedding => digest(embedding);
export const vectorEvaluationQueryKey = ({ query, eligibility }) => digest({ query, eligibilityPolicyDigest: eligibility.policyDigest });
export const vectorEvaluationOriginalDigest = rows => digest(rows.map(row => [row.key, row.original]).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));

const assertFloat32 = (values, dims) => {
  if (!Array.isArray(values) || values.length !== dims || values.some(value => !Number.isFinite(value) || Math.fround(value) !== value)) throw fail('Original/query vectors require exact admitted FP32 values and dimensions.');
};
/** Strict request-owned snapshot. Bounded JSON input/coordinates cover snapshot
 * overhead; callers never lend mutable shared cache buffers across an await. */
export const admitVectorEvaluationRecord = input => {
  if (!Array.isArray(input?.rows) || input.rows.length > LIMITS.rows) throw fail('Vector evaluation source-row allowance exceeded.');
  let cells = input.query?.vector?.length || 0, sourceTextBytes = 0;
  for (const row of input.rows) {
    cells += (row?.original?.length || 0) + (row?.stored?.length || 0);
    sourceTextBytes += 256 + 3 * ((row?.source?.file?.length || 0) + (row?.source?.repoId?.length || 0));
    if (cells > LIMITS.coordinates || sourceTextBytes > MAX_INPUT_BYTES) throw fail('Vector evaluation coordinates/source metadata exceed bounded admission.');
  }
  const validation = validateVectorEvaluationRecord(input);
  if (!validation.ok) throw fail(`Invalid vector evaluation record: ${validation.errors.slice(0, 4).join('; ')}`);
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized) > MAX_INPUT_BYTES) throw fail('Vector evaluation input exceeds its16MiB allowance.');
  const record = JSON.parse(serialized), { embedding } = record;
  if (!(embedding.storage.maxVal > embedding.storage.minVal)
    || !Number.isFinite(embedding.storage.maxVal - embedding.storage.minVal)
    || !Number.isFinite(Math.fround(embedding.storage.minVal)) || !Number.isFinite(Math.fround(embedding.storage.maxVal))) throw fail('Stored quantization range must be increasing and representable.');
  assertFloat32(record.query.vector, embedding.dimensions);
  let coordinates = record.query.vector.length, originalCount = 0, present = 0;
  const keys = new Set();
  for (const row of record.rows) {
    const source = row.source;
    let canonical;
    try { canonical = canonicalBundleSourceKey(source.file); }
    catch (cause) { throw Object.assign(fail('Source identity requires a canonical repository-relative file.'), { cause }); }
    if (source.end < source.start || canonical !== source.file
      || source.file.includes('\\') || source.file.startsWith('/') || /^[A-Za-z]:/.test(source.file)) throw fail('Source spans require ordered, canonical relative file identity.');
    if (row.key !== vectorEvaluationSourceKey(source) || keys.has(row.key)) throw fail('Duplicate or mismatching source identity; ordinal joins are not admitted.');
    keys.add(row.key);
    if (!row.presence[embedding.channel]) {
      if (row.original !== null || row.stored !== null) throw fail('Absent channel must not carry a fabricated vector.');
      continue;
    }
    present++;
    if (!Array.isArray(row.stored) || row.stored.length !== embedding.dimensions
      || row.stored.some(value => value >= embedding.storage.levels)) throw fail('Present stored channel has invalid width or quantization levels.');
    coordinates += row.stored.length;
    if (row.original !== null) { assertFloat32(row.original, embedding.dimensions); originalCount++; coordinates += row.original.length; }
    if (coordinates > LIMITS.coordinates) throw fail('Vector evaluation coordinate budget exceeded.');
  }
  if (record.corpus.sourceDigest !== vectorEvaluationCorpusDigest(record.rows)) throw fail('Corpus source provenance disagrees with admitted source spans.');
  if (record.originals.status === 'available' && originalCount !== present
    || record.originals.status === 'unavailable' && originalCount !== 0
    || record.originals.status === 'partial' && (!originalCount || originalCount === present)) throw fail('Original-vector availability disagrees with actual captured rows.');
  if (record.originals.status === 'unavailable') {
    if (record.originals.capture !== 'unavailable' || record.originals.digest !== null) throw fail('Unavailable originals cannot claim capture/digest evidence.');
  } else if (record.originals.capture !== 'provider-fp32' || record.originals.digest !== vectorEvaluationOriginalDigest(record.rows)) throw fail('Original FP32 capture digest is missing or corrupt.');
  const observed = record.observed.provenance;
  if (observed.sourceDigest !== record.corpus.sourceDigest || observed.generation !== record.corpus.generation
    || observed.embeddingKey !== vectorEvaluationEmbeddingKey(embedding)
    || observed.queryKey !== vectorEvaluationQueryKey(record)) throw fail('Observed retrieval provenance has stale corpus/generation/model/query identity.');
  for (const values of [record.eligibility.admittedKeys, record.observed.eligibleKeys,
    record.observed.sparseKeys, record.observed.vectorKeys, record.observed.finalKeys]) {
    if (values && values.some(key => !keys.has(key))) throw fail('Candidate/eligibility key is outside the known source universe.');
  }
  const judgments = new Set();
  for (const judgment of record.observed.judgments) {
    if (!keys.has(judgment.key) || judgments.has(judgment.key)) throw fail('Judgments require distinct known source identities.');
    judgments.add(judgment.key);
  }
  record.rows.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  record.eligibility.admittedKeys.sort();
  record.observed.eligibleKeys?.sort();
  record.observed.judgments.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  return { record, key: digest(record), coordinates, bytes: Buffer.byteLength(serialized) };
};

/** Independent double-precision scalar metric, deliberately not a production
 * ranker/dequantizer. Original FP32 coordinates are never reconstructed from u8.
 * Stored conversion explicitly rounds each affine coordinate through FP32.
 */
const prepare = (values, embedding, stored) => {
  const output = new Float64Array(values.length);
  const { minVal, maxVal, levels } = embedding.storage;
  const scale = (maxVal - minVal) / (levels - 1);
  for (let coordinate = 0; coordinate < values.length; coordinate++) output[coordinate] = stored
    ? Math.fround(values[coordinate] * scale + minVal) : values[coordinate];
  if (embedding.normalize) {
    let sum = 0;
    for (const value of output) sum += value * value;
    const norm = Math.sqrt(sum);
    if (norm) for (let coordinate = 0; coordinate < output.length; coordinate++) output[coordinate] = Math.fround(output[coordinate] / norm);
  }
  return output;
};
const score = (query, vector, metric) => {
  let product = 0, distance = 0, querySquared = 0, vectorSquared = 0;
  for (let coordinate = 0; coordinate < query.length; coordinate++) {
    const left = query[coordinate], right = vector[coordinate];
    product += left * right; const delta = left - right; distance += delta * delta;
    querySquared += left * left; vectorSquared += right * right;
  }
  const value = metric === 'dot' ? product : metric === 'l2-squared' ? (distance === 0 ? 0 : -distance)
    : querySquared && vectorSquared ? product / (Math.sqrt(querySquared) * Math.sqrt(vectorSquared)) : 0;
  if (!Number.isFinite(value)) throw fail('Oracle metric overflowed its admitted finite domain.');
  return value;
};
const topK = capacity => {
  const heap = new MinHeap((left, right) => -compare(left, right));
  return { add(value) {
    if (!capacity) return;
    if (heap.size < capacity) heap.push(value);
    else if (compare(value, heap.items[0]) < 0) { heap.pop(); heap.push(value); }
  }, results: () => [...heap.items].sort(compare) };
};
const intersection = (keys, selected) => keys.reduce((count, key) => count + (selected.has(key) ? 1 : 0), 0);
const membership = (reference, actual) => {
  const denominator = reference.length, hits = intersection(reference.map(row => row.key), new Set(actual));
  return { hits, denominator, value: denominator ? hits / denominator : null, emptyUniverse: denominator === 0 };
};
const judgedRelevance = (observed, k) => {
  if (!observed.finalKeys || !observed.judgments.length) return null;
  const relevance = new Map(observed.judgments.map(row => [row.key, row.relevance]));
  const relevant = [...relevance.values()].filter(value => value > 0).length;
  let hits = 0, reciprocal = 0, dcg = 0;
  observed.finalKeys.slice(0, k).forEach((key, index) => {
    const grade = relevance.get(key) || 0;
    if (grade > 0) { hits++; if (!reciprocal) reciprocal = 1 / (index + 1); dcg += (2 ** grade - 1) / Math.log2(index + 2); }
  });
  const ideal = [...relevance.values()].sort((left, right) => right - left).slice(0, k)
    .reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
  return { judgedRelevant: relevant, retrievedRelevant: hits, recallAtK: relevant ? hits / relevant : null,
    mrr: reciprocal, ndcgAtK: ideal ? dcg / ideal : null,
    unjudgedFinal: observed.finalKeys.slice(0, k).filter(key => !relevance.has(key)).length };
};

/** The known eligibility universe is supplied independently of ANN candidates.
 * Cancellation/work/deadline/output refusal returns an explicitly incomplete
 * raw receipt; partial heaps never authorize recall or human-quality metrics.
 */
export const evaluateVectorOracles = async (input, { k = 10, limits = {}, signal = null, resumeKey = null } = {}) => {
  const started = performance.now();
  const admitted = admitVectorEvaluationRecord(input), { record, key } = admitted;
  if (resumeKey !== null && resumeKey !== key) throw fail('Resume record identity changed; restart from the selected immutable input.');
  if (!Number.isSafeInteger(k) || k < 1 || k > LIMITS.topK) throw fail('Oracle cutoff is outside its bounded contract.');
  const policy = { ...LIMITS };
  for (const [name, value] of Object.entries(limits)) {
    if (!Object.hasOwn(policy, name) || !Number.isSafeInteger(value) || value < 1 || value > LIMITS[name]) throw fail('Oracle work/output limits may only tighten known bounds.');
    policy[name] = value;
  }
  if (policy.outputBytes < 256) throw fail('Oracle output budget cannot hold a terminal receipt.');
  const policyKey = digest({ version: VECTOR_EVALUATION_VERSION, k, policy });
  const eligible = new Set(record.eligibility.admittedKeys), observed = record.observed;
  const original = topK(k), stored = topK(k), query = prepare(record.query.vector, record.embedding, false);
  const work = { inputBytes: admitted.bytes, sourceRows: record.rows.length, rowsVisited: 0, eligibleRows: 0,
    absentChannelRows: 0, originalRowsScored: 0, storedRowsScored: 0, coordinates: 0 };
  let reason = admitted.coordinates > policy.coordinates ? 'coordinate-limit' : null;
  for (const row of record.rows) {
    if (reason) break;
    if (signal?.aborted) { reason = 'cancelled'; break; }
    if (performance.now() - started >= policy.milliseconds) { reason = 'deadline'; break; }
    if (work.rowsVisited >= policy.rows) { reason = 'row-limit'; break; }
    const coordinateWork = row.presence[record.embedding.channel] && eligible.has(row.key)
      ? record.embedding.dimensions * (row.original ? 2 : 1) : 0;
    if (work.coordinates + coordinateWork > policy.work) { reason = 'work-limit'; break; }
    work.rowsVisited++;
    if (eligible.has(row.key)) {
      work.eligibleRows++;
      if (!row.presence[record.embedding.channel]) work.absentChannelRows++;
      else {
        if (row.original) { original.add({ key: row.key, score: score(query, prepare(row.original, record.embedding, false), record.embedding.metric) }); work.originalRowsScored++; }
        stored.add({ key: row.key, score: score(query, prepare(row.stored, record.embedding, true), record.embedding.metric) }); work.storedRowsScored++;
        work.coordinates += coordinateWork;
      }
    }
    if (work.rowsVisited % policy.batchRows === 0) await yieldEventLoop();
  }
  if (!reason && signal?.aborted) reason = 'cancelled';
  if (!reason && performance.now() - started >= policy.milliseconds) reason = 'deadline';
  if (!reason && record.eligibility.status !== 'complete') reason = 'eligibility-incomplete';
  const storedResults = stored.results(), originalResults = original.results();
  const originalComplete = !reason && record.originals.status !== 'unavailable'
    && work.originalRowsScored === work.storedRowsScored;
  const reference = originalComplete ? originalResults : storedResults;
  const known = new Set(record.eligibility.admittedKeys), found = observed.eligibleKeys === null ? null : new Set(observed.eligibleKeys);
  const missed = found ? [...known].filter(value => !found.has(value)) : [];
  const extra = found ? [...found].filter(value => !known.has(value)) : [];
  const result = { schemaVersion: VECTOR_EVALUATION_VERSION, kind: 'retrieval-vector-oracle-receipt', recordKey: key, policyKey,
    status: reason ? 'incomplete' : 'complete', complete: !reason, reason,
    provenance: { corpus: record.corpus, embedding: record.embedding, query: { id: record.query.id,
      textDigest: record.query.textDigest, filterDigest: record.query.filterDigest }, originalCapture: record.originals },
    scoreConvention: { higherIsBetter: true, l2: 'negative-squared-distance', cosineZeroNorm: 0,
      normalization: record.embedding.normalize ? 'fp32-l2-before-metric' : 'none', stored: 'affine-then-fp32-coordinate-rounding',
      accumulation: 'independent-javascript-float64-scalar', tie: 'source-key-ascending' },
    original: { status: originalComplete ? 'complete' : record.originals.status === 'unavailable' ? 'unavailable' : 'incomplete',
      representation: 'captured-original-fp32', results: originalResults },
    stored: { status: reason ? 'incomplete' : 'complete', representation: 'declared-stored-uint8', results: storedResults },
    eligibility: { status: record.eligibility.status, method: record.eligibility.method, knownCount: eligible.size,
      observedCount: found?.size ?? null, missingCount: found ? missed.length : null, extraCount: found ? extra.length : null,
      missingKeys: missed.slice(0, 64), extraKeys: extra.slice(0, 64) },
    counts: { ...work, sparseCandidates: observed.sparseKeys.length, vectorCandidates: observed.vectorKeys.length,
      sparseIneligibleCandidates: observed.sparseKeys.filter(value => !known.has(value)).length,
      vectorIneligibleCandidates: observed.vectorKeys.filter(value => !known.has(value)).length,
      unionCandidates: new Set([...observed.sparseKeys, ...observed.vectorKeys]).size,
      finalCandidates: observed.finalKeys?.length ?? null }, elapsedMs: performance.now() - started,
    metrics: reason ? null : { quantizationAgreement: originalComplete ? membership(originalResults, storedResults.map(row => row.key)) : null,
      annCandidateRecall: membership(storedResults, observed.vectorKeys), annTopKRecall: membership(storedResults, observed.vectorKeys.slice(0, k)),
      sparseVectorUnionInclusion: { reference: originalComplete ? 'original-fp32' : 'stored-representation',
        ...membership(reference, [...observed.sparseKeys, ...observed.vectorKeys]) }, humanRelevance: judgedRelevance(observed, k) },
    replay: { mode: 'restart-from-zero', recordKey: key, policyKey, cacheableComplete: !reason } };
  result.elapsedMs = performance.now() - started;
  if (result.complete && result.elapsedMs >= policy.milliseconds) {
    result.complete = false; result.status = 'incomplete'; result.reason = 'deadline'; result.metrics = null;
    result.stored.status = 'incomplete';
    if (result.original.status !== 'unavailable') result.original.status = 'incomplete';
    result.replay.cacheableComplete = false;
  }
  if (Buffer.byteLength(JSON.stringify(result)) > policy.outputBytes) return { schemaVersion: VECTOR_EVALUATION_VERSION,
    kind: result.kind, recordKey: key, status: 'incomplete', complete: false, reason: 'output-limit', metrics: null };
  return result;
};
