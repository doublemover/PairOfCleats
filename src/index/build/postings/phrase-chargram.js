import { createRowSpillCollector } from '../artifacts/helpers.js';
import { sortStrings } from './constants.js';
import { mergeIdListsWithNormalizedLeft, normalizeIdList } from './id-lists.js';

const phraseSeparator = '\u0001';

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
      const waitForYield = requestYield?.();
      if (waitForYield) await waitForYield;
      continue;
    }
    if (Array.isArray(bucket.entries)) {
      for (const entry of bucket.entries) {
        const phrase = resolvePhraseFromIds(entry?.ids, tokenIdMap);
        if (phrase) rows.push([phrase, entry?.posting]);
        const waitForYield = requestYield?.();
        if (waitForYield) await waitForYield;
      }
    }
    const waitForYield = requestYield?.();
    if (waitForYield) await waitForYield;
  }
  return rows;
};

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
  shouldSpillByBytes,
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
      const waitForYield = requestYield?.();
      if (waitForYield) await waitForYield;
    }
    if (typeof phrasePostHashBuckets.clear === 'function') phrasePostHashBuckets.clear();
  } else if (phraseEnabled && phrasePost && typeof phrasePost.keys === 'function') {
    const phraseSpillByUnique = !!(
      buildRoot
      && phraseSpillMaxUnique
      && Number.isFinite(phrasePost.size)
      && phrasePost.size >= phraseSpillMaxUnique
    );
    const phraseSpillByBytes = !!(
      !phraseSpillByUnique
      && buildRoot
      && phraseSpillMaxBytes
      && await shouldSpillByBytes(phrasePost, phraseSpillMaxBytes)
    );
    const phraseShouldSpill = phraseSpillByUnique || phraseSpillByBytes;
    if (phraseShouldSpill) {
      const collector = createRowSpillCollector({
        outDir: buildRoot,
        runPrefix: 'phrase_postings',
        compare: compareChargramRows,
        maxBufferBytes: 4 * 1024 * 1024,
        maxBufferRows: 5000,
        maxJsonBytes: null
      });
      for (const [key, posting] of phrasePost.entries()) {
        await collector.append({
          token: key,
          postings: normalizeIdList(posting)
        });
        phrasePost.delete(key);
        const waitForYield = requestYield?.();
        if (waitForYield) await waitForYield;
      }
      const collected = await collector.finalize();
      const rows = collected?.rows || null;
      const runs = collected?.runs || null;
      const mergeResult = runs
        ? await mergeSpillRuns({ runs, compare: compareChargramRows, label: 'phrase_postings' })
        : null;
      const items = runs
        ? mergeResult?.iterator
        : rows;
      const vocab = [];
      const postingsList = [];
      let currentToken = null;
      let currentPosting = null;
      if (items) {
        const iterator = runs ? items : items[Symbol.iterator]();
        if (runs) {
          postingsMergeStats.phrase = {
            runs: runs.length,
            rows: 0,
            bytes: mergeResult?.stats?.bytes ?? null,
            planner: mergeResult?.plannerUsed || false,
            plannerHintUsed: mergeResult?.plannerHintUsed === true,
            passes: mergeResult?.stats?.passes ?? null,
            runsMerged: mergeResult?.stats?.runsMerged ?? null,
            elapsedMs: mergeResult?.stats?.elapsedMs ?? null
          };
          for await (const row of iterator) {
            const token = row?.token;
            if (!token) {
              const waitForYield = requestYield?.();
              if (waitForYield) await waitForYield;
              continue;
            }
            postingsMergeStats.phrase.rows += 1;
            if (currentToken === null) {
              currentToken = token;
              currentPosting = normalizeIdList(row.postings);
              const waitForYield = requestYield?.();
              if (waitForYield) await waitForYield;
              continue;
            }
            if (token !== currentToken) {
              const normalized = normalizeIdList(currentPosting);
              if (normalized.length) {
                vocab.push(currentToken);
                postingsList.push(normalized);
              }
              currentToken = token;
              currentPosting = normalizeIdList(row.postings);
              const waitForYield = requestYield?.();
              if (waitForYield) await waitForYield;
              continue;
            }
            currentPosting = mergeIdListsWithNormalizedLeft(currentPosting, row.postings);
            const waitForYield = requestYield?.();
            if (waitForYield) await waitForYield;
          }
        } else {
          for (const row of iterator) {
            const token = row?.token;
            if (!token) {
              const waitForYield = requestYield?.();
              if (waitForYield) await waitForYield;
              continue;
            }
            if (currentToken === null) {
              currentToken = token;
              currentPosting = normalizeIdList(row.postings);
              const waitForYield = requestYield?.();
              if (waitForYield) await waitForYield;
              continue;
            }
            if (token !== currentToken) {
              const normalized = normalizeIdList(currentPosting);
              if (normalized.length) {
                vocab.push(currentToken);
                postingsList.push(normalized);
              }
              currentToken = token;
              currentPosting = normalizeIdList(row.postings);
              const waitForYield = requestYield?.();
              if (waitForYield) await waitForYield;
              continue;
            }
            currentPosting = mergeIdListsWithNormalizedLeft(currentPosting, row.postings);
            const waitForYield = requestYield?.();
            if (waitForYield) await waitForYield;
          }
        }
      }
      if (currentToken !== null) {
        const normalized = normalizeIdList(currentPosting);
        if (normalized.length) {
          vocab.push(currentToken);
          postingsList.push(normalized);
        }
      }
      phraseVocab = vocab;
      phrasePostings = postingsList;
      if (mergeResult?.cleanup) await mergeResult.cleanup();
      if (collected?.cleanup) await collected.cleanup();
    } else {
      const entries = [];
      for (const entry of phrasePost.entries()) {
        entries.push(entry);
        const waitForYield = requestYield?.();
        if (waitForYield) await waitForYield;
      }
      entries.sort((a, b) => sortStrings(a[0], b[0]));
      phraseVocab = new Array(entries.length);
      phrasePostings = new Array(entries.length);
      for (let i = 0; i < entries.length; i += 1) {
        const [key, posting] = entries[i];
        phraseVocab[i] = key;
        phrasePostings[i] = normalizeIdList(posting);
        phrasePost.delete(key);
        const waitForYield = requestYield?.();
        if (waitForYield) await waitForYield;
      }
      if (typeof phrasePost.clear === 'function') phrasePost.clear();
    }
  }

  let chargramVocab = [];
  let chargramPostings = [];
  let chargramStats = null;
  const triPostSize = triPost?.size || 0;
  if (chargramEnabled && triPost && typeof triPost.keys === 'function') {
    const spillByUnique = !!(
      buildRoot
      && chargramSpillMaxUnique
      && Number.isFinite(triPost.size)
      && triPost.size >= chargramSpillMaxUnique
    );
    const spillByBytes = !!(
      !spillByUnique
      && buildRoot
      && chargramSpillMaxBytes
      && await shouldSpillByBytes(triPost, chargramSpillMaxBytes)
    );
    const shouldSpill = spillByUnique || spillByBytes;
    if (shouldSpill) {
      const collector = createRowSpillCollector({
        outDir: buildRoot,
        runPrefix: 'chargram_postings',
        compare: compareChargramRows,
        maxBufferBytes: 4 * 1024 * 1024,
        maxBufferRows: 5000,
        maxJsonBytes: null
      });
      for (const [key, posting] of triPost.entries()) {
        await collector.append({
          token: key,
          postings: normalizeIdList(posting)
        });
        triPost.delete(key);
        const waitForYield = requestYield?.();
        if (waitForYield) await waitForYield;
      }
      const collected = await collector.finalize();
      const rows = collected?.rows || null;
      const runs = collected?.runs || null;
      const stats = collected?.stats || null;
      const mergeResult = runs
        ? await mergeSpillRuns({ runs, compare: compareChargramRows, label: 'chargram_postings' })
        : null;
      const items = runs
        ? mergeResult?.iterator
        : rows;
      const vocab = [];
      const postingsList = [];
      let currentToken = null;
      let currentPosting = null;
      if (items) {
        const iterator = runs ? items : items[Symbol.iterator]();
        if (runs) {
          postingsMergeStats.chargram = {
            runs: runs.length,
            rows: 0,
            bytes: mergeResult?.stats?.bytes ?? null,
            planner: mergeResult?.plannerUsed || false,
            plannerHintUsed: mergeResult?.plannerHintUsed === true,
            passes: mergeResult?.stats?.passes ?? null,
            runsMerged: mergeResult?.stats?.runsMerged ?? null,
            elapsedMs: mergeResult?.stats?.elapsedMs ?? null
          };
          for await (const row of iterator) {
            const token = row?.token;
            if (!token) {
              const waitForYield = requestYield?.();
              if (waitForYield) await waitForYield;
              continue;
            }
            postingsMergeStats.chargram.rows += 1;
            if (currentToken === null) {
              currentToken = token;
              currentPosting = normalizeIdList(row.postings);
              const waitForYield = requestYield?.();
              if (waitForYield) await waitForYield;
              continue;
            }
            if (token !== currentToken) {
              const normalized = normalizeChargramPosting(currentPosting);
              if (normalized) {
                vocab.push(currentToken);
                postingsList.push(normalized);
              }
              currentToken = token;
              currentPosting = normalizeIdList(row.postings);
              const waitForYield = requestYield?.();
              if (waitForYield) await waitForYield;
              continue;
            }
            currentPosting = mergeIdListsWithNormalizedLeft(currentPosting, row.postings);
            const waitForYield = requestYield?.();
            if (waitForYield) await waitForYield;
          }
        } else {
          for (const row of iterator) {
            const token = row?.token;
            if (!token) {
              const waitForYield = requestYield?.();
              if (waitForYield) await waitForYield;
              continue;
            }
            if (currentToken === null) {
              currentToken = token;
              currentPosting = normalizeIdList(row.postings);
              const waitForYield = requestYield?.();
              if (waitForYield) await waitForYield;
              continue;
            }
            if (token !== currentToken) {
              const normalized = normalizeChargramPosting(currentPosting);
              if (normalized) {
                vocab.push(currentToken);
                postingsList.push(normalized);
              }
              currentToken = token;
              currentPosting = normalizeIdList(row.postings);
              const waitForYield = requestYield?.();
              if (waitForYield) await waitForYield;
              continue;
            }
            currentPosting = mergeIdListsWithNormalizedLeft(currentPosting, row.postings);
            const waitForYield = requestYield?.();
            if (waitForYield) await waitForYield;
          }
        }
      }
      if (currentToken !== null) {
        const normalized = normalizeChargramPosting(currentPosting);
        if (normalized) {
          vocab.push(currentToken);
          postingsList.push(normalized);
        }
      }
      chargramVocab = vocab;
      chargramPostings = postingsList;
      if (mergeResult?.cleanup) await mergeResult.cleanup();
      if (collected?.cleanup) await collected.cleanup();
      const guard = postingsGuard?.chargram || null;
      const guardStats = guard
        ? {
          maxUnique: guard.maxUnique,
          maxPerChunk: guard.maxPerChunk,
          dropped: guard.dropped,
          truncatedChunks: guard.truncatedChunks,
          peakUnique: guard.peakUnique
        }
        : null;
      chargramStats = {
        spillEnabled: true,
        spillRuns: runs?.length || 0,
        spillRows: stats?.totalRows || 0,
        spillBytes: stats?.totalBytes || 0,
        spillMaxRowBytes: stats?.maxRowBytes || 0,
        peakUnique: guard?.peakUnique || triPostSize || 0,
        droppedHighDf,
        maxDf: maxChargramDf,
        guard: guardStats
      };
    } else {
      const entries = [];
      for (const entry of triPost.entries()) {
        entries.push(entry);
        const waitForYield = requestYield?.();
        if (waitForYield) await waitForYield;
      }
      entries.sort((a, b) => sortStrings(a[0], b[0]));
      chargramVocab = [];
      chargramPostings = [];
      for (let i = 0; i < entries.length; i += 1) {
        const [key, posting] = entries[i];
        const normalized = normalizeChargramPosting(posting);
        if (normalized) {
          chargramVocab.push(key);
          chargramPostings.push(normalized);
        }
        triPost.delete(key);
        const waitForYield = requestYield?.();
        if (waitForYield) await waitForYield;
      }
      if (typeof triPost.clear === 'function') triPost.clear();
    }
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
      guard: guard
        ? {
          maxUnique: guard.maxUnique,
          maxPerChunk: guard.maxPerChunk,
          dropped: guard.dropped,
          truncatedChunks: guard.truncatedChunks,
          peakUnique: guard.peakUnique
        }
        : null
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
