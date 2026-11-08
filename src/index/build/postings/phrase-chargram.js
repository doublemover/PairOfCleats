import { throwIfAborted } from '../../../shared/abort.js';
import { createRowSpillCollector } from '../artifacts/helpers.js';
import { requestCooperativeYield } from './constants.js';
import { mergeIdListsWithNormalizedLeft, normalizeIdList } from './id-lists.js';

const phraseSeparator = '\u0001';
const SPILL_BUFFER_MAX_BYTES = 4 * 1024 * 1024;
const SPILL_BUFFER_MAX_ROWS = 5000;

/**
 * Build a stable phrase key from token IDs.
 *
 * @param {number[]|null|undefined} ids
 * @param {Map<number|string, string>} [tokenIdMap]
 * @returns {string}
 */
const resolvePhraseFromIds = (ids, tokenIdMap) => {
  if (!Array.isArray(ids) || !ids.length) return '';
  const parts = new Array(ids.length);
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const token = tokenIdMap?.get?.(id);
    parts[i] = token || String(id);
  }
  return parts.join(phraseSeparator);
};

/**
 * Lazily resolve one phrase row at a time. The caller consumes bucket ownership
 * only after accepting its rows, without retaining a full expanded phrase array.
 *
 * @param {{
 *   phrasePostHashBuckets?: Map<any, any>|null,
 *   tokenIdMap?: Map<number|string, string>|null,
 * }} input
 * @returns {Generator<[string, unknown]|null>}
 */
const iteratePhraseEntriesFromHashBuckets = function* ({
  phrasePostHashBuckets,
  tokenIdMap
}) {
  if (!phrasePostHashBuckets || typeof phrasePostHashBuckets.entries !== 'function') return;
  for (const [key, bucket] of phrasePostHashBuckets.entries()) {
    if (!bucket || typeof bucket !== 'object') { yield null; continue; }
    if (bucket.kind === 'single') {
      const phrase = resolvePhraseFromIds(bucket.ids, tokenIdMap);
      yield phrase ? [phrase, bucket.posting] : null;
      if (phrase) phrasePostHashBuckets.delete?.(key);
      continue;
    }
    if (Array.isArray(bucket.entries)) {
      let consumed = false;
      for (const entry of bucket.entries) {
        const phrase = resolvePhraseFromIds(entry?.ids, tokenIdMap);
        yield phrase ? [phrase, entry?.posting] : null;
        if (phrase) consumed = true;
      }
      if (consumed) phrasePostHashBuckets.delete?.(key);
    }
  }
};

const iterateMapEntries = function* (map) {
  if (!map || typeof map.entries !== 'function') return;
  for (const entry of map.entries()) {
    yield entry;
    map.delete?.(entry[0]);
  }
};

/**
 * Convert chargram postings guard data into output schema.
 *
 * @param {object|null|undefined} guard
 * @returns {{
 *   maxUnique: number,
 *   maxPerChunk: number,
 *   dropped: number,
 *   truncatedChunks: number,
 *   peakUnique: number
 * }|null}
 */
const toChargramGuardStats = (guard) => (guard
  ? {
    maxUnique: guard.maxUnique,
    maxPerChunk: guard.maxPerChunk,
    dropped: guard.dropped,
    truncatedChunks: guard.truncatedChunks,
    peakUnique: guard.peakUnique
  }
  : null);

/**
 * Build merge stats payload for spill-run merges.
 *
 * @param {Array<string|{path?: string}>} runs
 * @param {{
 *   stats?: {
 *     bytes?: number,
 *     passes?: number,
 *     runsMerged?: number,
 *     elapsedMs?: number
 *   }|null,
 *   plannerUsed?: boolean,
 *   plannerHintUsed?: boolean
 * }|null} mergeResult
 * @returns {{
 *   runs: number,
 *   rows: number,
 *   bytes: number|null,
 *   planner: boolean,
 *   plannerHintUsed: boolean,
 *   passes: number|null,
 *   runsMerged: number|null,
 *   elapsedMs: number|null
 * }}
 */
const createMergeStats = (runs, mergeResult) => ({
  runs: runs.length,
  rows: 0,
  bytes: mergeResult?.stats?.bytes ?? null,
  planner: mergeResult?.plannerUsed || false,
  plannerHintUsed: mergeResult?.plannerHintUsed === true,
  passes: mergeResult?.stats?.passes ?? null,
  runsMerged: mergeResult?.stats?.runsMerged ?? null,
  elapsedMs: mergeResult?.stats?.elapsedMs ?? null
});

/**
 * Build a spill collector for postings rows.
 *
 * @param {{
 *   buildRoot: string,
 *   runPrefix: string,
 *   compare: (a: any, b: any) => number
 * }} input
 * @returns {ReturnType<typeof createRowSpillCollector>}
 */
const createPostingCollector = ({ buildRoot, runPrefix, compare }) => createRowSpillCollector({
  outDir: buildRoot,
  runPrefix,
  compare,
  maxBufferBytes: SPILL_BUFFER_MAX_BYTES,
  maxBufferRows: SPILL_BUFFER_MAX_ROWS,
  maxJsonBytes: null
});

/**
 * Collect lazy postings rows and spill adaptively in a single pass.
 *
 * Avoids a full pre-scan for byte-threshold checks by promoting to spill mode
 * when accepted phrase rows or serialized JSONL bytes reach the configured
 * thresholds. Collision buckets count every phrase, never just the outer key.
 *
 * @param {{
 *   entries: Iterable<[string, unknown]|null>,
 *   inputSize?: number,
 *   buildRoot?: string|null,
 *   runPrefix: string,
 *   compare: (a: any, b: any) => number,
 *   maxSpillUnique?: number,
 *   maxSpillBytes?: number,
 *   normalizePosting?: (posting: unknown) => number[],
 *   abortSignal?: AbortSignal|null,
 *   requestYield?: (() => Promise<void> | null)|null
 * }} input
 * @returns {Promise<{
 *   rows: Array<{ token: string, postings: number[] }> | null,
 *   runs: Array<string|{ path?: string }> | null,
 *   stats: {
 *     totalRows?: number,
 *     totalBytes?: number,
 *     maxRowBytes?: number
 *   } | null,
 *   cleanup: (() => Promise<void>) | null,
 *   spillEnabled: boolean
 * }>}
 */
const collectRowsWithAdaptiveSpill = async ({
  entries,
  inputSize = 0,
  buildRoot,
  runPrefix,
  compare,
  maxSpillUnique = 0,
  maxSpillBytes = 0,
  normalizePosting = normalizeIdList,
  requestYield,
  abortSignal
}) => {
  const allowSpill = !!buildRoot;
  const spillByUnique = !!(
    allowSpill
    && maxSpillUnique
    && Number.isFinite(inputSize)
    && inputSize >= maxSpillUnique
  );
  let collector = spillByUnique
    ? createPostingCollector({ buildRoot, runPrefix, compare })
    : null;
  let bufferedRows = collector ? null : [];
  let bufferedBytes = 0;
  let collectorRows = 0;
  let collectorBytes = 0;
  const assembly = {
    inputRows: 0, inputSerializedBytes: 0, maxRowBytes: 0,
    adaptiveBufferHighWaterRows: 0, adaptiveBufferHighWaterBytes: 0,
    collectorBufferHighWaterRows: 0, collectorBufferHighWaterBytes: 0,
    collectorMaxRows: SPILL_BUFFER_MAX_ROWS, collectorMaxBytes: SPILL_BUFFER_MAX_BYTES,
    maxSpillUnique, maxSpillBytes, spillAllowed: allowSpill,
    sourcePendingRowLimit: 1
  };
  const serializeRow = row => {
    const line = JSON.stringify(row);
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
    return { line, lineBytes };
  };
  const append = async (row, serialized = serializeRow(row)) => {
    throwIfAborted(abortSignal);
    const priorRuns = collector.stats.runsSpilled || 0;
    await collector.append(row, serialized);
    collectorRows++;
    collectorBytes += serialized.lineBytes;
    assembly.collectorBufferHighWaterRows = Math.max(assembly.collectorBufferHighWaterRows, collectorRows);
    assembly.collectorBufferHighWaterBytes = Math.max(assembly.collectorBufferHighWaterBytes, collectorBytes);
    if ((collector.stats.runsSpilled || 0) > priorRuns) { collectorRows = 0; collectorBytes = 0; }
  };
  try {
    throwIfAborted(abortSignal);
    for (const entry of entries || []) {
      throwIfAborted(abortSignal);
      if (!entry) {
        const skippedYield = requestCooperativeYield(requestYield);
        if (skippedYield) await skippedYield;
        continue;
      }
      const [token, posting] = entry;
      const row = {
        token,
        postings: normalizePosting(posting),
        // Keep the original stable hashed row order even when planner merges
        // regroup runs containing equal resolved keys (e.g. token-map aliases).
        order: assembly.inputRows
      };
      let serialized = serializeRow(row);
      assembly.inputRows++;
      assembly.inputSerializedBytes += serialized.lineBytes;
      assembly.maxRowBytes = Math.max(assembly.maxRowBytes, serialized.lineBytes);
      if (collector) {
        await append(row, serialized);
      } else {
        bufferedRows.push(row);
        bufferedBytes += serialized.lineBytes;
        assembly.adaptiveBufferHighWaterRows = Math.max(assembly.adaptiveBufferHighWaterRows, bufferedRows.length);
        assembly.adaptiveBufferHighWaterBytes = Math.max(assembly.adaptiveBufferHighWaterBytes, bufferedBytes);
        if (allowSpill && ((maxSpillBytes && bufferedBytes >= maxSpillBytes)
        || (maxSpillUnique && assembly.inputRows >= maxSpillUnique))) {
          // Release the current serialized scratch before replaying the buffer.
          serialized = null;
          collector = createPostingCollector({ buildRoot, runPrefix, compare });
          for (let i = 0; i < bufferedRows.length; i++) {
            await append(bufferedRows[i]);
            bufferedRows[i] = null;
            const pendingYield4 = requestCooperativeYield(requestYield);
            if (pendingYield4) await pendingYield4;
          }
          bufferedRows = null;
        }
      }
      const pendingYield5 = requestCooperativeYield(requestYield);
      if (pendingYield5) await pendingYield5;
    }
    throwIfAborted(abortSignal);

    if (!collector) {
      bufferedRows.sort(compare);
      return {
        rows: bufferedRows,
        runs: null,
        stats: null,
        cleanup: null,
        spillEnabled: false,
        assembly
      };
    }

    const collected = await collector.finalize();
    return {
      rows: collected?.rows || null,
      runs: collected?.runs || null,
      stats: collected?.stats || null,
      cleanup: collected?.cleanup || null,
      spillEnabled: true,
      assembly
    };
  } catch (error) {
    if (collector) {
      try { await collector.cleanup(); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Postings row collection and original spill cleanup failed.', { cause: error });
      }
    }
    throw error;
  }
};

/**
 * Fold sorted rows into `vocab[]` and `postings[]` arrays.
 *
 * @param {{
 *   items: AsyncIterable<{token?: string, postings?: unknown}>|Iterable<{token?: string, postings?: unknown}>|null,
 *   asyncItems?: boolean,
 *   normalizeRowPosting?: (posting: unknown) => number[],
 *   finalizePosting?: (posting: number[]) => number[]|null,
 *   onRow?: ((row: {token?: string, postings?: unknown}) => void)|null,
 *   requestYield?: (() => Promise<void> | null)|null
 * }} input
 * @returns {Promise<{ vocab: string[], postings: number[][] }>}
 */
const foldSortedRows = async ({
  items,
  asyncItems = false,
  normalizeRowPosting = normalizeIdList,
  finalizePosting = (posting) => posting,
  preserveRows = false,
  onRow = null,
  requestYield,
  abortSignal
}) => {
  const vocab = [];
  const postings = [];
  let currentToken = null;
  let currentPosting = null;

  const emitCurrent = () => {
    if (currentToken === null) return;
    const finalized = finalizePosting(currentPosting);
    if (finalized && finalized.length) {
      vocab.push(currentToken);
      postings.push(finalized);
    }
  };

  const processRow = (row) => {
    throwIfAborted(abortSignal);
    const token = row?.token;
    if (!token) return;
    if (onRow) onRow(row);
    if (preserveRows) {
      // The hashed producer historically emits each resolved key separately,
      // including empty normalized postings and equal-key token-ID aliases.
      vocab.push(token);
      postings.push(normalizeRowPosting(row.postings));
      return;
    }

    if (currentToken === null) {
      currentToken = token;
      currentPosting = normalizeRowPosting(row.postings);
      return;
    }

    if (token !== currentToken) {
      emitCurrent();
      currentToken = token;
      currentPosting = normalizeRowPosting(row.postings);
      return;
    }

    currentPosting = mergeIdListsWithNormalizedLeft(currentPosting, row.postings);
  };

  if (items) {
    if (asyncItems) {
      for await (const row of items) {
        processRow(row);
        const pendingYield6 = requestCooperativeYield(requestYield);
        if (pendingYield6) await pendingYield6;
      }
    } else {
      for (const row of items) {
        processRow(row);
        const pendingYield7 = requestCooperativeYield(requestYield);
        if (pendingYield7) await pendingYield7;
      }
    }
  }

  throwIfAborted(abortSignal);
  emitCurrent();
  return { vocab, postings };
};

/**
 * Build sorted postings arrays from a postings map, optionally spilling and
 * planner-merging runs when configured thresholds are exceeded.
 *
 * @param {{
 *   map: Map<string, unknown>,
 *   buildRoot?: string|null,
 *   runPrefix: string,
 *   compare: (a: any, b: any) => number,
 *   maxSpillUnique?: number,
 *   maxSpillBytes?: number,
 *   normalizePosting?: (posting: unknown) => number[],
 *   finalizePosting?: (posting: number[]) => number[]|null,
 *   mergeSpillRuns: (input: {
 *     runs: Array<string|{path?: string}>,
 *     compare: (a: any, b: any) => number,
 *     label: string
 *   }) => Promise<{
 *     iterator: AsyncIterable<any>|Iterable<any>|null,
 *     cleanup?: (() => Promise<void>)|null,
 *     stats?: object|null,
 *     plannerUsed?: boolean,
 *     plannerHintUsed?: boolean
 *   }>,
 *   requestYield?: (() => Promise<void> | null)|null
 * }} input
 * @returns {Promise<{
 *   vocab: string[],
 *   postings: number[][],
 *   spillEnabled: boolean,
 *   spillRuns: number,
 *   spillStats: { totalRows?: number, totalBytes?: number, maxRowBytes?: number }|null,
 *   mergeStats: {
 *     runs: number,
 *     rows: number,
 *     bytes: number|null,
 *     planner: boolean,
 *     plannerHintUsed: boolean,
 *     passes: number|null,
 *     runsMerged: number|null,
 *     elapsedMs: number|null
 *   }|null
 * }>}
 */
const buildPostingsFromMap = async ({
  map,
  entries = null,
  inputSize = map?.size || 0,
  preserveRows = false,
  buildRoot,
  runPrefix,
  compare,
  maxSpillUnique = 0,
  maxSpillBytes = 0,
  normalizePosting = normalizeIdList,
  finalizePosting = (posting) => posting,
  mergeSpillRuns,
  requestYield,
  abortSignal
}) => {
  const compareRows = (left, right) => compare(left, right) || (left.order - right.order);
  const collected = await collectRowsWithAdaptiveSpill({
    entries: entries || iterateMapEntries(map),
    inputSize,
    buildRoot,
    runPrefix,
    compare: compareRows,
    maxSpillUnique,
    maxSpillBytes,
    normalizePosting,
    requestYield,
    abortSignal
  });
  let mergeResult = null;
  let failed = false;
  let primaryError;
  try {
    throwIfAborted(abortSignal);
    // Incremental iterator deletion occurs only after each row is accepted.
    // Preserve successful destructive consumption for custom map-like callers.
    map?.clear?.();
    const runs = collected.runs;
    if (runs) {
      mergeResult = await mergeSpillRuns({ runs, compare: compareRows, label: runPrefix });
    }
    const mergeStats = runs ? createMergeStats(runs, mergeResult) : null;
    const { vocab, postings } = await foldSortedRows({
      items: runs ? mergeResult?.iterator : collected.rows,
      asyncItems: !!runs,
      normalizeRowPosting: normalizePosting,
      finalizePosting,
      preserveRows,
      onRow: mergeStats
        ? () => {
          mergeStats.rows += 1;
        }
        : null,
      requestYield,
      abortSignal
    });
    return {
      vocab,
      postings,
      spillEnabled: collected.spillEnabled,
      spillRuns: runs?.length || 0,
      spillStats: collected.stats || null,
      assembly: collected.assembly,
      mergeStats
    };
  } catch (error) {
    failed = true; primaryError = error;
    throw error;
  } finally {
    // Each cleanup remains bound to its original owner. A merge teardown
    // failure cannot prevent original input runs from being released as well.
    const failures = [];
    for (const owner of [mergeResult, collected]) {
      if (!owner?.cleanup) continue;
      try { await owner.cleanup(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failed ? [primaryError, ...failures] : failures,
      'Postings spill ownership cleanup failed.', failed ? { cause: primaryError } : undefined);
  }
};

/**
 * Build phrase and chargram postings, applying optional spill/merge strategy for
 * high-cardinality maps and DF guards for chargrams.
 *
 * @param {{
 *   phraseEnabled?: boolean,
 *   chargramEnabled?: boolean,
 *   phraseHashEnabled?: boolean,
 *   phrasePostHashBuckets?: Map<any, any>|null,
 *   phrasePost?: Map<string, unknown>|null,
 *   triPost?: Map<string, unknown>|null,
 *   tokenIdMap?: Map<number|string, string>|null,
 *   buildRoot?: string|null,
 *   phraseSpillMaxBytes?: number,
 *   phraseSpillMaxUnique?: number,
 *   chargramSpillMaxBytes?: number,
 *   chargramSpillMaxUnique?: number,
 *   chargramMaxDf?: number,
 *   postingsGuard?: object|null,
 *   abortSignal?: AbortSignal|null,
 *   requestYield?: (() => Promise<void> | null)|null,
 *   mergeSpillRuns: (input: {
 *     runs: Array<string|{path?: string}>,
 *     compare: (a: any, b: any) => number,
 *     label: string
 *   }) => Promise<{
 *     iterator: AsyncIterable<any>|Iterable<any>|null,
 *     cleanup?: (() => Promise<void>)|null,
 *     stats?: object|null,
 *     plannerUsed?: boolean,
 *     plannerHintUsed?: boolean
 *   }>,
 *   compareChargramRows: (a: any, b: any) => number
 * }} [input]
 * @returns {Promise<{
 *   phraseVocab: string[],
 *   phrasePostings: number[][],
 *   phraseStats: object|null,
 *   chargramVocab: string[],
 *   chargramPostings: number[][],
 *   chargramStats: object,
 *   postingsMergeStats: { phrase: object|null, chargram: object|null }
 * }>}
 */
export const buildPhraseAndChargramPostings = async ({
  phraseEnabled,
  chargramEnabled,
  phraseHashEnabled,
  phrasePostHashBuckets = null,
  phrasePost = null,
  triPost = null,
  tokenIdMap = null,
  buildRoot = null,
  phraseSpillMaxBytes = 0,
  phraseSpillMaxUnique = 0,
  chargramSpillMaxBytes = 0,
  chargramSpillMaxUnique = 0,
  chargramMaxDf = 0,
  postingsGuard = null,
  requestYield,
  abortSignal = null,
  mergeSpillRuns,
  compareChargramRows
} = {}) => {
  const postingsMergeStats = {
    phrase: null,
    chargram: null
  };

  let droppedHighDf = 0;
  let maxChargramDf = 0;
  const normalizeChargramPosting = (value) => {
    const list = normalizeIdList(value);
    maxChargramDf = Math.max(maxChargramDf, list.length);
    if (chargramMaxDf && list.length > chargramMaxDf) {
      droppedHighDf += 1;
      return null;
    }
    return list;
  };

  let phraseVocab = [];
  let phrasePostings = [];
  let phraseStats = null;
  if (phraseEnabled) {
    let phraseResult = null;
    const inputHashBuckets = Number.isFinite(phrasePostHashBuckets?.size) ? phrasePostHashBuckets.size : null;
    if (phraseHashEnabled) {
      phraseResult = await buildPostingsFromMap({
        entries: iteratePhraseEntriesFromHashBuckets({ phrasePostHashBuckets, tokenIdMap }),
        inputSize: inputHashBuckets || 0,
        preserveRows: true,
        buildRoot,
        runPrefix: 'phrase_postings',
        compare: compareChargramRows,
        maxSpillUnique: phraseSpillMaxUnique,
        maxSpillBytes: phraseSpillMaxBytes,
        mergeSpillRuns,
        requestYield,
        abortSignal
      });
      if (phraseResult.assembly.inputRows) phrasePostHashBuckets?.clear?.();
      else phraseResult = null;
    }
    const source = phraseResult ? 'hashed-buckets' : 'string-map';
    const inputStringEntries = !phraseResult && Number.isFinite(phrasePost?.size) ? phrasePost.size : 0;
    if (!phraseResult) phraseResult = await buildPostingsFromMap({
      map: phrasePost,
      buildRoot,
      runPrefix: 'phrase_postings',
      compare: compareChargramRows,
      maxSpillUnique: phraseSpillMaxUnique,
      maxSpillBytes: phraseSpillMaxBytes,
      normalizePosting: normalizeIdList,
      finalizePosting: (posting) => (posting.length ? posting : null),
      mergeSpillRuns,
      requestYield,
      abortSignal
    });
    phraseVocab = phraseResult.vocab;
    phrasePostings = phraseResult.postings;
    postingsMergeStats.phrase = phraseResult.mergeStats;
    phraseStats = {
      source, inputHashBuckets, inputStringEntries,
      ...phraseResult.assembly,
      spillEnabled: phraseResult.spillEnabled,
      spillRuns: phraseResult.spillRuns,
      spillRows: phraseResult.spillStats?.totalRows || 0,
      spillBytes: phraseResult.spillStats?.totalBytes || 0,
      spillMaxRowBytes: phraseResult.spillStats?.maxRowBytes || 0,
      finalRows: phraseVocab.length,
      // These owners already materialize; serialized assembly telemetry is
      // neither a V8 heap measurement nor an end-to-end memory bound.
      inputBucketBytes: null, finalArrayBytes: null
    };
  }

  let chargramVocab = [];
  let chargramPostings = [];
  let chargramStats = null;
  const triPostSize = triPost?.size || 0;
  if (chargramEnabled && triPost && typeof triPost.keys === 'function') {
    const chargramResult = await buildPostingsFromMap({
      map: triPost,
      buildRoot,
      runPrefix: 'chargram_postings',
      compare: compareChargramRows,
      maxSpillUnique: chargramSpillMaxUnique,
      maxSpillBytes: chargramSpillMaxBytes,
      normalizePosting: normalizeIdList,
      finalizePosting: normalizeChargramPosting,
      mergeSpillRuns,
      requestYield,
      abortSignal
    });
    chargramVocab = chargramResult.vocab;
    chargramPostings = chargramResult.postings;
    postingsMergeStats.chargram = chargramResult.mergeStats;
    const guard = postingsGuard?.chargram || null;
    chargramStats = {
      spillEnabled: chargramResult.spillEnabled,
      spillRuns: chargramResult.spillRuns,
      spillRows: chargramResult.spillStats?.totalRows || 0,
      spillBytes: chargramResult.spillStats?.totalBytes || 0,
      spillMaxRowBytes: chargramResult.spillStats?.maxRowBytes || 0,
      peakUnique: guard?.peakUnique || triPostSize || 0,
      droppedHighDf,
      maxDf: maxChargramDf,
      guard: toChargramGuardStats(guard)
    };
  }

  const guard = postingsGuard?.chargram || null;
  if (!chargramStats) {
    chargramStats = {
      spillEnabled: false,
      spillRuns: 0,
      spillRows: 0,
      spillBytes: 0,
      spillMaxRowBytes: 0,
      peakUnique: guard?.peakUnique || triPostSize || 0,
      droppedHighDf,
      maxDf: maxChargramDf,
      guard: toChargramGuardStats(guard)
    };
  }

  return {
    phraseVocab,
    phrasePostings,
    phraseStats,
    chargramVocab,
    chargramPostings,
    chargramStats,
    postingsMergeStats
  };
};
