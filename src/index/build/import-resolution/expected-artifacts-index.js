import path from 'node:path';
import { sha1 } from '../../../shared/hash.js';
import { normalizeRelPath, sortStrings } from './path-utils.js';
import { toSpecifierCandidatePaths } from './candidate-paths.js';
import {
  OPENAPI_BASENAME_HINTS,
  resolveGeneratedCounterpartCandidatesForPath
} from './generated-counterpart-suffix.js';

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
  '.generated.d.ts',
  '.gen.ts',
  '.gen.js',
  '.types.ts',
  '.types.js',
  '-generated.ts',
  '-generated.js'
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

const addIfSetMissing = (target, value) => {
  if (value) target.add(value);
};

const addCounterpartCandidates = (candidateRel, targetSet) => {
  if (!candidateRel) return;
  for (const counterpart of resolveGeneratedCounterpartCandidatesForPath(candidateRel, {
    includeOpenApiDirectoryHints: 'when-openapi-base'
  })) {
    addIfSetMissing(targetSet, counterpart);
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
