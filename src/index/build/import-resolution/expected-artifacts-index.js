import path from 'node:path';
import { sha1 } from '../../../shared/hash.js';
import { normalizeImportSpecifier, normalizeRelPath, sortStrings } from './path-utils.js';

const GENERATED_DIR_SEGMENT_RX = /\/(?:__generated__|generated|gen)\//i;
const GENERATED_DIR_HINTS = Object.freeze([
  '/generated/',
  '/gen/',
  '/__generated__/'
]);
const GENERATED_TOKEN_HINTS = Object.freeze([
  '.generated.',
  '.gen.',
  '_generated',
  '.pb.',
  '.g.dart',
  '.designer.'
]);
const PROTO_GENERATED_SUFFIXES = Object.freeze([
  '.pb.ts',
  '.pb.js',
  '.pb.go',
  '.pb.swift',
  '.pb.java',
  '.pb.cc',
  '.pb.h',
  '_pb2.py',
  '_pb2.pyi',
  '_pb2_grpc.py',
  '.grpc.pb.ts',
  '.grpc.pb.go'
]);
const GRAPHQL_GENERATED_SUFFIXES = Object.freeze([
  '.generated.ts',
  '.generated.js',
  '.generated.tsx',
  '.generated.jsx',
  '.generated.d.ts'
]);
const OPENAPI_GENERATED_SUFFIXES = Object.freeze([
  '.gen.ts',
  '.generated.ts',
  '.client.ts',
  '.client.js',
  '.types.ts',
  '.schemas.ts',
  '.api.ts'
]);
const OPENAPI_SOURCE_SUFFIXES = Object.freeze([
  '.openapi.yaml',
  '.openapi.yml',
  '.openapi.json',
  '.swagger.yaml',
  '.swagger.yml',
  '.swagger.json'
]);
const OPENAPI_SOURCE_DIRECT_EXTENSIONS = Object.freeze(['.yaml', '.yml', '.json']);
const OPENAPI_BASENAME_HINTS = new Set(['openapi', 'swagger']);
const GENERATED_SUBDIRS = Object.freeze(['generated', '__generated__', 'gen']);

const normalizePathToken = (value) => (
  typeof value === 'string'
    ? normalizeRelPath(value.trim().replace(/\\/g, '/'))
    : ''
);

const toEntryRelPath = (entry) => {
  if (typeof entry === 'string') return normalizePathToken(entry);
  if (entry && typeof entry === 'object' && typeof entry.rel === 'string') {
    return normalizePathToken(entry.rel);
  }
  return '';
};

const isRelativeOrRootSpecifier = (specifier) => (
  specifier.startsWith('.') || specifier.startsWith('/')
);

const toSpecifierCandidatePaths = ({ importer = '', specifier = '' } = {}) => {
  const normalizedSpecifier = normalizeImportSpecifier(specifier);
  if (!normalizedSpecifier || !isRelativeOrRootSpecifier(normalizedSpecifier)) return [];
  const importerRel = normalizePathToken(importer);
  const candidates = [];
  if (normalizedSpecifier.startsWith('/')) {
    const rooted = normalizePathToken(normalizedSpecifier.slice(1));
    if (rooted) candidates.push(rooted);
  } else if (importerRel) {
    const importerDir = path.posix.dirname(importerRel);
    const joined = normalizePathToken(path.posix.join(importerDir, normalizedSpecifier));
    if (joined) candidates.push(joined);
  } else {
    const fallback = normalizePathToken(normalizedSpecifier);
    if (fallback) candidates.push(fallback);
  }
  return Array.from(new Set(candidates));
};

const addIfSetMissing = (target, value) => {
  if (value) target.add(value);
};

const looksLikeOpenApiBase = (baseRel) => {
  const normalized = normalizePathToken(baseRel);
  if (!normalized) return false;
  const base = path.posix.basename(normalized).toLowerCase();
  return OPENAPI_BASENAME_HINTS.has(base) || base.endsWith('.openapi') || base.endsWith('.swagger');
};

const addCounterpartCandidates = (candidateRel, targetSet) => {
  if (!candidateRel) return;
  const normalized = normalizePathToken(candidateRel);
  if (!normalized) return;
  const lower = normalized.toLowerCase();

  const pb2Base = normalized.replace(/_pb2(?:_grpc)?\.(?:py|pyi)$/i, '');
  if (pb2Base !== normalized) {
    addIfSetMissing(targetSet, `${pb2Base}.proto`);
  }

  const grpcPbBase = normalized.replace(/\.grpc\.pb(?:\.[^/]+)+$/i, '');
  if (grpcPbBase !== normalized) {
    addIfSetMissing(targetSet, `${grpcPbBase}.proto`);
  }

  const pbBase = normalized.replace(/\.pb(?:\.[^/]+)+$/i, '');
  if (pbBase !== normalized) {
    addIfSetMissing(targetSet, `${pbBase}.proto`);
  }

  const dartBase = normalized.replace(/\.g\.dart$/i, '');
  if (dartBase !== normalized) {
    addIfSetMissing(targetSet, `${dartBase}.dart`);
  }

  const generatedGraph = normalized.replace(/\.generated(?=\.[^./]+(?:\.[^./]+)?$)/i, '');
  if (generatedGraph !== normalized) {
    const graphStem = generatedGraph.replace(/\.[^./]+(?:\.[^./]+)?$/i, '');
    if (graphStem) {
      addIfSetMissing(targetSet, `${graphStem}.graphql`);
      addIfSetMissing(targetSet, `${graphStem}.gql`);
    }
  }

  if (GENERATED_DIR_SEGMENT_RX.test(lower)) {
    const collapsed = normalized.replace(/\/(?:__generated__|generated|gen)\//i, '/');
    addIfSetMissing(targetSet, collapsed);
    if (collapsed !== normalized) {
      addCounterpartCandidates(collapsed, targetSet);
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
  for (const openApiBase of openApiBases) {
    const normalizedBase = normalizePathToken(openApiBase);
    if (!normalizedBase) continue;
    for (const suffix of OPENAPI_SOURCE_SUFFIXES) {
      addIfSetMissing(targetSet, `${normalizedBase}${suffix}`);
    }
    if (looksLikeOpenApiBase(normalizedBase)) {
      for (const ext of OPENAPI_SOURCE_DIRECT_EXTENSIONS) {
        addIfSetMissing(targetSet, `${normalizedBase}${ext}`);
      }
    }
  }
  const dir = path.posix.dirname(normalized);
  if (dir && dir !== '.') {
    for (const basenameHint of OPENAPI_BASENAME_HINTS) {
      for (const ext of ['.yaml', '.yml', '.json']) {
        addIfSetMissing(targetSet, normalizePathToken(path.posix.join(dir, `${basenameHint}${ext}`)));
      }
    }
  }
};

const buildExpectedArtifactPaths = (protoStems, graphqlStems, dartStems, openApiStems) => {
  const expectedPaths = new Set();
  for (const protoStem of protoStems) {
    for (const suffix of PROTO_GENERATED_SUFFIXES) {
      expectedPaths.add(`${protoStem}${suffix}`);
    }
    const dir = path.posix.dirname(protoStem);
    const base = path.posix.basename(protoStem);
    for (const subdir of GENERATED_SUBDIRS) {
      for (const suffix of PROTO_GENERATED_SUFFIXES) {
        expectedPaths.add(normalizePathToken(path.posix.join(dir, subdir, `${base}${suffix}`)));
      }
    }
  }
  for (const graphqlStem of graphqlStems) {
    for (const suffix of GRAPHQL_GENERATED_SUFFIXES) {
      expectedPaths.add(`${graphqlStem}${suffix}`);
    }
    const dir = path.posix.dirname(graphqlStem);
    const base = path.posix.basename(graphqlStem);
    for (const subdir of GENERATED_SUBDIRS) {
      expectedPaths.add(normalizePathToken(path.posix.join(dir, subdir, `${base}.ts`)));
      expectedPaths.add(normalizePathToken(path.posix.join(dir, subdir, `${base}.js`)));
    }
  }
  for (const dartStem of dartStems) {
    expectedPaths.add(`${dartStem}.g.dart`);
  }
  for (const openApiStem of openApiStems) {
    for (const suffix of OPENAPI_GENERATED_SUFFIXES) {
      expectedPaths.add(`${openApiStem}${suffix}`);
    }
    const dir = path.posix.dirname(openApiStem);
    const base = path.posix.basename(openApiStem);
    const normalizedBase = base
      .replace(/(?:\.openapi|\.swagger)$/i, '');
    if (normalizedBase && normalizedBase !== base) {
      for (const suffix of OPENAPI_GENERATED_SUFFIXES) {
        expectedPaths.add(normalizePathToken(path.posix.join(dir, `${normalizedBase}${suffix}`)));
      }
      expectedPaths.add(normalizePathToken(path.posix.join(dir, `${normalizedBase}-client.ts`)));
      expectedPaths.add(normalizePathToken(path.posix.join(dir, `${normalizedBase}-types.ts`)));
    }
    if (OPENAPI_BASENAME_HINTS.has(base.toLowerCase())) {
      expectedPaths.add(normalizePathToken(path.posix.join(dir, 'client.ts')));
      expectedPaths.add(normalizePathToken(path.posix.join(dir, 'types.ts')));
      expectedPaths.add(normalizePathToken(path.posix.join(dir, 'schemas.ts')));
      expectedPaths.add(normalizePathToken(path.posix.join(dir, 'api.ts')));
    }
    for (const subdir of GENERATED_SUBDIRS) {
      for (const suffix of OPENAPI_GENERATED_SUFFIXES) {
        expectedPaths.add(normalizePathToken(path.posix.join(dir, subdir, `${base}${suffix}`)));
      }
      if (OPENAPI_BASENAME_HINTS.has(base.toLowerCase())) {
        expectedPaths.add(normalizePathToken(path.posix.join(dir, subdir, 'client.ts')));
        expectedPaths.add(normalizePathToken(path.posix.join(dir, subdir, 'types.ts')));
        expectedPaths.add(normalizePathToken(path.posix.join(dir, subdir, 'schemas.ts')));
        expectedPaths.add(normalizePathToken(path.posix.join(dir, subdir, 'api.ts')));
      }
    }
  }
  expectedPaths.delete('');
  return expectedPaths;
};

const buildIndexFingerprint = ({ expectedPaths, indexedFiles }) => {
  const expectedSerialized = Array.from(expectedPaths).sort(sortStrings).join('|');
  const indexedSerialized = Array.from(indexedFiles).sort(sortStrings).join('|');
  return sha1(`expected-artifacts-index-v2|${expectedSerialized}|${indexedSerialized}`);
};

const hasHeuristicGeneratedHints = ({ importer = '', specifier = '' } = {}) => {
  const normalizedImporter = normalizePathToken(importer).toLowerCase();
  const normalizedSpecifier = normalizePathToken(specifier).toLowerCase();
  if (!normalizedImporter && !normalizedSpecifier) return false;
  const importerHit = GENERATED_DIR_HINTS.some((hint) => normalizedImporter.includes(hint));
  const specifierSegmentHit = GENERATED_DIR_HINTS.some((hint) => normalizedSpecifier.includes(hint));
  const specifierTokenHit = GENERATED_TOKEN_HINTS.some((hint) => normalizedSpecifier.includes(hint));
  return importerHit || specifierSegmentHit || specifierTokenHit;
};

/**
 * Build a deterministic repo-scoped index of expected generated artifacts.
 * This stays immutable for the current import-resolution run.
 */
export const createExpectedArtifactsIndex = ({ entries = [] } = {}) => {
  const indexedFiles = new Set();
  const protoStems = new Set();
  const graphqlStems = new Set();
  const dartStems = new Set();
  const openApiStems = new Set();
  for (const entry of entries || []) {
    const rel = toEntryRelPath(entry);
    if (!rel) continue;
    indexedFiles.add(rel);
    const ext = path.posix.extname(rel).toLowerCase();
    if (!ext) continue;
    const stem = rel.slice(0, -ext.length);
    if (!stem) continue;
    if (ext === '.proto') {
      protoStems.add(stem);
    } else if (ext === '.graphql' || ext === '.gql') {
      graphqlStems.add(stem);
    } else if (ext === '.dart') {
      dartStems.add(stem);
    } else if (ext === '.yaml' || ext === '.yml' || ext === '.json') {
      const base = path.posix.basename(stem).toLowerCase();
      if (
        OPENAPI_BASENAME_HINTS.has(base)
        || base.endsWith('.openapi')
        || base.endsWith('.swagger')
      ) {
        openApiStems.add(stem);
      }
    }
  }

  const expectedPaths = buildExpectedArtifactPaths(protoStems, graphqlStems, dartStems, openApiStems);
  const fingerprint = buildIndexFingerprint({ expectedPaths, indexedFiles });

  const match = ({ importer = '', specifier = '' } = {}) => {
    const candidates = toSpecifierCandidatePaths({ importer, specifier });
    for (const candidate of candidates) {
      if (expectedPaths.has(candidate)) {
        return {
          matched: true,
          source: 'index',
          matchType: 'expected_output_path',
          candidate
        };
      }
      const counterpartCandidates = new Set();
      addCounterpartCandidates(candidate, counterpartCandidates);
      for (const counterpart of counterpartCandidates) {
        if (indexedFiles.has(counterpart)) {
          return {
            matched: true,
            source: 'index',
            matchType: 'source_counterpart',
            candidate,
            sourcePath: counterpart
          };
        }
      }
    }
    if (hasHeuristicGeneratedHints({ importer, specifier })) {
      return {
        matched: true,
        source: 'heuristic',
        matchType: 'token_hint'
      };
    }
    return {
      matched: false,
      source: 'none',
      matchType: null
    };
  };

  return Object.freeze({
    version: 'expected-artifacts-index-v2',
    fingerprint,
    indexedFileCount: indexedFiles.size,
    expectedPathCount: expectedPaths.size,
    match
  });
};
