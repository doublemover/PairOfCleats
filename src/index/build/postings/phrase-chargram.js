import { estimateJsonBytes } from '../../../shared/cache.js';
import { createRowSpillCollector } from '../artifacts/helpers.js';
import { maybeYield, sortStrings } from './constants.js';
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
 * Flatten hash-bucket phrase postings into sortable `[phrase, posting]` rows.
 *
 * @param {{
 *   phraseHashEnabled: boolean,
 *   phrasePostHashBuckets?: Map<any, any>|null,
 *   tokenIdMap?: Map<number|string, string>|null,
 *   requestYield?: (() => Promise<void> | null)|null
 * }} input
 * @returns {Promise<Array<[string, unknown]>>}
 */
const collectPhraseEntriesFromHashBuckets = async ({
  phraseHashEnabled,
  phrasePostHashBuckets,
  tokenIdMap,
  requestYield
}) => {
  if (!phraseHashEnabled) return [];
  if (!phrasePostHashBuckets || typeof phrasePostHashBuckets.entries !== 'function') return [];
  const rows = [];
  for (const [, bucket] of phrasePostHashBuckets.entries()) {
    if (!bucket || typeof bucket !== 'object') continue;
    if (bucket.kind === 'single') {
      const phrase = resolvePhraseFromIds(bucket.ids, tokenIdMap);
      if (phrase) rows.push([phrase, bucket.posting]);
      await maybeYield(requestYield);
      continue;
    }
    if (Array.isArray(bucket.entries)) {
      for (const entry of bucket.entries) {
        const phrase = resolvePhraseFromIds(entry?.ids, tokenIdMap);
        if (phrase) rows.push([phrase, entry?.posting]);
        await maybeYield(requestYield);
      }
    }
    await maybeYield(requestYield);
  }
  return rows;
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
 * Collect postings map rows and spill adaptively in a single pass.
 *
 * Avoids a full pre-scan for byte-threshold checks by promoting to spill mode
 * only when the running estimated row bytes crosses `maxSpillBytes`.
 *
 * @param {{
 *   map: Map<string, unknown>,
 *   buildRoot?: string|null,
 *   runPrefix: string,
 *   compare: (a: any, b: any) => number,
 *   maxSpillUnique?: number,
 *   maxSpillBytes?: number,
 *   normalizePosting?: (posting: unknown) => number[],
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
  map,
  buildRoot,
  runPrefix,
  compare,
  maxSpillUnique = 0,
  maxSpillBytes = 0,
  normalizePosting = normalizeIdList,
  requestYield
}) => {
  if (!map || typeof map.entries !== 'function') {
    return {
      rows: [],
      runs: null,
      stats: null,
      cleanup: null,
      spillEnabled: false
    };
  }

  const allowSpill = !!buildRoot;
  const spillByUnique = !!(
    allowSpill
    && maxSpillUnique
    && Number.isFinite(map.size)
    && map.size >= maxSpillUnique
  );
  let collector = spillByUnique
    ? createPostingCollector({ buildRoot, runPrefix, compare })
    : null;
  let bufferedRows = collector ? null : [];
  let bufferedBytes = 0;

  for (const [token, posting] of map.entries()) {
    const row = {
      token,
      postings: normalizePosting(posting)
    };
    if (collector) {
      await collector.append(row);
    } else {
      bufferedRows.push(row);
      if (allowSpill && maxSpillBytes) {
        bufferedBytes += estimateJsonBytes(row);
        if (bufferedBytes >= maxSpillBytes) {
          collector = createPostingCollector({ buildRoot, runPrefix, compare });
          for (const bufferedRow of bufferedRows) {
            await collector.append(bufferedRow);
            await maybeYield(requestYield);
          }
          bufferedRows = null;
        }
      }
    }
    await maybeYield(requestYield);
  }
  if (typeof map.clear === 'function') map.clear();

  if (!collector) {
    bufferedRows.sort(compare);
    return {
      rows: bufferedRows,
      runs: null,
      stats: null,
      cleanup: null,
      spillEnabled: false
    };
  }

  const collected = await collector.finalize();
  return {
    rows: collected?.rows || null,
    runs: collected?.runs || null,
    stats: collected?.stats || null,
    cleanup: collected?.cleanup || null,
    spillEnabled: true
  };
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
  onRow = null,
  requestYield
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
    const token = row?.token;
    if (!token) return;
    if (onRow) onRow(row);

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
        await maybeYield(requestYield);
      }
    } else {
      for (const row of items) {
        processRow(row);
        await maybeYield(requestYield);
      }
    }
  }

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
  buildRoot,
  runPrefix,
  compare,
  maxSpillUnique = 0,
  maxSpillBytes = 0,
  normalizePosting = normalizeIdList,
  finalizePosting = (posting) => posting,
  mergeSpillRuns,
  requestYield
}) => {
  const collected = await collectRowsWithAdaptiveSpill({
    map,
    buildRoot,
    runPrefix,
    compare,
    maxSpillUnique,
    maxSpillBytes,
    normalizePosting,
    requestYield
  });

  let mergeResult = null;
  try {
    const runs = collected.runs;
    if (runs) {
      mergeResult = await mergeSpillRuns({ runs, compare, label: runPrefix });
    }
    const mergeStats = runs ? createMergeStats(runs, mergeResult) : null;
    const { vocab, postings } = await foldSortedRows({
      items: runs ? mergeResult?.iterator : collected.rows,
      asyncItems: !!runs,
      normalizeRowPosting: normalizePosting,
      finalizePosting,
      onRow: mergeStats
        ? () => {
          mergeStats.rows += 1;
        }
        : null,
      requestYield
    });
    return {
      vocab,
      postings,
      spillEnabled: collected.spillEnabled,
      spillRuns: runs?.length || 0,
      spillStats: collected.stats || null,
      mergeStats
    };
  } finally {
    if (mergeResult?.cleanup) await mergeResult.cleanup();
    if (collected.cleanup) await collected.cleanup();
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
  const phraseEntriesFromHash = await collectPhraseEntriesFromHashBuckets({
    phraseHashEnabled,
    phrasePostHashBuckets,
    tokenIdMap,
    requestYield
  });
  if (phraseEnabled && phraseEntriesFromHash.length) {
    const entries = phraseEntriesFromHash.sort((a, b) => sortStrings(a[0], b[0]));
    phraseVocab = new Array(entries.length);
    phrasePostings = new Array(entries.length);
    for (let i = 0; i < entries.length; i += 1) {
      const [key, posting] = entries[i];
      phraseVocab[i] = key;
      phrasePostings[i] = normalizeIdList(posting);
      await maybeYield(requestYield);
    }
    if (typeof phrasePostHashBuckets.clear === 'function') phrasePostHashBuckets.clear();
  } else if (phraseEnabled && phrasePost && typeof phrasePost.keys === 'function') {
    const phraseResult = await buildPostingsFromMap({
      map: phrasePost,
      buildRoot,
      runPrefix: 'phrase_postings',
      compare: compareChargramRows,
      maxSpillUnique: phraseSpillMaxUnique,
      maxSpillBytes: phraseSpillMaxBytes,
      normalizePosting: normalizeIdList,
      finalizePosting: (posting) => (posting.length ? posting : null),
      mergeSpillRuns,
      requestYield
    });
    phraseVocab = phraseResult.vocab;
    phrasePostings = phraseResult.postings;
    postingsMergeStats.phrase = phraseResult.mergeStats;
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
      requestYield
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
    chargramVocab,
    chargramPostings,
    chargramStats,
    postingsMergeStats
  };
};
