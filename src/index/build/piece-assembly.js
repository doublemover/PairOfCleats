import fsSync from 'node:fs';
import path from 'node:path';
import {
  loadChunkMeta,
  loadJsonArrayArtifact,
  loadTokenPostings,
  readJsonFile
} from '../../shared/artifact-io.js';
import { buildFilterIndex, serializeFilterIndex } from '../../retrieval/filter-index.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { log as defaultLog } from '../../shared/progress.js';
import { createIndexState } from './state.js';
import { writeIndexArtifacts } from './artifacts.js';

const STAGE_ORDER = {
  stage1: 1,
  stage2: 2,
  stage3: 3,
  stage4: 4
};

const normalizeStage = (raw) => {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value) return null;
  if (value === '1' || value === 'stage1' || value === 'sparse') return 'stage1';
  if (value === '2' || value === 'stage2' || value === 'enrich' || value === 'full') return 'stage2';
  if (value === '3' || value === 'stage3' || value === 'embeddings' || value === 'embed') return 'stage3';
  if (value === '4' || value === 'stage4' || value === 'sqlite' || value === 'ann') return 'stage4';
  return null;
};

const readJsonOptional = (dir, name) => {
  const filePath = path.join(dir, name);
  try {
    return readJsonFile(filePath);
  } catch (err) {
    if (err?.code === 'ERR_JSON_TOO_LARGE') throw err;
    return null;
  }
};

const readArray = (value, key) => {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value[key])) return value[key];
  if (value.arrays && Array.isArray(value.arrays[key])) return value.arrays[key];
  return [];
};

const readField = (value, key) => {
  if (!value || typeof value !== 'object') return null;
  if (value.fields && Object.prototype.hasOwnProperty.call(value.fields, key)) {
    return value.fields[key];
  }
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  return null;
};

const loadIndexArtifacts = async (dir) => {
  if (!fsSync.existsSync(dir)) {
    throw new Error(`Missing input index directory: ${dir}`);
  }
  const chunkMeta = await loadChunkMeta(dir);
  const fileMeta = readJsonOptional(dir, 'file_meta.json');
  const fileMetaById = new Map();
  if (Array.isArray(fileMeta)) {
    for (const entry of fileMeta) {
      if (entry && entry.id != null) fileMetaById.set(entry.id, entry);
    }
  }
  for (const chunk of chunkMeta) {
    if (!chunk || (chunk.file && chunk.ext)) continue;
    const meta = fileMetaById.get(chunk.fileId);
    if (!meta) continue;
    if (!chunk.file) chunk.file = meta.file;
    if (!chunk.ext) chunk.ext = meta.ext;
    if (!chunk.externalDocs) chunk.externalDocs = meta.externalDocs;
    if (!chunk.last_modified) chunk.last_modified = meta.last_modified;
    if (!chunk.last_author) chunk.last_author = meta.last_author;
    if (!chunk.churn) chunk.churn = meta.churn;
    if (!chunk.churn_added) chunk.churn_added = meta.churn_added;
    if (!chunk.churn_deleted) chunk.churn_deleted = meta.churn_deleted;
    if (!chunk.churn_commits) chunk.churn_commits = meta.churn_commits;
  }
  const missingFile = chunkMeta.some((chunk) => chunk && !chunk.file);
  if (missingFile) {
    throw new Error(`file_meta.json required for chunk metadata in ${dir}`);
  }
  const tokenPostings = loadTokenPostings(dir);
  return {
    dir,
    chunkMeta,
    tokenPostings,
    fieldPostings: readJsonOptional(dir, 'field_postings.json'),
    fieldTokens: readJsonOptional(dir, 'field_tokens.json'),
    minhash: readJsonOptional(dir, 'minhash_signatures.json'),
    phraseNgrams: readJsonOptional(dir, 'phrase_ngrams.json'),
    chargrams: readJsonOptional(dir, 'chargram_postings.json'),
    denseVec: readJsonOptional(dir, 'dense_vectors_uint8.json'),
    denseVecDoc: readJsonOptional(dir, 'dense_vectors_doc_uint8.json'),
    denseVecCode: readJsonOptional(dir, 'dense_vectors_code_uint8.json'),
    fileRelations: await loadJsonArrayArtifact(dir, 'file_relations').catch(() => null),
    indexState: readJsonOptional(dir, 'index_state.json')
  };
};

const mergeTfPostings = (map, token, postings, docOffset) => {
  if (!Array.isArray(postings)) return;
  let dest = map.get(token);
  if (!dest) {
    if (docOffset) {
      for (const entry of postings) {
        if (!Array.isArray(entry)) continue;
        const docId = entry[0];
        if (!Number.isFinite(docId)) continue;
        entry[0] = docId + docOffset;
      }
    }
    map.set(token, postings);
    return;
  }
  for (const entry of postings) {
    if (!Array.isArray(entry)) continue;
    const docId = entry[0];
    if (!Number.isFinite(docId)) continue;
    if (docOffset) {
      entry[0] = docId + docOffset;
    }
    dest.push(entry);
  }
};

const mergeIdPostings = (map, token, postings, docOffset) => {
  if (!Array.isArray(postings)) return;
  let dest = map.get(token);
  if (!dest) {
    if (docOffset) {
      for (let i = 0; i < postings.length; i += 1) {
        const docId = postings[i];
        if (!Number.isFinite(docId)) continue;
        postings[i] = docId + docOffset;
      }
    }
    map.set(token, postings);
    return;
  }
  if (!docOffset) {
    for (const docId of postings) {
      if (!Number.isFinite(docId)) continue;
      dest.push(docId);
    }
    return;
  }
  for (const docId of postings) {
    if (!Number.isFinite(docId)) continue;
    dest.push(docId + docOffset);
  }
};

const computeBm25 = (docLengths) => {
  if (!Array.isArray(docLengths) || docLengths.length === 0) {
    return { avgChunkLen: 0, k1: 1.2, b: 0.75 };
  }
  const total = docLengths.reduce((sum, len) => sum + (Number.isFinite(len) ? len : 0), 0);
  const avgChunkLen = total / docLengths.length;
  const b = avgChunkLen > 800 ? 0.6 : 0.8;
  const k1 = avgChunkLen > 800 ? 1.2 : 1.7;
  return { avgChunkLen, k1, b };
};

const validateLengths = (label, list, expected) => {
  if (!Array.isArray(list)) return;
  if (list.length !== expected) {
    throw new Error(`${label} length mismatch (${list.length} !== ${expected})`);
  }
};

export async function assembleIndexPieces({
  inputs,
  outDir,
  root,
  mode,
  userConfig,
  stage = null,
  log = defaultLog
}) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error('assembleIndexPieces requires input index directories.');
  }
  const assembledStage = normalizeStage(stage);
  const state = createIndexState();
  const mergedTokenPostings = new Map();
  const mergedFieldPostings = {
    name: new Map(),
    signature: new Map(),
    doc: new Map(),
    comment: new Map(),
    body: new Map()
  };
  const mergedFieldDocLengths = {
    name: [],
    signature: [],
    doc: [],
    comment: [],
    body: []
  };
  const mergedPhrasePostings = new Map();
  const mergedChargramPostings = new Map();
  const mergedMinhash = [];
  const mergedDense = [];
  const mergedDenseDoc = [];
  const mergedDenseCode = [];
  let denseModel = null;
  let denseDims = 0;
  let denseScale = null;
  let embeddingsSeen = false;
  let fieldTokensSeen = false;
  const stageInputs = [];

  for (const dir of inputs) {
    const input = await loadIndexArtifacts(dir);
    const chunks = Array.isArray(input.chunkMeta) ? input.chunkMeta : [];
    const docLengths = Array.isArray(input.tokenPostings?.docLengths)
      ? input.tokenPostings.docLengths
      : [];
    validateLengths('docLengths', docLengths, chunks.length);
    const docOffset = state.chunks.length;
    stageInputs.push({ indexState: input.indexState, chunkCount: chunks.length });
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = { ...chunks[i] };
      chunk.id = docOffset + i;
      if (chunk.fileId != null) delete chunk.fileId;
      state.chunks.push(chunk);
    }
    state.docLengths.push(...docLengths);
    for (const len of docLengths) {
      if (Number.isFinite(len)) state.totalTokens += len;
    }

    const vocab = Array.isArray(input.tokenPostings?.vocab) ? input.tokenPostings.vocab : [];
    const postings = Array.isArray(input.tokenPostings?.postings) ? input.tokenPostings.postings : [];
    for (let i = 0; i < vocab.length; i += 1) {
      mergeTfPostings(mergedTokenPostings, vocab[i], postings[i], docOffset);
    }

    const fieldPostings = input.fieldPostings?.fields;
    if (fieldPostings && typeof fieldPostings === 'object') {
      for (const [field, entry] of Object.entries(fieldPostings)) {
        const fieldVocab = Array.isArray(entry?.vocab) ? entry.vocab : [];
        const fieldPosting = Array.isArray(entry?.postings) ? entry.postings : [];
        const fieldDocLengths = Array.isArray(entry?.docLengths) ? entry.docLengths : [];
        validateLengths(`fieldDocLengths:${field}`, fieldDocLengths, chunks.length);
        if (mergedFieldDocLengths[field]) {
          mergedFieldDocLengths[field].push(...fieldDocLengths);
        }
        const destMap = mergedFieldPostings[field] || null;
        if (!destMap) continue;
        for (let i = 0; i < fieldVocab.length; i += 1) {
          mergeTfPostings(destMap, fieldVocab[i], fieldPosting[i], docOffset);
        }
      }
    }

    const fieldTokens = Array.isArray(input.fieldTokens) ? input.fieldTokens : null;
    if (fieldTokens && fieldTokens.length) {
      fieldTokensSeen = true;
      for (let i = 0; i < chunks.length; i += 1) {
        state.fieldTokens[docOffset + i] = fieldTokens[i] || null;
      }
    } else if (fieldTokensSeen) {
      for (let i = 0; i < chunks.length; i += 1) {
        state.fieldTokens[docOffset + i] = null;
      }
    }

    const minhash = readArray(input.minhash, 'signatures');
    if (minhash.length) {
      validateLengths('minhash', minhash, chunks.length);
      mergedMinhash.push(...minhash);
    }

    const phraseVocab = readArray(input.phraseNgrams, 'vocab');
    const phrasePosting = readArray(input.phraseNgrams, 'postings');
    for (let i = 0; i < phraseVocab.length; i += 1) {
      mergeIdPostings(mergedPhrasePostings, phraseVocab[i], phrasePosting[i], docOffset);
    }

    const chargramVocab = readArray(input.chargrams, 'vocab');
    const chargramPosting = readArray(input.chargrams, 'postings');
    for (let i = 0; i < chargramVocab.length; i += 1) {
      mergeIdPostings(mergedChargramPostings, chargramVocab[i], chargramPosting[i], docOffset);
    }

    const denseVec = readArray(input.denseVec, 'vectors');
    const denseVecDoc = readArray(input.denseVecDoc, 'vectors');
    const denseVecCode = readArray(input.denseVecCode, 'vectors');
    const inputDims = Number(readField(input.denseVec, 'dims')) || 0;
    const inputModel = readField(input.denseVec, 'model');
    const inputScale = readField(input.denseVec, 'scale');
    if (denseVec.length) {
      embeddingsSeen = true;
      if (denseDims && inputDims && denseDims !== inputDims) {
        throw new Error(`Embedding dims mismatch (${denseDims} !== ${inputDims})`);
      }
      if (denseModel && inputModel && denseModel !== inputModel) {
        throw new Error(`Embedding model mismatch (${denseModel} !== ${inputModel})`);
      }
      if (denseScale && inputScale && denseScale !== inputScale) {
        throw new Error(`Embedding scale mismatch (${denseScale} !== ${inputScale})`);
      }
      denseDims = denseDims || inputDims;
      denseModel = denseModel || inputModel || null;
      denseScale = denseScale || inputScale || null;
      validateLengths('dense vectors', denseVec, chunks.length);
      mergedDense.push(...denseVec);
      if (denseVecDoc.length) {
        validateLengths('dense doc vectors', denseVecDoc, chunks.length);
        mergedDenseDoc.push(...denseVecDoc);
      }
      if (denseVecCode.length) {
        validateLengths('dense code vectors', denseVecCode, chunks.length);
        mergedDenseCode.push(...denseVecCode);
      }
    }

    if (Array.isArray(input.fileRelations)) {
      if (!state.fileRelations) state.fileRelations = new Map();
      for (const entry of input.fileRelations) {
        if (!entry?.file) continue;
        state.fileRelations.set(entry.file, entry.relations || null);
      }
    }
  }

  if (!state.chunks.length) {
    throw new Error('assembleIndexPieces found no chunks to merge.');
  }

  if (embeddingsSeen) {
    validateLengths('merged dense vectors', mergedDense, state.chunks.length);
    if (mergedDenseDoc.length) {
      validateLengths('merged dense doc vectors', mergedDenseDoc, state.chunks.length);
    }
    if (mergedDenseCode.length) {
      validateLengths('merged dense code vectors', mergedDenseCode, state.chunks.length);
    }
  }
  if (mergedMinhash.length) {
    validateLengths('merged minhash', mergedMinhash, state.chunks.length);
  }

  const sortKey = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));
  const tokenVocab = Array.from(mergedTokenPostings.keys()).sort(sortKey);
  const tokenPostingsList = tokenVocab.map((token) => mergedTokenPostings.get(token));
  const phraseVocab = Array.from(mergedPhrasePostings.keys()).sort(sortKey);
  const phrasePostings = phraseVocab.map((token) => mergedPhrasePostings.get(token));
  const chargramVocab = Array.from(mergedChargramPostings.keys()).sort(sortKey);
  const chargramPostings = chargramVocab.map((token) => mergedChargramPostings.get(token));
  const fieldPostings = {};
  const fieldNames = Object.keys(mergedFieldPostings).sort(sortKey);
  for (const field of fieldNames) {
    const map = mergedFieldPostings[field];
    const vocab = Array.from(map.keys()).sort(sortKey);
    if (!vocab.length) continue;
    const postings = vocab.map((token) => map.get(token));
    const lengths = mergedFieldDocLengths[field] || [];
    const avgLen = lengths.length
      ? lengths.reduce((sum, len) => sum + (Number.isFinite(len) ? len : 0), 0) / lengths.length
      : 0;
    fieldPostings[field] = {
      vocab,
      postings,
      docLengths: lengths,
      avgDocLen: avgLen,
      totalDocs: lengths.length
    };
  }

  const { avgChunkLen, k1, b } = computeBm25(state.docLengths);
  const avgDocLen = state.docLengths.length
    ? state.docLengths.reduce((sum, len) => sum + (Number.isFinite(len) ? len : 0), 0) / state.docLengths.length
    : 0;
  const postings = {
    k1,
    b,
    avgChunkLen,
    totalDocs: state.chunks.length,
    fieldPostings: Object.keys(fieldPostings).length ? { fields: fieldPostings } : null,
    phraseVocab,
    phrasePostings,
    chargramVocab,
    chargramPostings,
    tokenVocab,
    tokenPostingsList,
    avgDocLen,
    minhashSigs: mergedMinhash,
    dims: embeddingsSeen ? denseDims : 0,
    quantizedVectors: embeddingsSeen ? mergedDense : [],
    quantizedDocVectors: embeddingsSeen ? (mergedDenseDoc.length ? mergedDenseDoc : mergedDense) : [],
    quantizedCodeVectors: embeddingsSeen ? (mergedDenseCode.length ? mergedDenseCode : mergedDense) : []
  };

  const uniqueFiles = new Set();
  for (const chunk of state.chunks) {
    if (chunk?.file) uniqueFiles.add(chunk.file);
  }
  const timing = { start: Date.now() };
  const filterIndex = serializeFilterIndex(buildFilterIndex(state.chunks, {
    includeBitmaps: false
  }));
  state.fileRelations = state.fileRelations || new Map();
  state.scannedFilesTimes = [];
  state.scannedFiles = [];
  state.skippedFiles = [];
  state.fieldDocLengths = mergedFieldDocLengths;

  const pickIndexState = () => {
    if (!stageInputs.length) return {};
    let best = stageInputs[0]?.indexState?.fields || stageInputs[0]?.indexState || {};
    let bestScore = 0;
    for (const entry of stageInputs) {
      const candidate = entry?.indexState?.fields || entry?.indexState || {};
      const candidateStage = normalizeStage(candidate.stage);
      const score = candidateStage ? (STAGE_ORDER[candidateStage] || 0) : 0;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best && typeof best === 'object' ? best : {};
  };

  const baseIndexState = pickIndexState();
  const resolvedStage = assembledStage || normalizeStage(baseIndexState.stage);
  const assembledIndexState = {
    ...baseIndexState,
    generatedAt: new Date().toISOString(),
    mode,
    stage: resolvedStage || baseIndexState.stage || null,
    assembled: true
  };
  if (filterIndex) {
    assembledIndexState.filterIndex = { ready: true };
  }

  const postingsConfig = normalizePostingsConfig(userConfig?.indexing?.postings || {});
  await writeIndexArtifacts({
    outDir,
    mode,
    state,
    postings,
    postingsConfig,
    modelId: denseModel || userConfig?.indexing?.model || null,
    useStubEmbeddings: false,
    dictSummary: null,
    timing,
    root,
    userConfig,
    incrementalEnabled: false,
    fileCounts: { candidates: uniqueFiles.size },
    indexState: assembledIndexState
  });

  log(`Assembled index from ${inputs.length} piece set(s) into ${outDir}.`);
}
