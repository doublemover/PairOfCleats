import {
  mergeIdPostings,
  mergeTfPostings,
  readArray,
  readField,
  validateLengths
} from './helpers.js';
import { materializeDenseVectorRows } from '../../../shared/dense-vector-artifacts.js';

const CHUNK_UID_ORDINAL_SUFFIX_RE = /:ord[1-9][0-9]*$/;

const remapChunkUid = (value, chunkUidRemap) => (
  typeof value === 'string' && value && chunkUidRemap.has(value)
    ? chunkUidRemap.get(value)
    : value
);

const allocateMergedChunkUid = (chunkUid, usedChunkUids) => {
  if (typeof chunkUid !== 'string' || !chunkUid) return chunkUid;
  if (!usedChunkUids.has(chunkUid)) {
    usedChunkUids.add(chunkUid);
    return chunkUid;
  }
  const baseChunkUid = chunkUid.replace(CHUNK_UID_ORDINAL_SUFFIX_RE, '');
  let ordinal = 2;
  let candidate = `${baseChunkUid}:ord${ordinal}`;
  while (usedChunkUids.has(candidate)) {
    ordinal += 1;
    candidate = `${baseChunkUid}:ord${ordinal}`;
  }
  usedChunkUids.add(candidate);
  return candidate;
};

const remapSymbolEndpoint = (endpoint, chunkUidRemap) => {
  if (!endpoint || typeof endpoint !== 'object') return endpoint;
  const nextChunkUid = remapChunkUid(endpoint.chunkUid, chunkUidRemap);
  if (nextChunkUid === endpoint.chunkUid) return endpoint;
  return {
    ...endpoint,
    chunkUid: nextChunkUid
  };
};

const remapSymbolRef = (ref, chunkUidRemap) => {
  if (!ref || typeof ref !== 'object') return ref;
  let changed = false;
  const next = { ...ref };
  if (ref.resolved && typeof ref.resolved === 'object') {
    const resolved = remapSymbolEndpoint(ref.resolved, chunkUidRemap);
    changed = changed || resolved !== ref.resolved;
    next.resolved = resolved;
  }
  if (Array.isArray(ref.candidates)) {
    const candidates = ref.candidates.map((candidate) => remapSymbolEndpoint(candidate, chunkUidRemap));
    changed = changed || candidates.some((candidate, index) => candidate !== ref.candidates[index]);
    next.candidates = candidates;
  }
  return changed ? next : ref;
};

const remapCodeRelations = (relations, chunkUidRemap) => {
  if (!relations || typeof relations !== 'object') return relations;
  let changed = false;
  const next = { ...relations };
  const remapLinks = (links) => {
    if (!Array.isArray(links)) return links;
    let linksChanged = false;
    const rows = links.map((link) => {
      if (!link || typeof link !== 'object') return link;
      let linkChanged = false;
      const remappedTo = remapSymbolRef(link.to, chunkUidRemap);
      const remappedRef = remapSymbolRef(link.ref, chunkUidRemap);
      if (remappedTo !== link.to) linkChanged = true;
      if (remappedRef !== link.ref) linkChanged = true;
      if (!linkChanged) return link;
      linksChanged = true;
      return {
        ...link,
        ...(Object.prototype.hasOwnProperty.call(link, 'to') ? { to: remappedTo } : {}),
        ...(Object.prototype.hasOwnProperty.call(link, 'ref') ? { ref: remappedRef } : {})
      };
    });
    changed = changed || linksChanged;
    return rows;
  };
  next.callLinks = remapLinks(relations.callLinks);
  next.usageLinks = remapLinks(relations.usageLinks);
  if (Array.isArray(relations.callDetails)) {
    let detailsChanged = false;
    next.callDetails = relations.callDetails.map((detail) => {
      if (!detail || typeof detail !== 'object') return detail;
      const remappedTargetChunkUid = remapChunkUid(detail.targetChunkUid, chunkUidRemap);
      const remappedCalleeRef = remapSymbolRef(detail.calleeRef, chunkUidRemap);
      const remappedSymbolRef = remapSymbolRef(detail.symbolRef, chunkUidRemap);
      const detailChanged = remappedTargetChunkUid !== detail.targetChunkUid
        || remappedCalleeRef !== detail.calleeRef
        || remappedSymbolRef !== detail.symbolRef;
      if (!detailChanged) return detail;
      detailsChanged = true;
      return {
        ...detail,
        targetChunkUid: remappedTargetChunkUid,
        ...(Object.prototype.hasOwnProperty.call(detail, 'calleeRef') ? { calleeRef: remappedCalleeRef } : {}),
        ...(Object.prototype.hasOwnProperty.call(detail, 'symbolRef') ? { symbolRef: remappedSymbolRef } : {})
      };
    });
    changed = changed || detailsChanged;
  }
  return changed ? next : relations;
};

const remapRiskEvidence = (evidence, chunkUidRemap) => {
  if (!evidence || typeof evidence !== 'object') return evidence;
  if (!Array.isArray(evidence.callSitesByStep)) return evidence;
  let changed = false;
  const callSitesByStep = evidence.callSitesByStep.map((step) => {
    if (!Array.isArray(step)) return step;
    let stepChanged = false;
    const nextStep = step.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const remappedTargetChunkUid = remapChunkUid(entry.targetChunkUid, chunkUidRemap);
      const details = entry.details && typeof entry.details === 'object'
        ? {
          ...entry.details,
          targetChunkUid: remapChunkUid(entry.details.targetChunkUid, chunkUidRemap)
        }
        : entry.details;
      const entryChanged = remappedTargetChunkUid !== entry.targetChunkUid
        || details !== entry.details;
      if (!entryChanged) return entry;
      stepChanged = true;
      return {
        ...entry,
        targetChunkUid: remappedTargetChunkUid,
        details
      };
    });
    changed = changed || stepChanged;
    return nextStep;
  });
  return changed
    ? {
      ...evidence,
      callSitesByStep
    }
    : evidence;
};

const remapRiskSummary = (summary, chunkUidRemap) => {
  if (!summary || typeof summary !== 'object') return summary;
  const nextChunkUid = remapChunkUid(summary.chunkUid, chunkUidRemap);
  return nextChunkUid === summary.chunkUid
    ? summary
    : {
      ...summary,
      chunkUid: nextChunkUid
    };
};

const remapRiskFlow = (flow, chunkUidRemap, { partial = false } = {}) => {
  if (!flow || typeof flow !== 'object') return flow;
  const nextSource = flow.source && typeof flow.source === 'object'
    ? {
      ...flow.source,
      chunkUid: remapChunkUid(flow.source.chunkUid, chunkUidRemap)
    }
    : flow.source;
  const frontierKey = partial ? 'frontier' : 'sink';
  const nextFrontier = flow[frontierKey] && typeof flow[frontierKey] === 'object'
    ? {
      ...flow[frontierKey],
      chunkUid: remapChunkUid(flow[frontierKey].chunkUid, chunkUidRemap)
    }
    : flow[frontierKey];
  const nextPath = flow.path && typeof flow.path === 'object'
    ? {
      ...flow.path,
      chunkUids: Array.isArray(flow.path.chunkUids)
        ? flow.path.chunkUids.map((chunkUid) => remapChunkUid(chunkUid, chunkUidRemap))
        : flow.path.chunkUids
    }
    : flow.path;
  const nextEvidence = remapRiskEvidence(flow.evidence, chunkUidRemap);
  return {
    ...flow,
    source: nextSource,
    [frontierKey]: nextFrontier,
    path: nextPath,
    evidence: nextEvidence
  };
};

const remapCallSite = (site, chunkUidRemap) => {
  if (!site || typeof site !== 'object') return site;
  const nextCallerChunkUid = remapChunkUid(site.callerChunkUid, chunkUidRemap);
  const nextTargetChunkUid = remapChunkUid(site.targetChunkUid, chunkUidRemap);
  if (nextCallerChunkUid === site.callerChunkUid && nextTargetChunkUid === site.targetChunkUid) {
    return site;
  }
  return {
    ...site,
    callerChunkUid: nextCallerChunkUid,
    targetChunkUid: nextTargetChunkUid
  };
};

export const mergeIndexInput = ({ input, dir, state, mergeState }) => {
  if (Array.isArray(input.fileList) && input.fileList.length) {
    const fileSet = new Set(Array.isArray(state.discoveredFiles) ? state.discoveredFiles : []);
    for (const file of input.fileList) {
      if (typeof file === 'string' && file) fileSet.add(file);
    }
    state.discoveredFiles = Array.from(fileSet).sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
  }

  const chunks = Array.isArray(input.chunkMeta) ? input.chunkMeta : [];
  const docLengths = Array.isArray(input.tokenPostings?.docLengths)
    ? input.tokenPostings.docLengths
    : [];
  validateLengths('docLengths', docLengths, chunks.length, dir);
  const docOffset = state.chunks.length;
  const usedChunkUids = mergeState.usedChunkUids || (mergeState.usedChunkUids = new Set());
  const chunkUidRemap = new Map();
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = { ...chunks[i] };
    chunk.id = docOffset + i;
    const originalChunkUid = chunk.chunkUid || chunk.metaV2?.chunkUid || null;
    if (originalChunkUid) {
      const nextChunkUid = allocateMergedChunkUid(originalChunkUid, usedChunkUids);
      if (nextChunkUid !== originalChunkUid) {
        chunkUidRemap.set(originalChunkUid, nextChunkUid);
      }
      chunk.chunkUid = nextChunkUid;
      if (chunk.metaV2 && typeof chunk.metaV2 === 'object') {
        chunk.metaV2 = {
          ...chunk.metaV2,
          chunkUid: nextChunkUid
        };
      }
    }
    chunk.codeRelations = remapCodeRelations(chunk.codeRelations, chunkUidRemap);
    if (chunk.fileId != null) delete chunk.fileId;
    state.chunks.push(chunk);
  }
  state.docLengths.push(...docLengths);
  for (const len of docLengths) {
    if (Number.isFinite(len)) state.totalTokens += len;
  }

  if (Array.isArray(input.callSites) && input.callSites.length) {
    mergeState.mergedCallSites.push(...input.callSites.map((site) => remapCallSite(site, chunkUidRemap)));
  }
  if (Array.isArray(input.riskSummaries) && input.riskSummaries.length) {
    if (!Array.isArray(state.riskSummaries)) state.riskSummaries = [];
    state.riskSummaries.push(...input.riskSummaries.map((summary) => remapRiskSummary(summary, chunkUidRemap)));
  }
  if (Array.isArray(input.riskFlows) && input.riskFlows.length) {
    if (!Array.isArray(state.riskFlows)) state.riskFlows = [];
    state.riskFlows.push(...input.riskFlows.map((flow) => remapRiskFlow(flow, chunkUidRemap)));
  }
  if (Array.isArray(input.riskPartialFlows) && input.riskPartialFlows.length) {
    if (!Array.isArray(state.riskPartialFlows)) state.riskPartialFlows = [];
    state.riskPartialFlows.push(...input.riskPartialFlows.map((flow) => remapRiskFlow(flow, chunkUidRemap, { partial: true })));
  }
  if (
    input.riskInterproceduralStats
    && typeof input.riskInterproceduralStats === 'object'
    && !state.riskInterproceduralStats
  ) {
    state.riskInterproceduralStats = { ...input.riskInterproceduralStats };
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

  const denseVec = materializeDenseVectorRows(input.denseVec);
  const denseVecDoc = materializeDenseVectorRows(input.denseVecDoc);
  const denseVecCode = materializeDenseVectorRows(input.denseVecCode);
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
