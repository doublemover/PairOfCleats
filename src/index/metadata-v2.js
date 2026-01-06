import { sha1 } from '../shared/hash.js';

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

const unique = (values) => Array.from(new Set(values.filter(Boolean)));

const buildChunkId = (chunk) => {
  if (!chunk) return null;
  const key = [
    chunk.file || '',
    chunk.segment?.segmentId || '',
    chunk.start ?? '',
    chunk.end ?? '',
    chunk.kind || '',
    chunk.name || ''
  ].join('|');
  return `chunk_${sha1(key)}`;
};

const normalizeEntries = (entries) => {
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

const normalizeTypeMap = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const output = {};
  for (const [key, entries] of Object.entries(raw)) {
    const normalized = normalizeEntries(entries);
    if (normalized.length) output[key] = normalized;
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
  const returnType = normalizeString(docmeta.returnType || docmeta.returns);
  if (returnType) {
    declared.returns = [{ type: returnType, source: 'annotation', confidence: 0.95 }];
  }
  return Object.keys(declared).length ? declared : null;
};

const splitToolingTypes = (raw) => {
  const inferred = normalizeTypeMap(raw);
  if (!inferred) return { inferred: null, tooling: null };
  const tooling = {};
  const remaining = {};
  for (const [key, entries] of Object.entries(inferred)) {
    const toolingEntries = entries.filter((entry) => entry.source === 'tooling');
    const otherEntries = entries.filter((entry) => entry.source !== 'tooling');
    if (toolingEntries.length) tooling[key] = toolingEntries;
    if (otherEntries.length) remaining[key] = otherEntries;
  }
  return {
    inferred: Object.keys(remaining).length ? remaining : null,
    tooling: Object.keys(tooling).length ? tooling : null
  };
};

export function buildMetaV2({ chunk, docmeta, toolInfo }) {
  if (!chunk) return null;
  const segment = chunk.segment || null;
  const relations = chunk.codeRelations && typeof chunk.codeRelations === 'object'
    ? chunk.codeRelations
    : null;
  const chunkId = chunk.chunkId || buildChunkId(chunk);
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
    file: normalizeString(chunk.file),
    segment: segment
      ? {
        segmentId: normalizeString(segment.segmentId),
        type: normalizeString(segment.type),
        languageId: normalizeString(segment.languageId),
        parentSegmentId: normalizeString(segment.parentSegmentId)
      }
      : null,
    range: {
      start: Number.isFinite(chunk.start) ? chunk.start : null,
      end: Number.isFinite(chunk.end) ? chunk.end : null,
      startLine: Number.isFinite(chunk.startLine) ? chunk.startLine : null,
      endLine: Number.isFinite(chunk.endLine) ? chunk.endLine : null
    },
    lang: normalizeString(segment?.languageId) || normalizeString(chunk.lang),
    ext: normalizeString(chunk.ext),
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
    modifiers: docmeta?.modifiers && typeof docmeta.modifiers === 'object'
      ? docmeta.modifiers
      : null,
    params: Array.isArray(docmeta?.params) ? docmeta.params.filter(Boolean) : [],
    returns: normalizeString(docmeta?.returnType || docmeta?.returns) || null,
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

  return metadata;
}
