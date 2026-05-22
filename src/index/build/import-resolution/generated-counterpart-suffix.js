import path from 'node:path';
import { normalizeRelPath } from './path-utils.js';

const GENERATED_DIR_SEGMENT_RX = /\/(?:__generated__|generated|gen)\//i;
const OPENAPI_SOURCE_SUFFIXES = Object.freeze([
  '.openapi.yaml',
  '.openapi.yml',
  '.openapi.json',
  '.swagger.yaml',
  '.swagger.yml',
  '.swagger.json'
]);
const OPENAPI_SOURCE_DIRECT_EXTENSIONS = Object.freeze(['.yaml', '.yml', '.json']);

export const OPENAPI_BASENAME_HINTS = new Set(['openapi', 'swagger']);

const stripGeneratedProtoBaseForMarker = (normalized, marker) => {
  if (typeof normalized !== 'string' || !normalized) return normalized;
  if (typeof marker !== 'string' || !marker) return normalized;
  const lower = normalized.toLowerCase();
  const lowerMarker = marker.toLowerCase();
  let cursor = normalized.length;
  while (cursor > 0) {
    const slash = normalized.lastIndexOf('/', cursor - 1);
    const dot = normalized.lastIndexOf('.', cursor - 1);
    if (dot <= slash || dot <= 0) break;
    cursor = dot;
    const markerStart = cursor - lowerMarker.length;
    if (markerStart < 0) continue;
    if (lower.slice(markerStart, cursor) === lowerMarker) {
      return normalized.slice(0, markerStart);
    }
  }
  return normalized;
};

export const stripGrpcPbGeneratedBase = (normalized) => (
  stripGeneratedProtoBaseForMarker(normalized, '.grpc.pb')
);

export const stripPbGeneratedBase = (normalized) => (
  stripGeneratedProtoBaseForMarker(normalized, '.pb')
);

export const looksLikeOpenApiBase = (baseRel) => {
  const normalized = normalizeRelPath(baseRel);
  if (!normalized) return false;
  const base = path.posix.basename(normalized).toLowerCase();
  return OPENAPI_BASENAME_HINTS.has(base) || base.endsWith('.openapi') || base.endsWith('.swagger');
};

export const resolveGeneratedCounterpartCandidatesForPath = (
  candidatePath,
  { includeOpenApiDirectoryHints = true } = {}
) => {
  const normalized = normalizeRelPath(candidatePath);
  if (!normalized) return [];
  const counterpartCandidates = new Set();
  const addCandidate = (value) => {
    const rel = normalizeRelPath(value);
    if (rel) counterpartCandidates.add(rel);
  };

  const pb2Base = normalized.replace(/_pb2(?:_grpc)?\.(?:py|pyi)$/i, '');
  if (pb2Base !== normalized) {
    addCandidate(`${pb2Base}.proto`);
  }

  const grpcPbBase = stripGrpcPbGeneratedBase(normalized);
  if (grpcPbBase !== normalized) {
    addCandidate(`${grpcPbBase}.proto`);
  }

  const pbBase = stripPbGeneratedBase(normalized);
  if (pbBase !== normalized) {
    addCandidate(`${pbBase}.proto`);
  }

  const dartBase = normalized.replace(/\.g\.dart$/i, '');
  if (dartBase !== normalized) {
    addCandidate(`${dartBase}.dart`);
  }

  const generatedGraph = normalized.replace(/\.generated(?=\.[^./]+(?:\.[^./]+)?$)/i, '');
  if (generatedGraph !== normalized) {
    const graphStem = generatedGraph.replace(/\.[^./]+(?:\.[^./]+)?$/i, '');
    if (graphStem) {
      addCandidate(`${graphStem}.graphql`);
      addCandidate(`${graphStem}.gql`);
    }
  }

  if (GENERATED_DIR_SEGMENT_RX.test(normalized.toLowerCase())) {
    const collapsed = normalized.replace(/\/(?:__generated__|generated|gen)\//i, '/');
    addCandidate(collapsed);
    if (collapsed !== normalized) {
      for (const nested of resolveGeneratedCounterpartCandidatesForPath(collapsed, {
        includeOpenApiDirectoryHints
      })) {
        addCandidate(nested);
      }
    }
  }

  const candidateExt = path.posix.extname(normalized);
  const candidateBase = candidateExt
    ? normalized.slice(0, -candidateExt.length)
    : normalized;
  const openApiBases = new Set([candidateBase]);
  openApiBases.add(candidateBase.replace(/(?:[-_.](?:generated|gen))$/i, ''));
  openApiBases.add(candidateBase.replace(/(?:[-_.](?:client|types?|schemas?|api))$/i, ''));
  openApiBases.add(
    candidateBase
      .replace(/(?:[-_.](?:generated|gen))$/i, '')
      .replace(/(?:[-_.](?:client|types?|schemas?|api))$/i, '')
  );
  let hasOpenApiHints = false;
  for (const openApiBase of openApiBases.values()) {
    const normalizedBase = normalizeRelPath(openApiBase);
    if (!normalizedBase) continue;
    const baseIsOpenApi = looksLikeOpenApiBase(normalizedBase);
    if (baseIsOpenApi) hasOpenApiHints = true;
    for (const suffix of OPENAPI_SOURCE_SUFFIXES) {
      addCandidate(`${normalizedBase}${suffix}`);
    }
    if (baseIsOpenApi) {
      for (const extension of OPENAPI_SOURCE_DIRECT_EXTENSIONS) {
        addCandidate(`${normalizedBase}${extension}`);
      }
    }
  }
  const shouldAddDirectoryHints = includeOpenApiDirectoryHints === true
    || (includeOpenApiDirectoryHints === 'when-openapi-base' && hasOpenApiHints);
  const dir = path.posix.dirname(normalized);
  if (shouldAddDirectoryHints && dir && dir !== '.') {
    for (const basenameHint of OPENAPI_BASENAME_HINTS.values()) {
      for (const extension of OPENAPI_SOURCE_DIRECT_EXTENSIONS) {
        addCandidate(path.posix.join(dir, `${basenameHint}${extension}`));
      }
    }
  }

  return Array.from(counterpartCandidates.values());
};
