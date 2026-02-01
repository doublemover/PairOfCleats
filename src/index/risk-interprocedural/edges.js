import { buildCallSiteId } from '../callsite-id.js';

const normalizeText = (value) => (value == null ? '' : String(value));

export const edgeKey = (callerUid, calleeUid) => `${callerUid || ''}->${calleeUid || ''}`;

export const sortCallDetailsForSampling = (a, b) => {
  const fileA = normalizeText(a?.file);
  const fileB = normalizeText(b?.file);
  if (fileA !== fileB) return fileA.localeCompare(fileB);
  const startLineA = Number.isFinite(a?.startLine) ? a.startLine : 0;
  const startLineB = Number.isFinite(b?.startLine) ? b.startLine : 0;
  if (startLineA !== startLineB) return startLineA - startLineB;
  const startColA = Number.isFinite(a?.startCol) ? a.startCol : 0;
  const startColB = Number.isFinite(b?.startCol) ? b.startCol : 0;
  if (startColA !== startColB) return startColA - startColB;
  const endLineA = Number.isFinite(a?.endLine) ? a.endLine : 0;
  const endLineB = Number.isFinite(b?.endLine) ? b.endLine : 0;
  if (endLineA !== endLineB) return endLineA - endLineB;
  const endColA = Number.isFinite(a?.endCol) ? a.endCol : 0;
  const endColB = Number.isFinite(b?.endCol) ? b.endCol : 0;
  if (endColA !== endColB) return endColA - endColB;
  const normalizedA = normalizeText(a?.calleeNormalized);
  const normalizedB = normalizeText(b?.calleeNormalized);
  if (normalizedA !== normalizedB) return normalizedA.localeCompare(normalizedB);
  const rawA = normalizeText(a?.calleeRaw || a?.callee);
  const rawB = normalizeText(b?.calleeRaw || b?.callee);
  if (rawA !== rawB) return rawA.localeCompare(rawB);
  const idA = normalizeText(a?.callSiteId);
  const idB = normalizeText(b?.callSiteId);
  if (idA !== idB) return idA.localeCompare(idB);
  return 0;
};

const buildSampleEntry = ({ detail, file }) => {
  const calleeRaw = normalizeText(detail?.calleeRaw || detail?.callee);
  const startLine = Number.isFinite(detail?.startLine) ? detail.startLine : null;
  const startCol = Number.isFinite(detail?.startCol) ? detail.startCol : null;
  const endLine = Number.isFinite(detail?.endLine) ? detail.endLine : null;
  const endCol = Number.isFinite(detail?.endCol) ? detail.endCol : null;
  const callSiteId = buildCallSiteId({ file, startLine, startCol, endLine, endCol, calleeRaw });
  return {
    file,
    calleeRaw,
    callSiteId,
    detail
  };
};

export const sampleCallSitesForEdge = (callDetails, {
  calleeUid,
  callerFile,
  maxCallSitesPerEdge
} = {}) => {
  if (!Array.isArray(callDetails) || !calleeUid) return [];
  const limit = Number.isFinite(Number(maxCallSitesPerEdge))
    ? Math.max(1, Math.floor(Number(maxCallSitesPerEdge)))
    : 3;
  const candidates = [];
  for (const detail of callDetails) {
    if (!detail || detail.targetChunkUid !== calleeUid) continue;
    const file = normalizeText(detail.file) || normalizeText(callerFile);
    if (!file) continue;
    const entry = buildSampleEntry({ detail, file });
    if (!entry.callSiteId) continue;
    candidates.push({
      file,
      startLine: detail.startLine,
      startCol: detail.startCol,
      endLine: detail.endLine,
      endCol: detail.endCol,
      calleeNormalized: detail.calleeNormalized,
      calleeRaw: entry.calleeRaw,
      callSiteId: entry.callSiteId,
      detail
    });
  }
  if (!candidates.length) return [];
  candidates.sort(sortCallDetailsForSampling);
  const output = [];
  for (const entry of candidates.slice(0, limit)) {
    const args = Array.isArray(entry.detail?.args) && entry.detail.args.length
      ? entry.detail.args.slice()
      : null;
    output.push({
      callSiteId: entry.callSiteId,
      args
    });
  }
  return output;
};
