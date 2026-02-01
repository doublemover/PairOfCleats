import { buildChunkId } from './chunk-id.js';
import { buildSymbolIdentity } from './identity/symbol.js';
import { collectDeclaredReturnTypes, pickDeclaredReturnType } from '../shared/docmeta.js';

const normalizeString = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const normalizeStringArray = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeString(entry)).filter(Boolean);
  }
  const single = normalizeString(value);
  return single ? [single] : [];
};

const normalizeModifiers = (value) => {
  if (Array.isArray(value)) return normalizeStringArray(value);
  if (value && typeof value === 'object') {
    const output = [];
    for (const [key, raw] of Object.entries(value)) {
      if (raw === null || raw === undefined || raw === false) continue;
      const normalizedKey = normalizeString(key);
      if (key === 'visibility') {
        const normalized = normalizeString(raw);
        if (normalized) output.push(normalized);
        continue;
      }
      if (typeof raw === 'boolean') {
        if (raw && normalizedKey) output.push(normalizedKey);
        continue;
      }
      const normalizedValue = normalizeString(raw);
      if (normalizedValue && normalizedKey && normalizedKey !== normalizedValue) {
        output.push(`${normalizedKey}:${normalizedValue}`);
        continue;
      }
      if (normalizedValue) output.push(normalizedValue);
    }
    return output.filter(Boolean);
  }
  const single = normalizeString(value);
  return single ? [single] : [];
};

const unique = (values) => Array.from(new Set(values.filter(Boolean)));

// Types may be a list (returns) or a param-name map (params).
const normalizeTypeEntries = (entries) => {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => entry && typeof entry === 'object' && entry.type)
    .map((entry) => ({
      type: normalizeString(entry.type),
      source: normalizeString(entry.source) || null,
      confidence: Number.isFinite(entry.confidence) ? entry.confidence : null,
      evidence: entry.evidence || null,
      shape: entry.shape || null,
      elements: entry.elements || null
    }))
    .filter((entry) => entry.type);
};

const normalizeParamMap = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const output = {};
  for (const [key, entries] of Object.entries(raw)) {
    const normalized = normalizeTypeEntries(entries);
    if (normalized.length) output[key] = normalized;
  }
  return Object.keys(output).length ? output : null;
};

const normalizeTypeMap = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const output = {};
  for (const [key, entries] of Object.entries(raw)) {
    if (Array.isArray(entries)) {
      const normalized = normalizeTypeEntries(entries);
      if (normalized.length) output[key] = normalized;
      continue;
    }
    if (entries && typeof entries === 'object') {
      const normalized = normalizeParamMap(entries);
      if (normalized) output[key] = normalized;
    }
  }
  return Object.keys(output).length ? output : null;
};

const buildDeclaredTypes = (docmeta) => {
  if (!docmeta || typeof docmeta !== 'object') return null;
  const declared = {};
  if (docmeta.paramTypes && typeof docmeta.paramTypes === 'object') {
    const params = {};
    for (const [name, type] of Object.entries(docmeta.paramTypes)) {
      const normalized = normalizeString(type);
      if (!normalized) continue;
      params[name] = [{ type: normalized, source: 'annotation', confidence: 0.95 }];
    }
    if (Object.keys(params).length) declared.params = params;
  }
  const returnTypes = collectDeclaredReturnTypes(docmeta);
  if (returnTypes.length) {
    declared.returns = returnTypes.map((type) => ({
      type,
      source: 'annotation',
      confidence: 0.95
    }));
  }
  return Object.keys(declared).length ? declared : null;
};

const splitToolingTypes = (raw) => {
  const inferred = normalizeTypeMap(raw);
  if (!inferred) return { inferred: null, tooling: null };
  const tooling = {};
  const remaining = {};
  for (const [key, entries] of Object.entries(inferred)) {
    if (Array.isArray(entries)) {
      const toolingEntries = entries.filter((entry) => entry.source === 'tooling');
      const otherEntries = entries.filter((entry) => entry.source !== 'tooling');
      if (toolingEntries.length) tooling[key] = toolingEntries;
      if (otherEntries.length) remaining[key] = otherEntries;
      continue;
    }
    if (entries && typeof entries === 'object') {
      const toolingMap = {};
      const remainingMap = {};
      for (const [param, list] of Object.entries(entries)) {
        if (!Array.isArray(list)) continue;
        const toolingEntries = list.filter((entry) => entry.source === 'tooling');
        const otherEntries = list.filter((entry) => entry.source !== 'tooling');
        if (toolingEntries.length) toolingMap[param] = toolingEntries;
        if (otherEntries.length) remainingMap[param] = otherEntries;
      }
      if (Object.keys(toolingMap).length) tooling[key] = toolingMap;
      if (Object.keys(remainingMap).length) remaining[key] = remainingMap;
    }
  }
  return {
    inferred: Object.keys(remaining).length ? remaining : null,
    tooling: Object.keys(tooling).length ? tooling : null
  };
};

export function buildMetaV2({ chunk, docmeta, toolInfo, analysisPolicy }) {
  if (analysisPolicy?.metadata?.enabled === false) return null;
  if (!chunk) return null;
  const segment = chunk.segment || null;
  const relations = chunk.codeRelations && typeof chunk.codeRelations === 'object'
    ? chunk.codeRelations
    : null;
  const chunkId = chunk.chunkId || buildChunkId(chunk);
  const identity = chunk.identity && typeof chunk.identity === 'object' ? chunk.identity : null;
  const chunkUid = normalizeString(chunk.chunkUid);
  const virtualPath = normalizeString(chunk.virtualPath || segment?.virtualPath || identity?.virtualPath);
  const containerExt = normalizeString(chunk.ext);
  const containerLanguageId = normalizeString(chunk.containerLanguageId);
  const effectiveExt = normalizeString(segment?.ext) || normalizeString(chunk.effectiveExt) || containerExt;
  const effectiveLanguageId = normalizeString(chunk.lang)
    || normalizeString(segment?.languageId)
    || containerLanguageId;
  const generatedBy = toolInfo?.version || null;
  const tooling = toolInfo
    ? {
      tool: toolInfo.tool || 'pairofcleats',
      version: toolInfo.version || null,
      configHash: toolInfo.configHash || null
    }
    : null;
  const parser = docmeta?.parser && typeof docmeta.parser === 'object'
    ? {
      name: normalizeString(docmeta.parser.name),
      version: normalizeString(docmeta.parser.version)
    }
    : null;

  const inferredSplit = splitToolingTypes(docmeta?.inferredTypes);
  const declared = buildDeclaredTypes(docmeta);
  const types = {
    ...(declared ? { declared } : {}),
    ...(inferredSplit.inferred ? { inferred: inferredSplit.inferred } : {}),
    ...(inferredSplit.tooling ? { tooling: inferredSplit.tooling } : {})
  };

  const metadata = {
    chunkId,
    chunkUid,
    chunkUidAlgoVersion: normalizeString(identity?.chunkUidAlgoVersion || (chunkUid ? 'v1' : null)),
    spanHash: normalizeString(identity?.spanHash),
    preHash: normalizeString(identity?.preHash),
    postHash: normalizeString(identity?.postHash),
    collisionOf: normalizeString(identity?.collisionOf),
    virtualPath,
    file: normalizeString(chunk.file),
    fileHash: normalizeString(chunk.fileHash),
    fileHashAlgo: normalizeString(chunk.fileHashAlgo),
    segment: segment
      ? {
        segmentId: normalizeString(segment.segmentId),
        segmentUid: normalizeString(segment.segmentUid),
        virtualPath: normalizeString(segment.virtualPath),
        type: normalizeString(segment.type),
        languageId: normalizeString(segment.languageId),
        parentSegmentId: normalizeString(segment.parentSegmentId),
        start: Number.isFinite(segment.start) ? segment.start : null,
        end: Number.isFinite(segment.end) ? segment.end : null,
        startLine: Number.isFinite(segment.startLine) ? segment.startLine : null,
        endLine: Number.isFinite(segment.endLine) ? segment.endLine : null,
        embeddingContext: normalizeString(segment.embeddingContext)
      }
      : null,
    range: {
      start: Number.isFinite(chunk.start) ? chunk.start : null,
      end: Number.isFinite(chunk.end) ? chunk.end : null,
      startLine: Number.isFinite(chunk.startLine) ? chunk.startLine : null,
      endLine: Number.isFinite(chunk.endLine) ? chunk.endLine : null
    },
    container: containerExt || containerLanguageId
      ? {
        ext: containerExt,
        languageId: containerLanguageId
      }
      : null,
    effective: effectiveExt || effectiveLanguageId
      ? {
        ext: effectiveExt,
        languageId: effectiveLanguageId
      }
      : null,
    lang: effectiveLanguageId,
    ext: containerExt,
    kind: normalizeString(chunk.kind),
    name: normalizeString(chunk.name),
    generatedBy,
    tooling,
    parser,
    signature: normalizeString(docmeta?.signature),
    doc: normalizeString(docmeta?.doc),
    annotations: unique([
      ...normalizeStringArray(docmeta?.decorators),
      ...normalizeStringArray(docmeta?.annotations)
    ]),
    modifiers: normalizeModifiers(docmeta?.modifiers),
    params: Array.isArray(docmeta?.params) ? docmeta.params.filter(Boolean) : [],
    returns: pickDeclaredReturnType(docmeta),
    controlFlow: docmeta?.controlFlow || null,
    dataflow: docmeta?.dataflow || null,
    dependencies: docmeta?.dependencies || null,
    relations: relations
      ? {
        calls: relations.calls || null,
        callLinks: relations.callLinks || null,
        usageLinks: relations.usageLinks || null,
        callSummaries: relations.callSummaries || null
      }
      : null,
    structural: docmeta?.structural || null,
    risk: docmeta?.risk || null,
    types: Object.keys(types).length ? types : null,
    embedded: segment
      ? {
        parentSegmentId: normalizeString(segment.parentSegmentId),
        languageId: normalizeString(segment.languageId),
        context: normalizeString(segment.embeddingContext)
      }
      : null
  };

  if (!metadata.annotations.length) metadata.annotations = null;
  if (!metadata.params.length) metadata.params = null;
  if (!metadata.modifiers.length) metadata.modifiers = null;
  metadata.symbol = buildSymbolIdentity({ metaV2: metadata });

  return metadata;
}

export const finalizeMetaV2 = ({ chunks, toolInfo, analysisPolicy, debug = false, onMismatch = null }) => {
  if (!Array.isArray(chunks)) return { mismatches: 0 };
  let mismatches = 0;
  for (const chunk of chunks) {
    const previous = chunk?.metaV2 || null;
    const next = buildMetaV2({ chunk, docmeta: chunk?.docmeta, toolInfo, analysisPolicy });
    if (debug && previous && next) {
      const prevJson = JSON.stringify(previous);
      const nextJson = JSON.stringify(next);
      if (prevJson !== nextJson) {
        mismatches += 1;
        if (onMismatch) onMismatch({ chunk, previous, next });
      }
    }
    if (chunk) {
      chunk.metaV2 = next;
      if (next?.chunkId) chunk.chunkId = next.chunkId;
      if (next?.chunkUid) chunk.chunkUid = next.chunkUid;
      if (next?.virtualPath && !chunk.virtualPath) chunk.virtualPath = next.virtualPath;
    }
  }
  return { mismatches };
};
