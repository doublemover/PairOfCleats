import {
  mergeIdPostings,
  mergeTfPostings,
  readArray,
  readField,
  validateLengths
} from './helpers.js';

export const mergeIndexInput = ({ input, dir, state, mergeState }) => {
  const chunks = Array.isArray(input.chunkMeta) ? input.chunkMeta : [];
  const docLengths = Array.isArray(input.tokenPostings?.docLengths)
    ? input.tokenPostings.docLengths
    : [];
  validateLengths('docLengths', docLengths, chunks.length, dir);
  const docOffset = state.chunks.length;
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

  if (Array.isArray(input.callSites) && input.callSites.length) {
    mergeState.mergedCallSites.push(...input.callSites);
  }

  const vocab = Array.isArray(input.tokenPostings?.vocab) ? input.tokenPostings.vocab : [];
  const postings = Array.isArray(input.tokenPostings?.postings) ? input.tokenPostings.postings : [];
  for (let i = 0; i < vocab.length; i += 1) {
    mergeTfPostings(mergeState.mergedTokenPostings, vocab[i], postings[i], docOffset);
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
      const lengths = mergeState.mergedFieldDocLengths.get(field) || [];
      lengths.push(...fieldDocLengths);
      mergeState.mergedFieldDocLengths.set(field, lengths);
      const destMap = mergeState.mergedFieldPostings.get(field) || new Map();
      for (let i = 0; i < fieldVocab.length; i += 1) {
        mergeTfPostings(destMap, fieldVocab[i], fieldPosting[i], docOffset);
      }
      mergeState.mergedFieldPostings.set(field, destMap);
    }
  }

  const fieldTokens = Array.isArray(input.fieldTokens) ? input.fieldTokens : null;
  if (input.fieldTokens) {
    validateLengths('fieldTokens', fieldTokens, chunks.length, dir);
  }
  if (fieldTokens && fieldTokens.length) {
    mergeState.fieldTokensSeen = true;
    for (let i = 0; i < chunks.length; i += 1) {
      state.fieldTokens[docOffset + i] = fieldTokens[i] || null;
    }
  } else if (mergeState.fieldTokensSeen) {
    for (let i = 0; i < chunks.length; i += 1) {
      state.fieldTokens[docOffset + i] = null;
    }
  }

  const minhash = readArray(input.minhash, 'signatures');
  if (input.minhash) {
    validateLengths('minhash', minhash, chunks.length, dir, { allowMissing: false });
    if (minhash.length) mergeState.mergedMinhash.push(...minhash);
  }

  const phraseVocab = readArray(input.phraseNgrams, 'vocab');
  const phrasePosting = readArray(input.phraseNgrams, 'postings');
  for (let i = 0; i < phraseVocab.length; i += 1) {
    mergeIdPostings(mergeState.mergedPhrasePostings, phraseVocab[i], phrasePosting[i], docOffset);
  }

  const chargramVocab = readArray(input.chargrams, 'vocab');
  const chargramPosting = readArray(input.chargrams, 'postings');
  for (let i = 0; i < chargramVocab.length; i += 1) {
    mergeIdPostings(mergeState.mergedChargramPostings, chargramVocab[i], chargramPosting[i], docOffset);
  }

  const denseVec = readArray(input.denseVec, 'vectors');
  const denseVecDoc = readArray(input.denseVecDoc, 'vectors');
  const denseVecCode = readArray(input.denseVecCode, 'vectors');
  const inputDims = Number(readField(input.denseVec, 'dims')) || 0;
  const inputModel = readField(input.denseVec, 'model');
  const inputScale = readField(input.denseVec, 'scale');
  if (input.denseVec) {
    mergeState.embeddingsSeen = true;
    if (mergeState.denseDims && inputDims && mergeState.denseDims !== inputDims) {
      throw new Error(`Embedding dims mismatch (${mergeState.denseDims} !== ${inputDims})`);
    }
    if (mergeState.denseModel && inputModel && mergeState.denseModel !== inputModel) {
      throw new Error(`Embedding model mismatch (${mergeState.denseModel} !== ${inputModel})`);
    }
    if (mergeState.denseScale && inputScale && mergeState.denseScale !== inputScale) {
      throw new Error(`Embedding scale mismatch (${mergeState.denseScale} !== ${inputScale})`);
    }
    mergeState.denseDims = mergeState.denseDims || inputDims;
    mergeState.denseModel = mergeState.denseModel || inputModel || null;
    mergeState.denseScale = mergeState.denseScale || inputScale || null;
    validateLengths('dense vectors', denseVec, chunks.length, dir);
    if (denseVec.length) mergeState.mergedDense.push(...denseVec);
    if (input.denseVecDoc) {
      validateLengths('dense doc vectors', denseVecDoc, chunks.length, dir);
      if (denseVecDoc.length) mergeState.mergedDenseDoc.push(...denseVecDoc);
    }
    if (input.denseVecCode) {
      validateLengths('dense code vectors', denseVecCode, chunks.length, dir);
      if (denseVecCode.length) mergeState.mergedDenseCode.push(...denseVecCode);
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

  return { chunkCount: chunks.length, docOffset };
};
