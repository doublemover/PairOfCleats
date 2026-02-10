import fs from 'node:fs/promises';
import path from 'node:path';
import { quantizeVec } from '../embedding.js';
import { DEFAULT_STUB_DIMS } from '../../shared/embedding.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { isVectorLike } from '../../shared/embedding-utils.js';
import { estimateJsonBytes } from '../../shared/cache.js';
import { createRowSpillCollector } from './artifacts/helpers.js';
import {
  DEFAULT_MAX_OPEN_RUNS,
  mergeRunsWithPlanner,
  mergeSortedRuns,
  readJsonlRows
} from '../../shared/merge.js';

const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

const resolveTokenCount = (chunk) => (
  Number.isFinite(chunk?.tokenCount)
    ? chunk.tokenCount
    : (Array.isArray(chunk?.tokens) ? chunk.tokens.length : 0)
);

const isSortedIds = (list) => {
  for (let i = 1; i < list.length; i += 1) {
    if (list[i] < list[i - 1]) return false;
  }
  return true;
};

const isSortedPostings = (list) => {
  for (let i = 1; i < list.length; i += 1) {
    if (!Array.isArray(list[i - 1]) || !Array.isArray(list[i])) return false;
    if (list[i][0] < list[i - 1][0]) return false;
  }
  return true;
};

const tuneBM25Params = (chunks) => {
  const avgLen = chunks.reduce((s, c) => s + resolveTokenCount(c), 0) / chunks.length;
  const b = avgLen > 800 ? 0.6 : 0.8;
  const k1 = avgLen > 800 ? 1.2 : 1.7;
  return { k1, b };
};

/**
 * Build postings and vector artifacts for the index.
 * @param {object} input
 * @returns {object}
 */
export async function buildPostings(input) {
  const {
    chunks,
    df,
    tokenPostings,
    tokenIdMap,
    docLengths,
    fieldPostings,
    fieldDocLengths,
    phrasePost,
    triPost,
    postingsConfig,
    postingsGuard = null,
    buildRoot = null,
    modelId,
    useStubEmbeddings,
    log,
    workerPool,
    quantizePool,
    embeddingsEnabled = true,
    buildStage = null
  } = input;

  const normalizedDocLengths = Array.isArray(docLengths)
    ? docLengths.map((len) => (Number.isFinite(len) ? len : 0))
    : [];

  const resolvedConfig = normalizePostingsConfig(postingsConfig || {});
  const minhashMaxDocsRaw = postingsConfig && typeof postingsConfig === 'object'
    ? Number(postingsConfig.minhashMaxDocs)
    : NaN;
  const minhashMaxDocs = Number.isFinite(minhashMaxDocsRaw)
    ? Math.max(0, Math.floor(minhashMaxDocsRaw))
    : 0;
  const minhashStream = !(postingsConfig && typeof postingsConfig === 'object')
    || postingsConfig.minhashStream !== false;
  const phraseSpillMaxBytesRaw = postingsConfig && typeof postingsConfig === 'object'
    ? Number(postingsConfig.phraseSpillMaxBytes)
    : NaN;
  const phraseSpillMaxBytes = Number.isFinite(phraseSpillMaxBytesRaw)
    ? Math.max(0, Math.floor(phraseSpillMaxBytesRaw))
    : 0;
  const chargramSpillMaxBytesRaw = postingsConfig && typeof postingsConfig === 'object'
    ? Number(postingsConfig.chargramSpillMaxBytes)
    : NaN;
  const chargramSpillMaxBytes = Number.isFinite(chargramSpillMaxBytesRaw)
    ? Math.max(0, Math.floor(chargramSpillMaxBytesRaw))
    : 0;
  const fieldedEnabled = resolvedConfig.fielded !== false;
  const buildEmptyFieldPostings = () => {
    if (!fieldedEnabled) return null;
    const fields = {};
    const fieldNames = new Set();
    if (fieldPostings && typeof fieldPostings === 'object') {
      Object.keys(fieldPostings).forEach((field) => fieldNames.add(field));
    }
    if (fieldDocLengths && typeof fieldDocLengths === 'object') {
      Object.keys(fieldDocLengths).forEach((field) => fieldNames.add(field));
    }
    if (!fieldNames.size) {
      ['name', 'signature', 'doc', 'comment', 'body'].forEach((field) => fieldNames.add(field));
    }
    for (const field of fieldNames) {
      const lengths = Array.isArray(fieldDocLengths?.[field])
        ? fieldDocLengths[field].map((len) => (Number.isFinite(len) ? len : 0))
        : [];
      fields[field] = {
        vocab: [],
        postings: [],
        docLengths: lengths,
        avgDocLen: 0,
        totalDocs: lengths.length
      };
    }
    return { fields };
  };

  if (!Array.isArray(chunks) || chunks.length === 0) {
    return {
      k1: 1.2,
      b: 0.75,
      avgChunkLen: 0,
      totalDocs: 0,
      fieldPostings: buildEmptyFieldPostings(),
      phraseVocab: [],
      phrasePostings: [],
      chargramVocab: [],
      chargramPostings: [],
      tokenVocab: [],
      tokenVocabIds: [],
      tokenPostingsList: [],
      avgDocLen: 0,
      minhashSigs: [],
      minhashStream: false,
      minhashGuard: null,
      dims: embeddingsEnabled ? DEFAULT_STUB_DIMS : 0,
      quantizedVectors: [],
      quantizedDocVectors: [],
      quantizedCodeVectors: []
    };
  }

  const phraseEnabled = resolvedConfig.enablePhraseNgrams !== false;
  const chargramEnabled = resolvedConfig.enableChargrams !== false;
  const chargramSpillMaxUnique = Number.isFinite(resolvedConfig.chargramSpillMaxUnique)
    ? Math.max(0, Math.floor(resolvedConfig.chargramSpillMaxUnique))
    : 0;
  const chargramMaxDf = Number.isFinite(resolvedConfig.chargramMaxDf)
    ? Math.max(0, Math.floor(resolvedConfig.chargramMaxDf))
    : 0;

  const { k1, b } = tuneBM25Params(chunks);
  const N = chunks.length;
  const avgChunkLen = chunks.reduce((sum, c) => sum + resolveTokenCount(c), 0) / Math.max(N, 1);

  const normalizeDocIdList = (value) => {
    if (value == null) return [];
    if (typeof value === 'number') return [value];
    if (Array.isArray(value)) return value;
    if (typeof value[Symbol.iterator] === 'function') return Array.from(value);
    return [];
  };
  const normalizeIdList = (value) => {
    const list = normalizeDocIdList(value).filter((entry) => Number.isFinite(entry));
    if (list.length <= 1 || isSortedIds(list)) return list;
    const sorted = Array.from(new Set(list));
    sorted.sort((a, b) => a - b);
    return sorted;
  };
  const mergeIdLists = (left, right) => {
    if (left == null) return normalizeIdList(right);
    if (right == null) return normalizeIdList(left);
    const listA = normalizeDocIdList(left);
    const listB = normalizeDocIdList(right);
    if (!listA.length) return listB;
    if (!listB.length) return listA;
    const lastA = listA[listA.length - 1];
    const firstB = listB[0];
    if (isSortedIds(listA) && isSortedIds(listB) && Number.isFinite(lastA) && Number.isFinite(firstB) && lastA <= firstB) {
      return listA.concat(listB);
    }
    const merged = listA.concat(listB);
    if (isSortedIds(merged)) return merged;
    const sorted = Array.from(new Set(merged));
    sorted.sort((a, b) => a - b);
    return sorted;
  };
  const postingsMergeStats = {
    phrase: null,
    chargram: null
  };
  const compareChargramRows = (a, b) => sortStrings(a?.token, b?.token);
  const mergeSpillRuns = async ({ runs, compare, label }) => {
    if (!runs || !runs.length) return { iterator: null, cleanup: null };
    if (!buildRoot || runs.length <= DEFAULT_MAX_OPEN_RUNS) {
      return { iterator: mergeSortedRuns(runs, { compare }), cleanup: null, stats: null, plannerUsed: false };
    }
    const mergeDir = path.join(buildRoot, `${label}.merge`);
    const mergedPath = path.join(mergeDir, `${label}.merged.jsonl`);
    const checkpointPath = path.join(mergeDir, `${label}.checkpoint.json`);
    const { cleanup, stats } = await mergeRunsWithPlanner({
      runs,
      outputPath: mergedPath,
      compare,
      tempDir: mergeDir,
      runPrefix: label,
      checkpointPath,
      maxOpenRuns: DEFAULT_MAX_OPEN_RUNS
    });
    const cleanupAll = async () => {
      if (cleanup) await cleanup();
      await fs.rm(mergedPath, { force: true });
      await fs.rm(checkpointPath, { force: true });
      await fs.rm(mergeDir, { recursive: true, force: true });
    };
    return {
      iterator: readJsonlRows(mergedPath),
      cleanup: cleanupAll,
      stats: stats || null,
      plannerUsed: true
    };
  };
  const shouldSpillByBytes = (map, maxBytes) => {
    if (!maxBytes || !map || typeof map.entries !== 'function') return false;
    let total = 0;
    for (const [token, posting] of map.entries()) {
      total += estimateJsonBytes({ token, postings: posting });
      if (total >= maxBytes) return true;
    }
    return false;
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
  const normalizeTfPostingList = (value) => {
    if (!Array.isArray(value)) return [];
    const next = [];
    for (const entry of value) {
      if (!Array.isArray(entry)) continue;
      const docId = entry[0];
      const count = entry[1];
      if (!Number.isFinite(docId) || !Number.isFinite(count)) continue;
      next.push([docId, Math.trunc(count)]);
    }
    if (next.length <= 1 || isSortedPostings(next)) return next;
    next.sort((a, b) => {
      const delta = a[0] - b[0];
      return delta || (a[1] - b[1]);
    });
    return next;
  };

  let dims = 0;
  let quantizedVectors = [];
  let quantizedDocVectors = [];
  let quantizedCodeVectors = [];
  if (embeddingsEnabled) {
    const embedLabel = useStubEmbeddings ? 'stub' : 'model';
    log(`Using ${embedLabel} embeddings for dense vectors (${modelId})...`);

    const isByteVector = (value) => (
      value
      && typeof value === 'object'
      && typeof value.length === 'number'
      && ArrayBuffer.isView(value)
      && !(value instanceof DataView)
      && value.BYTES_PER_ELEMENT === 1
      && !(typeof Buffer !== 'undefined' && Buffer.isBuffer(value))
    );

    const resolveDims = () => {
      // Prefer pre-quantized embeddings (Uint8Array) if present.
      for (const chunk of chunks) {
        const vec = chunk?.embedding_u8;
        if (isByteVector(vec) && vec.length) return vec.length;
      }
      // Fall back to float embeddings.
      for (const chunk of chunks) {
        const vec = chunk?.embedding;
        if (isVectorLike(vec) && vec.length) return vec.length;
        const code = chunk?.embed_code;
        if (isVectorLike(code) && code.length) return code.length;
        const doc = chunk?.embed_doc;
        if (isVectorLike(doc) && doc.length) return doc.length;
      }
      return DEFAULT_STUB_DIMS;
    };

    dims = resolveDims();

    // For missing vectors we intentionally use a "zero" float vector (all 0s),
    // which quantizes to ~128 in uint8 space when min=-1,max=1.
    const ZERO_QUANT = 128;
    const zeroU8 = new Uint8Array(dims);
    zeroU8.fill(ZERO_QUANT);
    const zeroVec = new Array(dims).fill(0);

    const normalizeFloatVector = (vec) => {
      if (!isVectorLike(vec)) return zeroVec;
      if (vec.length === dims) return ArrayBuffer.isView(vec) ? Array.from(vec) : vec;
      if (vec.length > dims) return Array.from(vec).slice(0, dims);
      const out = Array.from(vec);
      while (out.length < dims) out.push(0);
      return out;
    };

    const normalizeByteVector = (vec, { emptyIsZero = false } = {}) => {
      if (!isByteVector(vec)) return null;
      if (!vec.length && emptyIsZero) return zeroU8;
      if (vec.length === dims) return vec;
      const out = new Uint8Array(dims);
      if (vec.length >= dims) {
        out.set(vec.subarray(0, dims));
      } else {
        out.set(vec);
        out.fill(ZERO_QUANT, vec.length);
      }
      return out;
    };

    const hasPreQuantized = chunks.some((chunk) => {
      const v = chunk?.embedding_u8;
      return isByteVector(v) && v.length;
    });

    let docMarkerWarned = false;
    const warnMissingDocMarker = () => {
      if (docMarkerWarned) return;
      docMarkerWarned = true;
      if (typeof log === 'function') {
        log('Missing doc embedding marker for some chunks; falling back to merged embeddings.');
      }
    };

    if (hasPreQuantized) {
      // Streaming/early-quant path: chunks already carry uint8 vectors.
      // This avoids building large float arrays and avoids a second quantization pass.
      quantizedVectors = new Array(chunks.length);
      quantizedDocVectors = new Array(chunks.length);
      quantizedCodeVectors = new Array(chunks.length);

      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];

        const merged = chunk?.embedding_u8;
        const mergedVec = normalizeByteVector(merged, { emptyIsZero: true }) || zeroU8;

        // Doc vectors: an empty marker means "no doc", which should behave like
        // a zero-vector so doc-only dense search doesn't surface code-only chunks.
        const doc = chunk?.embed_doc_u8;
        let docVec;
        if (doc == null) {
          warnMissingDocMarker();
          docVec = mergedVec;
        } else {
          docVec = normalizeByteVector(doc, { emptyIsZero: true });
          if (!docVec) {
            throw new Error('[postings] invalid doc embedding marker for chunk.');
          }
        }

        // Code vectors: when missing, fall back to merged.
        const code = chunk?.embed_code_u8;
        let codeVec = normalizeByteVector(code);
        if (!codeVec) codeVec = mergedVec;

        quantizedVectors[i] = mergedVec;
        quantizedDocVectors[i] = docVec;
        quantizedCodeVectors[i] = codeVec;
      }
    } else {
      // Legacy path: quantize from float embeddings.
      const selectEmbedding = (chunk) => (
        isVectorLike(chunk?.embedding) && chunk.embedding.length
          ? normalizeFloatVector(chunk.embedding)
          : zeroVec
      );
      const selectDocEmbedding = (chunk) => {
        // `embed_doc: []` is used as an explicit marker for "no doc embedding" to
        // avoid allocating a full dims-length zero vector per chunk.
        if (Object.prototype.hasOwnProperty.call(chunk || {}, 'embed_doc')) {
          if (!isVectorLike(chunk.embed_doc)) {
            throw new Error('[postings] invalid doc embedding marker for chunk.');
          }
          return chunk.embed_doc.length ? normalizeFloatVector(chunk.embed_doc) : zeroVec;
        }
        warnMissingDocMarker();
        if (isVectorLike(chunk?.embedding) && chunk.embedding.length) {
          return normalizeFloatVector(chunk.embedding);
        }
        return zeroVec;
      };
      const selectCodeEmbedding = (chunk) => {
        if (isVectorLike(chunk?.embed_code) && chunk.embed_code.length) {
          return normalizeFloatVector(chunk.embed_code);
        }
        if (isVectorLike(chunk?.embedding) && chunk.embedding.length) {
          return normalizeFloatVector(chunk.embedding);
        }
        return zeroVec;
      };
      const quantizeWorker = quantizePool || workerPool;
      let quantizeWarned = false;
      const warnQuantizeFallback = () => {
        if (quantizeWarned) return;
        if (typeof log === 'function') {
          log('Quantize worker unavailable; falling back to inline quantization.');
        }
        quantizeWarned = true;
      };
      const quantizeVectors = async (selector) => {
        const out = new Array(chunks.length);
        if (!quantizeWorker) {
          for (let i = 0; i < chunks.length; i += 1) {
            out[i] = quantizeVec(selector(chunks[i]));
          }
          return out;
        }
        const batchSize = quantizeWorker.config?.quantizeBatchSize || 128;
        for (let i = 0; i < chunks.length; i += batchSize) {
          const end = Math.min(i + batchSize, chunks.length);
          const batch = [];
          for (let j = i; j < end; j += 1) {
            const vec = selector(chunks[j]);
            if (ArrayBuffer.isView(vec) && !(vec instanceof DataView)) {
              batch.push(vec);
            } else {
              batch.push(Float32Array.from(vec));
            }
          }
          try {
            const chunk = await quantizeWorker.runQuantize({ vectors: batch });
            if (Array.isArray(chunk) && chunk.length === batch.length) {
              for (let j = 0; j < chunk.length; j += 1) {
                out[i + j] = chunk[j];
              }
            } else {
              warnQuantizeFallback();
              for (let j = 0; j < batch.length; j += 1) {
                out[i + j] = quantizeVec(batch[j]);
              }
            }
          } catch {
            warnQuantizeFallback();
            for (let j = 0; j < batch.length; j += 1) {
              out[i + j] = quantizeVec(batch[j]);
            }
          }
        }
        return out;
      };
      quantizedVectors = await quantizeVectors(selectEmbedding);
      quantizedDocVectors = await quantizeVectors(selectDocEmbedding);
      quantizedCodeVectors = await quantizeVectors(selectCodeEmbedding);
    }
  } else {
    const stageLabel = buildStage ? ` (${buildStage})` : '';
    if (typeof log === 'function') {
      log(`Embeddings disabled${stageLabel}; skipping dense vector build.`);
    }
  }

  // Convert phrase/chargram postings into dense arrays while aggressively
  // releasing the source Sets/Maps to keep peak RSS lower.
  let phraseVocab = [];
  let phrasePostings = [];
  if (phraseEnabled && phrasePost && typeof phrasePost.keys === 'function') {
    const phraseShouldSpill = buildRoot
      && phraseSpillMaxBytes
      && shouldSpillByBytes(phrasePost, phraseSpillMaxBytes);
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
            passes: mergeResult?.stats?.passes ?? null,
            runsMerged: mergeResult?.stats?.runsMerged ?? null,
            elapsedMs: mergeResult?.stats?.elapsedMs ?? null
          };
          for await (const row of iterator) {
            const token = row?.token;
            if (!token) continue;
            postingsMergeStats.phrase.rows += 1;
            if (currentToken === null) {
              currentToken = token;
              currentPosting = row.postings;
              continue;
            }
            if (token !== currentToken) {
              const normalized = normalizeIdList(currentPosting);
              if (normalized.length) {
                vocab.push(currentToken);
                postingsList.push(normalized);
              }
              currentToken = token;
              currentPosting = row.postings;
              continue;
            }
            currentPosting = mergeIdLists(currentPosting, row.postings);
          }
        } else {
          for (const row of iterator) {
            const token = row?.token;
            if (!token) continue;
            if (currentToken === null) {
              currentToken = token;
              currentPosting = row.postings;
              continue;
            }
            if (token !== currentToken) {
              const normalized = normalizeIdList(currentPosting);
              if (normalized.length) {
                vocab.push(currentToken);
                postingsList.push(normalized);
              }
              currentToken = token;
              currentPosting = row.postings;
              continue;
            }
            currentPosting = mergeIdLists(currentPosting, row.postings);
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
      const entries = Array.from(phrasePost.entries()).sort((a, b) => sortStrings(a[0], b[0]));
      phraseVocab = new Array(entries.length);
      phrasePostings = new Array(entries.length);
      for (let i = 0; i < entries.length; i += 1) {
        const [key, posting] = entries[i];
        phraseVocab[i] = key;
        phrasePostings[i] = normalizeIdList(posting);
        phrasePost.delete(key);
      }
      if (typeof phrasePost.clear === 'function') phrasePost.clear();
    }
  }

  let chargramVocab = [];
  let chargramPostings = [];
  let chargramStats = null;
  const triPostSize = triPost?.size || 0;
  if (chargramEnabled && triPost && typeof triPost.keys === 'function') {
    const spillByBytes = buildRoot
      && chargramSpillMaxBytes
      && shouldSpillByBytes(triPost, chargramSpillMaxBytes);
    const shouldSpill = buildRoot
      && ((chargramSpillMaxUnique && triPost.size >= chargramSpillMaxUnique) || spillByBytes);
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
            passes: mergeResult?.stats?.passes ?? null,
            runsMerged: mergeResult?.stats?.runsMerged ?? null,
            elapsedMs: mergeResult?.stats?.elapsedMs ?? null
          };
          for await (const row of iterator) {
            const token = row?.token;
            if (!token) continue;
            postingsMergeStats.chargram.rows += 1;
            if (currentToken === null) {
              currentToken = token;
              currentPosting = row.postings;
              continue;
            }
            if (token !== currentToken) {
              const normalized = normalizeChargramPosting(currentPosting);
              if (normalized) {
                vocab.push(currentToken);
                postingsList.push(normalized);
              }
              currentToken = token;
              currentPosting = row.postings;
              continue;
            }
            currentPosting = mergeIdLists(currentPosting, row.postings);
          }
        } else {
          for (const row of iterator) {
            const token = row?.token;
            if (!token) continue;
            if (currentToken === null) {
              currentToken = token;
              currentPosting = row.postings;
              continue;
            }
            if (token !== currentToken) {
              const normalized = normalizeChargramPosting(currentPosting);
              if (normalized) {
                vocab.push(currentToken);
                postingsList.push(normalized);
              }
              currentToken = token;
              currentPosting = row.postings;
              continue;
            }
            currentPosting = mergeIdLists(currentPosting, row.postings);
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
      const entries = Array.from(triPost.entries()).sort((a, b) => sortStrings(a[0], b[0]));
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
      }
      if (typeof triPost.clear === 'function') triPost.clear();
    }
  }

  let includeTokenIds = tokenIdMap && tokenIdMap.size > 0;
  const tokenEntries = Array.from(tokenPostings.keys()).map((id) => {
    const mapped = tokenIdMap?.get(id);
    if (!mapped) includeTokenIds = false;
    const token = mapped ?? (typeof id === 'string' ? id : String(id));
    return { id, token };
  });
  tokenEntries.sort((a, b) => sortStrings(a.token, b.token));
  const tokenVocab = new Array(tokenEntries.length);
  const tokenVocabIds = includeTokenIds ? new Array(tokenEntries.length) : null;
  const tokenPostingsList = new Array(tokenEntries.length);
  for (let i = 0; i < tokenEntries.length; i += 1) {
    const entry = tokenEntries[i];
    tokenVocab[i] = entry.token;
    if (tokenVocabIds) tokenVocabIds[i] = entry.id;
    tokenPostingsList[i] = normalizeTfPostingList(tokenPostings.get(entry.id));
    tokenPostings.delete(entry.id);
  }
  if (typeof tokenPostings.clear === 'function') tokenPostings.clear();
  const avgDocLen = normalizedDocLengths.length
    ? normalizedDocLengths.reduce((sum, len) => sum + len, 0) / normalizedDocLengths.length
    : 0;

  const allowMinhash = !minhashMaxDocs || chunks.length <= minhashMaxDocs;
  const minhashSigs = allowMinhash && !minhashStream ? chunks.map((c) => c.minhashSig) : [];
  const minhashGuard = (!allowMinhash && minhashMaxDocs)
    ? { skipped: true, maxDocs: minhashMaxDocs, totalDocs: chunks.length }
    : null;
  if (!allowMinhash && typeof log === 'function') {
    log(`[postings] minhash skipped: ${chunks.length} docs exceeds max ${minhashMaxDocs}.`);
  }

  const buildFieldPostings = () => {
    if (!fieldPostings || !fieldDocLengths) return null;
    const fields = {};
    const fieldEntries = Object.entries(fieldPostings).sort((a, b) => sortStrings(a[0], b[0]));
    for (const [field, postingsMap] of fieldEntries) {
      if (!postingsMap || typeof postingsMap.keys !== 'function') continue;
      const vocab = Array.from(postingsMap.keys()).sort(sortStrings);
      const postings = new Array(vocab.length);
      for (let i = 0; i < vocab.length; i += 1) {
        const token = vocab[i];
        postings[i] = normalizeTfPostingList(postingsMap.get(token));
        postingsMap.delete(token);
      }
      if (typeof postingsMap.clear === 'function') postingsMap.clear();
      const lengthsRaw = fieldDocLengths[field] || [];
      const lengths = Array.isArray(lengthsRaw)
        ? lengthsRaw.map((len) => (Number.isFinite(len) ? len : 0))
        : [];
      const avgLen = lengths.length
        ? lengths.reduce((sum, len) => sum + len, 0) / lengths.length
        : 0;
      fields[field] = {
        vocab,
        postings,
        docLengths: lengths,
        avgDocLen: avgLen,
        totalDocs: lengths.length
      };
    }
    return Object.keys(fields).length ? { fields } : null;
  };

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
    k1,
    b,
    avgChunkLen,
    totalDocs: N,
    fieldPostings: buildFieldPostings(),
    phraseVocab,
    phrasePostings,
    chargramVocab,
    chargramPostings,
    chargramStats,
    tokenVocab,
    tokenVocabIds,
    tokenPostingsList,
    avgDocLen,
    minhashSigs,
    minhashStream: allowMinhash && minhashStream,
    minhashGuard,
    dims,
    quantizedVectors,
    quantizedDocVectors,
    quantizedCodeVectors,
    postingsMergeStats
  };
}
