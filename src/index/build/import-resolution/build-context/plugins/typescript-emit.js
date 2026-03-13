import path from 'node:path';
import { readJsoncFile } from '../../../../../shared/jsonc.js';
import { createFsMemo } from '../../fs-meta.js';
import { normalizeImportSpecifier, resolveWithinRoot, sortStrings } from '../../path-utils.js';
import { resolveTsConfigExtends } from '../../tsconfig-resolution.js';
import { toSpecifierCandidatePaths } from '../../candidate-paths.js';
import { IMPORT_REASON_CODES } from '../../reason-codes.js';

const EMIT_SOURCE_EXTENSIONS = Object.freeze(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const EMIT_OUTPUT_JS_EXTENSIONS = Object.freeze(['.js', '.jsx', '.mjs', '.cjs']);
const EMIT_DECLARATION_EXTENSIONS = Object.freeze(['.d.ts', '.d.mts', '.d.cts']);

const normalizeRelPathToken = (value) => (
  typeof value === 'string'
    ? value.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
    : ''
);

const toEntryRelPath = (entry) => {
  if (typeof entry === 'string') return normalizeRelPathToken(entry);
  if (entry && typeof entry === 'object' && typeof entry.rel === 'string') {
    return normalizeRelPathToken(entry.rel);
  }
  return '';
};

const stableUniqueSorted = (values) => (
  Array.from(new Set(values.filter(Boolean))).sort(sortStrings)
);

const resolveSourceCandidatesForOutput = ({ sourceRootRel, outputRelativePath }) => {
  const sourceBase = normalizeRelPathToken(path.posix.join(sourceRootRel, outputRelativePath));
  if (!sourceBase) return [];
  const outputExt = path.posix.extname(sourceBase).toLowerCase();
  const stripExt = (value, ext) => value.slice(0, value.length - ext.length);
  const candidates = new Set();
  const pushWithSourceExts = (stem) => {
    if (!stem) return;
    for (const extension of EMIT_SOURCE_EXTENSIONS) {
      candidates.add(`${stem}${extension}`);
      candidates.add(`${stem}/index${extension}`);
    }
  };

  if (!outputExt) {
    pushWithSourceExts(sourceBase);
    return stableUniqueSorted(Array.from(candidates));
  }

  if (EMIT_OUTPUT_JS_EXTENSIONS.includes(outputExt)) {
    pushWithSourceExts(stripExt(sourceBase, outputExt));
  } else if (sourceBase.endsWith('.d.ts')) {
    pushWithSourceExts(stripExt(sourceBase, '.d.ts'));
  } else if (sourceBase.endsWith('.d.mts')) {
    pushWithSourceExts(stripExt(sourceBase, '.d.mts'));
  } else if (sourceBase.endsWith('.d.cts')) {
    pushWithSourceExts(stripExt(sourceBase, '.d.cts'));
  }

  if (EMIT_DECLARATION_EXTENSIONS.includes(outputExt)) {
    pushWithSourceExts(stripExt(sourceBase, outputExt));
  }

  candidates.add(sourceBase);
  return stableUniqueSorted(Array.from(candidates));
};

const loadTsConfigEmitProfile = ({
  tsconfigAbs,
  rootAbs,
  fsMemo,
  cache,
  stack = new Set()
}) => {
  if (!tsconfigAbs || stack.has(tsconfigAbs)) return null;
  const stat = fsMemo.statSync(tsconfigAbs);
  if (!stat) return null;
  const cacheKey = `${tsconfigAbs}\u0000${Number(stat.mtimeMs) || 0}\u0000${Number(stat.size) || 0}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  stack.add(tsconfigAbs);
  let parsed = null;
  try {
    parsed = readJsoncFile(tsconfigAbs);
  } catch {}
  const baseDir = path.dirname(tsconfigAbs);
  const extendsPath = resolveTsConfigExtends(baseDir, parsed?.extends);
  const inherited = extendsPath
    ? loadTsConfigEmitProfile({
      tsconfigAbs: extendsPath,
      rootAbs,
      fsMemo,
      cache,
      stack
    })
    : null;
  stack.delete(tsconfigAbs);

  const compilerOptions = parsed?.compilerOptions && typeof parsed.compilerOptions === 'object'
    ? parsed.compilerOptions
    : {};
  const inheritedCompiler = inherited?.compilerOptions || {};
  const mergedCompiler = { ...inheritedCompiler, ...compilerOptions };
  const rootDirRaw = typeof mergedCompiler.rootDir === 'string' ? mergedCompiler.rootDir.trim() : '';
  const outDirRaw = typeof mergedCompiler.outDir === 'string' ? mergedCompiler.outDir.trim() : '';
  const declarationDirRaw = typeof mergedCompiler.declarationDir === 'string'
    ? mergedCompiler.declarationDir.trim()
    : '';

  const sourceRootAbs = path.resolve(baseDir, rootDirRaw || '.');
  const sourceRootRel = resolveWithinRoot(rootAbs, sourceRootAbs);
  const outDirRel = outDirRaw
    ? resolveWithinRoot(rootAbs, path.resolve(baseDir, outDirRaw))
    : (inherited?.outDirRel || null);
  const declarationDirRel = declarationDirRaw
    ? resolveWithinRoot(rootAbs, path.resolve(baseDir, declarationDirRaw))
    : (inherited?.declarationDirRel || null);
  const tsconfigRel = resolveWithinRoot(rootAbs, tsconfigAbs);

  const profile = {
    tsconfigRel: tsconfigRel || null,
    compilerOptions: mergedCompiler,
    sourceRootRel: sourceRootRel || '',
    outDirRel: outDirRel || null,
    declarationDirRel: declarationDirRel || null
  };
  cache.set(cacheKey, profile);
  return profile;
};

const resolvePluginFingerprint = (mappings) => {
  const payload = mappings
    .map((entry) => [
      entry.tsconfigRel || '',
      entry.sourceRootRel,
      entry.outDirRel || '',
      entry.declarationDirRel || ''
    ].join('|'))
    .join('||');
  return payload || 'none';
};

const collectMappings = ({ entries, rootAbs, fsMemo }) => {
  if (!rootAbs) return [];
  const indexedFiles = stableUniqueSorted((entries || []).map((entry) => toEntryRelPath(entry)).filter(Boolean));
  const tsconfigPaths = indexedFiles
    .filter((rel) => rel === 'tsconfig.json' || rel.endsWith('/tsconfig.json'))
    .sort(sortStrings);
  if (!tsconfigPaths.length) return [];

  const profiles = [];
  const cache = new Map();
  for (const tsconfigRel of tsconfigPaths) {
    const tsconfigAbs = path.resolve(rootAbs, tsconfigRel);
    const profile = loadTsConfigEmitProfile({
      tsconfigAbs,
      rootAbs,
      fsMemo,
      cache
    });
    if (!profile) continue;
    if (!profile.outDirRel && !profile.declarationDirRel) continue;
    if (!profile.sourceRootRel) continue;
    profiles.push(profile);
  }

  return profiles
    .map((profile) => ({
      tsconfigRel: profile.tsconfigRel,
      sourceRootRel: profile.sourceRootRel,
      outDirRel: profile.outDirRel,
      declarationDirRel: profile.declarationDirRel
    }))
    .sort((a, b) => (
      sortStrings(a.tsconfigRel || '', b.tsconfigRel || '')
      || sortStrings(a.sourceRootRel, b.sourceRootRel)
      || sortStrings(a.outDirRel || '', b.outDirRel || '')
      || sortStrings(a.declarationDirRel || '', b.declarationDirRel || '')
    ));
};

const resolveTsEmitExpectedMatch = ({ candidate, mappings, indexedFiles }) => {
  for (const mapping of mappings) {
    const outputRoots = [mapping.outDirRel, mapping.declarationDirRel].filter(Boolean);
    for (const outputRoot of outputRoots) {
      const prefix = `${outputRoot}/`;
      if (!(candidate === outputRoot || candidate.startsWith(prefix))) continue;
      const relativeFromOutput = candidate === outputRoot
        ? ''
        : candidate.slice(prefix.length);
      const sourceCandidates = resolveSourceCandidatesForOutput({
        sourceRootRel: mapping.sourceRootRel,
        outputRelativePath: relativeFromOutput
      });
      const sourcePath = sourceCandidates.find((sourceRel) => indexedFiles.has(sourceRel));
      if (!sourcePath) continue;
      return {
        matched: true,
        source: 'plugin',
        matchType: 'typescript_emit',
        candidate,
        sourcePath,
        tsconfigPath: mapping.tsconfigRel || null
      };
    }
  }
  return null;
};

export const createTypeScriptEmitPlugin = ({
  entries = [],
  rootAbs = '',
  fsMemo = null
} = {}) => {
  const normalizedRoot = typeof rootAbs === 'string' && rootAbs.trim() ? rootAbs : '';
  const io = fsMemo || createFsMemo();
  const indexedFiles = new Set();
  for (const entry of entries || []) {
    const rel = toEntryRelPath(entry);
    if (rel) indexedFiles.add(rel);
  }
  const mappings = collectMappings({
    entries,
    rootAbs: normalizedRoot,
    fsMemo: io
  });

  const classify = ({ importerRel = '', spec = '', rawSpec = '' } = {}) => {
    if (mappings.length === 0) return null;
    const normalizedSpecifier = normalizeImportSpecifier(spec || rawSpec);
    const candidates = toSpecifierCandidatePaths({
      importer: importerRel,
      specifier: normalizedSpecifier || rawSpec
    });
    for (const candidate of candidates) {
      const match = resolveTsEmitExpectedMatch({
        candidate,
        mappings,
        indexedFiles
      });
      if (!match) continue;
      return {
        reasonCode: IMPORT_REASON_CODES.GENERATED_EXPECTED_MISSING,
        pluginId: 'typescript-emit',
        match
      };
    }
    return null;
  };

  return Object.freeze({
    id: 'typescript-emit',
    priority: 18,
    fingerprint: resolvePluginFingerprint(mappings),
    classify
  });
};
