import path from 'node:path';
import { applyCrossFileInference } from '../type-inference-crossfile.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { log as defaultLog } from '../../shared/progress.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { createIndexState } from './state.js';
import { buildRelationGraphs } from './graphs.js';
import { writeIndexArtifacts } from './artifacts.js';
import { getScmProviderAndRoot, resolveScmConfig } from '../scm/registry.js';
import { loadIndexArtifacts, readCompatibilityKeys } from './piece-assembly/load.js';
import { mergeIndexInput } from './piece-assembly/merge.js';
import {
  STAGE_ORDER,
  buildChunkOrdering,
  computeBm25,
  normalizeIdList,
  normalizeStage,
  normalizeTfPostings,
  remapIdPostings,
  remapTfPostings,
  validateLengths
} from './piece-assembly/helpers.js';

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
  let repoProvenance = null;
  try {
    const scmConfig = resolveScmConfig({
      indexingConfig: userConfig?.indexing || {},
      analysisPolicy: userConfig?.analysisPolicy || null
    });
    const scmProviderSetting = scmConfig?.provider || 'auto';
    const selection = getScmProviderAndRoot({ provider: scmProviderSetting, startPath: root, log });
    const provenance = await selection.providerImpl.getRepoProvenance({
      repoRoot: selection.repoRoot
    });
    repoProvenance = {
      ...provenance,
      provider: provenance?.provider || selection.provider,
      root: provenance?.root || selection.repoRoot,
      detectedBy: provenance?.detectedBy ?? selection.detectedBy
    };
  } catch (err) {
    const message = err?.message || String(err);
    log(`[scm] Failed to read repo provenance; continuing without repo metadata. (${message})`);
  }
  const mergedTokenPostings = new Map();
  const mergedFieldPostings = new Map();
  const mergedFieldDocLengths = new Map();
  const mergedPhrasePostings = new Map();
  const mergedChargramPostings = new Map();
  const mergedMinhash = [];
  const mergedDense = [];
  const mergedDenseDoc = [];
  const mergedDenseCode = [];
  const mergedCallSites = [];
  const stageInputs = [];
  const mergeState = {
    mergedTokenPostings,
    mergedFieldPostings,
    mergedFieldDocLengths,
    mergedPhrasePostings,
    mergedChargramPostings,
    mergedMinhash,
    mergedDense,
    mergedDenseDoc,
    mergedDenseCode,
    mergedCallSites,
    denseModel: null,
    denseDims: 0,
    denseScale: null,
    embeddingsSeen: false,
    fieldTokensSeen: false
  };

  const sortedInputs = inputs
    .map((dir) => path.resolve(dir))
    .sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
  const compatibilityKeys = readCompatibilityKeys(sortedInputs, { strict });
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
    const { chunkCount } = mergeIndexInput({ input, dir, state, mergeState });
    stageInputs.push({ indexState: input.indexState, chunkCount });
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
    const newFieldTokens = mergeState.fieldTokensSeen ? new Array(ordering.length) : null;
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
  const typeInferenceCrossFileEnabled = isCodeMode && indexingConfig.typeInferenceCrossFile !== false;
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
      enableTypeInference: typeInferenceEnabled && typeInferenceCrossFileEnabled,
      enableRiskCorrelation: riskAnalysisEnabled && riskAnalysisCrossFileEnabled,
      fileRelations: state.fileRelations
    });
  }

  if (mergeState.embeddingsSeen) {
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
    dims: mergeState.embeddingsSeen ? mergeState.denseDims : 0,
    quantizedVectors: mergeState.embeddingsSeen ? mergedDense : [],
    quantizedDocVectors: mergeState.embeddingsSeen ? (mergedDenseDoc.length ? mergedDenseDoc : mergedDense) : [],
    quantizedCodeVectors: mergeState.embeddingsSeen ? (mergedDenseCode.length ? mergedDenseCode : mergedDense) : []
  };

  const uniqueFiles = new Set();
  for (const chunk of state.chunks) {
    if (chunk?.file) uniqueFiles.add(chunk.file);
  }
  const timing = { start: Date.now() };
  const resolvedCallSites = mergedCallSites.filter(
    (site) => site?.callerChunkUid && site?.targetChunkUid
  );
  const graphRelations = mode === 'code'
    ? buildRelationGraphs({
      chunks: state.chunks,
      fileRelations: state.fileRelations,
      callSites: resolvedCallSites.length ? resolvedCallSites : null,
      caps: userConfig?.indexing?.graph?.caps
    })
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
    modelId: mergeState.denseModel || userConfig?.indexing?.model || null,
    useStubEmbeddings: false,
    dictSummary: null,
    timing,
    root,
    userConfig,
    incrementalEnabled: false,
    fileCounts: { candidates: uniqueFiles.size },
    indexState: assembledIndexState,
    graphRelations,
    repoProvenance
  });

  log(`Assembled index from ${inputs.length} piece set(s) into ${outDir}.`);
}
