import { uniqueTypes } from '../../integrations/tooling/providers/shared.js';
import { TOOLING_CONFIDENCE, TOOLING_SOURCE } from './constants.js';
import { addInferredParam, addInferredReturn } from './apply.js';
import { ensureParamTypeMap, getParamTypeList } from './extract.js';
import { normalizeTypeExpressions } from '../../shared/symbolic-types.js';

const toProvenanceList = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return [value];
};

const mergeToolingSources = (chunk, provenanceList) => {
  if (!chunk?.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
  const toolingMeta = chunk.docmeta.tooling && typeof chunk.docmeta.tooling === 'object'
    ? chunk.docmeta.tooling
    : {};
  const existing = Array.isArray(toolingMeta.sources) ? toolingMeta.sources : [];
  const next = [];
  const seen = new Set();
  for (const entry of [...existing, ...toProvenanceList(provenanceList)]) {
    if (!entry?.provider) continue;
    if (seen.has(entry.provider)) continue;
    seen.add(entry.provider);
    next.push(entry);
  }
  toolingMeta.sources = next;
  chunk.docmeta.tooling = toolingMeta;
};

export const applyToolingTypes = ({ byChunkUid, chunkByUid, entryByUid }) => {
  let inferredReturns = 0;
  let enriched = 0;
  for (const [chunkUid, info] of byChunkUid.entries()) {
    const chunk = chunkByUid.get(chunkUid);
    if (!chunk || !info?.payload) continue;
    if (!chunk.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
    mergeToolingSources(chunk, info.provenance);
    const payload = info.payload;
    let touched = false;
    if (payload.typeExpressions) {
      // Display text is presentation only. Never feed it into string-based
      // inferred-type propagation as if it were the denoted language.
      chunk.docmeta.typeExpressions = normalizeTypeExpressions(payload.typeExpressions);
      touched = true;
    }
    if (payload.signature && !chunk.docmeta.signature) {
      chunk.docmeta.signature = payload.signature;
      touched = true;
    }
    if (payload.returnType) {
      if (!chunk.docmeta.returnType) chunk.docmeta.returnType = payload.returnType;
      if (addInferredReturn(chunk.docmeta, payload.returnType, TOOLING_SOURCE, TOOLING_CONFIDENCE)) {
        inferredReturns += 1;
        touched = true;
      }
    }
    if (payload.paramTypes && typeof payload.paramTypes === 'object') {
      chunk.docmeta.paramTypes = ensureParamTypeMap(chunk.docmeta.paramTypes);
      for (const [name, entries] of Object.entries(payload.paramTypes)) {
        if (!name || !Array.isArray(entries)) continue;
        for (const entry of entries) {
          const type = entry?.type || null;
          if (!type) continue;
          if (!Object.hasOwn(chunk.docmeta.paramTypes, name)) chunk.docmeta.paramTypes[name] = type;
          addInferredParam(
            chunk.docmeta,
            name,
            type,
            entry?.source || TOOLING_SOURCE,
            Number.isFinite(entry?.confidence) ? entry.confidence : TOOLING_CONFIDENCE
          );
          const symbolEntry = entryByUid?.get(chunkUid) || null;
          if (symbolEntry) {
            symbolEntry.paramTypes = ensureParamTypeMap(symbolEntry.paramTypes);
            const existing = getParamTypeList(symbolEntry.paramTypes, name);
            symbolEntry.paramTypes[name] = uniqueTypes([...existing, type]);
          }
          touched = true;
        }
      }
    }
    if (touched) enriched += 1;
  }
  return { inferredReturns, enriched };
};
