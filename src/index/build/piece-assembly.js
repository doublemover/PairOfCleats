import fsSync from 'node:fs';
import path from 'node:path';
import {
  loadChunkMeta,
  loadJsonArrayArtifact,
  loadPiecesManifest,
  loadTokenPostings,
  readCompatibilityKey,
  readJsonFile
} from '../../shared/artifact-io.js';
import { applyCrossFileInference } from '../type-inference-crossfile.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { log as defaultLog } from '../../shared/progress.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { createIndexState } from './state.js';
import { buildRelationGraphs } from './graphs.js';
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

const loadIndexArtifacts = async (dir, { strict = true } = {}) => {
  if (!fsSync.existsSync(dir)) {
    throw new Error(`Missing input index directory: ${dir}`);
  }
  const manifest = loadPiecesManifest(dir, { strict });
  const chunkMeta = await loadChunkMeta(dir, { manifest, strict });
  const fileMeta = await loadJsonArrayArtifact(dir, 'file_meta', { manifest, strict }).catch(() => null);
  const fileMetaById = new Map();
  const fileInfoByPath = new Map();
  if (Array.isArray(fileMeta)) {
    for (const entry of fileMeta) {
      if (entry && entry.id != null) fileMetaById.set(entry.id, entry);
      if (entry?.file) {
        const size = Number.isFinite(entry.size) ? entry.size : null;
        const hash = entry.hash || null;
        const hashAlgo = entry.hash_algo || entry.hashAlgo || null;
        const encoding = entry.encoding || null;
        const encodingFallback = typeof entry.encodingFallback === 'boolean' ? entry.encodingFallback : null;
        const encodingConfidence = Number.isFinite(entry.encodingConfidence)
          ? entry.encodingConfidence
          : null;
        if (size !== null || hash || hashAlgo || encoding || encodingFallback !== null || encodingConfidence !== null) {
          fileInfoByPath.set(entry.file, {
            size,
            hash,
            hashAlgo,
            encoding,
            encodingFallback,
            encodingConfidence
          });
        }
      }
    }
  }
  for (const chunk of chunkMeta) {
    if (!chunk || (chunk.file && chunk.ext)) continue;
    const meta = fileMetaById.get(chunk.fileId);
    if (!meta) continue;
    if (!chunk.file) chunk.file = meta.file;
    if (!chunk.ext) chunk.ext = meta.ext;
    if (!chunk.fileSize && Number.isFinite(meta.size)) chunk.fileSize = meta.size;
    if (!chunk.fileHash && meta.hash) chunk.fileHash = meta.hash;
    const metaHashAlgo = meta.hashAlgo || meta.hash_algo;
    if (!chunk.fileHashAlgo && metaHashAlgo) chunk.fileHashAlgo = metaHashAlgo;
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
  const tokenPostings = loadTokenPostings(dir, { manifest, strict });
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
    fileRelations: await loadJsonArrayArtifact(dir, 'file_relations', { manifest, strict }).catch(() => null),
    indexState: readJsonOptional(dir, 'index_state.json'),
    fileInfoByPath
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

const validateLengths = (label, list, expected, dir, { allowMissing = false } = {}) => {
  const location = dir ? ` in ${dir}` : '';
  if (!Array.isArray(list)) {
    if (!allowMissing && expected > 0) {
      throw new Error(`${label} missing (${expected} expected)${location}`);
    }
    return;
  }
  if (expected > 0 && list.length === 0) {
    throw new Error(`${label} empty (${expected} expected)${location}`);
  }
  if (list.length !== expected) {
    throw new Error(`${label} length mismatch (${list.length} !== ${expected})${location}`);
  }
};

const normalizeIdList = (list) => {
  if (!Array.isArray(list)) return [];
  const filtered = list.filter((value) => Number.isFinite(value));
  if (filtered.length <= 1) return filtered;
  filtered.sort((a, b) => a - b);
  const deduped = [];
  let last = null;
  for (const value of filtered) {
    if (value !== last) deduped.push(value);
    last = value;
  }
  return deduped;
};

const normalizeTfPostings = (list) => {
  if (!Array.isArray(list)) return [];
  if (list.length <= 1) return list;
  const filtered = list.reduce((acc, entry) => {
    if (!Array.isArray(entry)) return acc;
    const docId = entry[0];
    const count = entry[1];
    if (!Number.isFinite(docId) || !Number.isFinite(count)) return acc;
    acc.push([docId, Math.trunc(count)]);
    return acc;
  }, []);
  filtered.sort((a, b) => {
    const delta = a[0] - b[0];
    return delta || (a[1] - b[1]);
  });
  return filtered;
};

const buildChunkOrdering = (chunks) => {
  const entries = chunks.map((chunk, index) => {
    const startRaw = Number(chunk?.start);
    const endRaw = Number(chunk?.end);
    return {
      chunk,
      oldId: index,
      file: typeof chunk?.file === 'string' ? chunk.file : '',
      start: Number.isFinite(startRaw) ? startRaw : 0,
      end: Number.isFinite(endRaw) ? endRaw : 0
    };
  });
  entries.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return a.end - b.end;
    return a.oldId - b.oldId;
  });
  return entries;
};

const remapTfPostings = (map, docMap) => {
  for (const [token, list] of map.entries()) {
    if (!Array.isArray(list)) continue;
    const remapped = list.map((entry) => {
      if (!Array.isArray(entry)) return entry;
      const docId = entry[0];
      const nextId = Number.isFinite(docId) ? docMap[docId] : null;
      if (!Number.isFinite(nextId)) return entry;
      const nextEntry = entry.slice();
      nextEntry[0] = nextId;
      return nextEntry;
    });
    map.set(token, remapped);
  }
};

const remapIdPostings = (map, docMap) => {
  for (const [token, list] of map.entries()) {
    if (!Array.isArray(list)) continue;
    const remapped = list
      .map((docId) => (Number.isFinite(docId) ? docMap[docId] : null))
      .filter((docId) => Number.isFinite(docId));
    map.set(token, remapped);
  }
};

export async function assembleIndexPieces({
  inputs,
  outDir,
  root,
  mode,
  userConfig,
  stage = null,
  log = defaultLog,
  strict = true
}) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error('assembleIndexPieces requires input index directories.');
  }
  const assembledStage = normalizeStage(stage);
  const state = createIndexState();
  const mergedTokenPostings = new Map();
  const mergedFieldPostings = new Map();
  const mergedFieldDocLengths = new Map();
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

  const sortedInputs = inputs
    .map((dir) => path.resolve(dir))
    .sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
  const compatibilityKeys = new Map();
  for (const dir of sortedInputs) {
    const result = readCompatibilityKey(dir, { strict });
    if (result?.key) {
      compatibilityKeys.set(dir, result.key);
    }
  }
  const uniqueCompatibilityKeys = new Set(compatibilityKeys.values());
  if (uniqueCompatibilityKeys.size > 1) {
    const details = Array.from(compatibilityKeys.entries())
      .map(([dir, key]) => `- ${dir}: ${key}`)
      .join('\n');
    throw new Error(`assemble-pieces compatibilityKey mismatch:\n${details}`);
  }
  const compatibilityKey = uniqueCompatibilityKeys.size === 1
    ? Array.from(uniqueCompatibilityKeys)[0]
    : null;
  for (const dir of sortedInputs) {
    const input = await loadIndexArtifacts(dir, { strict });
    const chunks = Array.isArray(input.chunkMeta) ? input.chunkMeta : [];
    const docLengths = Array.isArray(input.tokenPostings?.docLengths)
      ? input.tokenPostings.docLengths
      : [];
    validateLengths('docLengths', docLengths, chunks.length, dir);
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

    const rawFieldPostings = input.fieldPostings;
    const fieldPostings = rawFieldPostings?.fields && typeof rawFieldPostings.fields === 'object'
      ? rawFieldPostings.fields
      : (rawFieldPostings && typeof rawFieldPostings === 'object' ? rawFieldPostings : null);
    if (fieldPostings && typeof fieldPostings === 'object') {
      for (const [field, entry] of Object.entries(fieldPostings)) {
        const fieldVocab = Array.isArray(entry?.vocab) ? entry.vocab : [];
        const fieldPosting = Array.isArray(entry?.postings) ? entry.postings : [];
        const fieldDocLengths = Array.isArray(entry?.docLengths) ? entry.docLengths : [];
        validateLengths(`fieldDocLengths:${field}`, fieldDocLengths, chunks.length, dir);
        const lengths = mergedFieldDocLengths.get(field) || [];
        lengths.push(...fieldDocLengths);
        mergedFieldDocLengths.set(field, lengths);
        const destMap = mergedFieldPostings.get(field) || new Map();
        for (let i = 0; i < fieldVocab.length; i += 1) {
          mergeTfPostings(destMap, fieldVocab[i], fieldPosting[i], docOffset);
        }
        mergedFieldPostings.set(field, destMap);
      }
    }

    const fieldTokens = Array.isArray(input.fieldTokens) ? input.fieldTokens : null;
    if (input.fieldTokens) {
      validateLengths('fieldTokens', fieldTokens, chunks.length, dir);
    }
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
    if (input.minhash) {
      validateLengths('minhash', minhash, chunks.length, dir, { allowMissing: false });
      if (minhash.length) mergedMinhash.push(...minhash);
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
    if (input.denseVec) {
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
      validateLengths('dense vectors', denseVec, chunks.length, dir);
      if (denseVec.length) mergedDense.push(...denseVec);
      if (input.denseVecDoc) {
        validateLengths('dense doc vectors', denseVecDoc, chunks.length, dir);
        if (denseVecDoc.length) mergedDenseDoc.push(...denseVecDoc);
      }
      if (input.denseVecCode) {
        validateLengths('dense code vectors', denseVecCode, chunks.length, dir);
        if (denseVecCode.length) mergedDenseCode.push(...denseVecCode);
      }
    }

    if (Array.isArray(input.fileRelations)) {
      if (!state.fileRelations) state.fileRelations = new Map();
      for (const entry of input.fileRelations) {
        if (!entry?.file) continue;
        state.fileRelations.set(entry.file, entry.relations || null);
      }
    }
    if (input.fileInfoByPath && typeof input.fileInfoByPath.entries === 'function') {
      if (!state.fileInfoByPath) state.fileInfoByPath = new Map();
      for (const [file, info] of input.fileInfoByPath.entries()) {
        if (!state.fileInfoByPath.has(file)) {
          state.fileInfoByPath.set(file, info);
        }
      }
    }
  }

  if (!state.chunks.length) {
    throw new Error('assembleIndexPieces found no chunks to merge.');
  }

  const ordering = inputs.length === 1
    ? state.chunks.map((chunk, index) => ({ chunk, oldId: index }))
    : buildChunkOrdering(state.chunks);
  const needsRemap = ordering.some((entry, index) => entry.oldId !== index);
  if (needsRemap) {
    const docMap = new Array(ordering.length);
    const newChunks = new Array(ordering.length);
    const newDocLengths = new Array(ordering.length);
    const newFieldTokens = fieldTokensSeen ? new Array(ordering.length) : null;
    const newMinhash = mergedMinhash.length ? new Array(ordering.length) : null;
    const newDense = mergedDense.length ? new Array(ordering.length) : null;
    const newDenseDoc = mergedDenseDoc.length ? new Array(ordering.length) : null;
    const newDenseCode = mergedDenseCode.length ? new Array(ordering.length) : null;

    for (let newId = 0; newId < ordering.length; newId += 1) {
      const { chunk, oldId } = ordering[newId];
      docMap[oldId] = newId;
      newChunks[newId] = { ...chunk, id: newId };
      newDocLengths[newId] = state.docLengths[oldId] ?? 0;
      if (newFieldTokens) newFieldTokens[newId] = state.fieldTokens[oldId] ?? null;
      if (newMinhash) newMinhash[newId] = mergedMinhash[oldId];
      if (newDense) newDense[newId] = mergedDense[oldId];
      if (newDenseDoc) newDenseDoc[newId] = mergedDenseDoc[oldId];
      if (newDenseCode) newDenseCode[newId] = mergedDenseCode[oldId];
    }

    state.chunks = newChunks;
    state.docLengths = newDocLengths;
    if (newFieldTokens) state.fieldTokens = newFieldTokens;
    if (newMinhash) mergedMinhash.splice(0, mergedMinhash.length, ...newMinhash);
    if (newDense) mergedDense.splice(0, mergedDense.length, ...newDense);
    if (newDenseDoc) mergedDenseDoc.splice(0, mergedDenseDoc.length, ...newDenseDoc);
    if (newDenseCode) mergedDenseCode.splice(0, mergedDenseCode.length, ...newDenseCode);

    for (const [field, lengths] of mergedFieldDocLengths.entries()) {
      if (!Array.isArray(lengths) || lengths.length !== ordering.length) continue;
      const next = new Array(ordering.length);
      for (let newId = 0; newId < ordering.length; newId += 1) {
        const oldId = ordering[newId].oldId;
        next[newId] = lengths[oldId];
      }
      mergedFieldDocLengths.set(field, next);
    }

    remapTfPostings(mergedTokenPostings, docMap);
    for (const map of mergedFieldPostings.values()) {
      remapTfPostings(map, docMap);
    }
    remapIdPostings(mergedPhrasePostings, docMap);
    remapIdPostings(mergedChargramPostings, docMap);
  }

  const indexingConfig = userConfig?.indexing || {};
  const isCodeMode = mode === 'code';
  const typeInferenceEnabled = isCodeMode && indexingConfig.typeInference !== false;
  const typeInferenceCrossFileEnabled = isCodeMode && indexingConfig.typeInferenceCrossFile === true;
  const riskAnalysisEnabled = isCodeMode && indexingConfig.riskAnalysis !== false;
  const riskAnalysisCrossFileEnabled = isCodeMode
    && riskAnalysisEnabled
    && indexingConfig.riskAnalysisCrossFile !== false;
  if (typeInferenceCrossFileEnabled || riskAnalysisCrossFileEnabled) {
    await applyCrossFileInference({
      rootDir: root,
      chunks: state.chunks,
      enabled: true,
      log,
      useTooling: false,
      enableTypeInference: typeInferenceEnabled,
      enableRiskCorrelation: riskAnalysisEnabled && riskAnalysisCrossFileEnabled,
      fileRelations: state.fileRelations
    });
  }

  if (embeddingsSeen) {
    validateLengths('merged dense vectors', mergedDense, state.chunks.length, outDir);
    if (mergedDenseDoc.length) {
      validateLengths('merged dense doc vectors', mergedDenseDoc, state.chunks.length, outDir);
    }
    if (mergedDenseCode.length) {
      validateLengths('merged dense code vectors', mergedDenseCode, state.chunks.length, outDir);
    }
  }
  if (mergedMinhash.length) {
    validateLengths('merged minhash', mergedMinhash, state.chunks.length, outDir);
  }

  const sortKey = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));
  const tokenVocab = Array.from(mergedTokenPostings.keys()).sort(sortKey);
  const tokenPostingsList = tokenVocab.map((token) => normalizeTfPostings(mergedTokenPostings.get(token)));
  const phraseVocab = Array.from(mergedPhrasePostings.keys()).sort(sortKey);
  const phrasePostings = phraseVocab.map((token) => normalizeIdList(mergedPhrasePostings.get(token)));
  const chargramVocab = Array.from(mergedChargramPostings.keys()).sort(sortKey);
  const chargramPostings = chargramVocab.map((token) => normalizeIdList(mergedChargramPostings.get(token)));
  const fieldPostings = {};
  const fieldNames = Array.from(new Set([
    ...mergedFieldPostings.keys(),
    ...mergedFieldDocLengths.keys()
  ])).sort(sortKey);
  for (const field of fieldNames) {
    const map = mergedFieldPostings.get(field) || new Map();
    const vocab = Array.from(map.keys()).sort(sortKey);
    const postings = vocab.map((token) => normalizeTfPostings(map.get(token)));
    const lengths = mergedFieldDocLengths.get(field) || [];
    if (!vocab.length && !lengths.length) continue;
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
  const graphRelations = mode === 'code'
    ? buildRelationGraphs({ chunks: state.chunks, fileRelations: state.fileRelations })
    : null;
  state.fileRelations = state.fileRelations || new Map();
  state.scannedFilesTimes = [];
  state.scannedFiles = [];
  state.skippedFiles = [];
  const fieldDocLengths = {};
  for (const [field, lengths] of mergedFieldDocLengths.entries()) {
    fieldDocLengths[field] = lengths;
  }
  state.fieldDocLengths = fieldDocLengths;

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
    artifactSurfaceVersion: baseIndexState.artifactSurfaceVersion || ARTIFACT_SURFACE_VERSION,
    compatibilityKey: compatibilityKey || baseIndexState.compatibilityKey || null,
    mode,
    stage: resolvedStage || baseIndexState.stage || null,
    assembled: true
  };
  assembledIndexState.filterIndex = { ready: state.chunks.length > 0 };

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
    indexState: assembledIndexState,
    graphRelations
  });

  log(`Assembled index from ${inputs.length} piece set(s) into ${outDir}.`);
}
