import path from 'node:path';
import { buildCacheKey } from '../../../shared/cache-key.js';
import { sha1 } from '../../../shared/hash.js';
import {
  DEFAULT_IMPORT_EXTS,
  EPHEMERAL_EXTERNAL_CACHE_TTL_MS,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
  MAX_IMPORT_WARNINGS,
  MAX_RESOLUTION_CACHE_ENTRIES,
  NEGATIVE_CACHE_TTL_MS
} from './constants.js';
import { resolveRelativeImportCandidates } from '../../shared/import-candidates.js';
import { createFsMemo } from './fs-meta.js';
import { addGraphNode, buildEdgeSortKey, buildWarningSortKey } from './graph.js';
import {
  buildLookupCompatibilityFingerprint,
  collectEntryFileSet,
  computeFileSetFingerprint,
  createFileLookup,
  createLookupFromSnapshot,
  createLookupSnapshot,
  resolveCandidate
} from './lookup.js';
import {
  classifyImporter,
  resolveLanguageNonRelativeImport,
  resolveLanguageRelativeImport
} from './language-resolvers.js';
import { createPackageDirectoryResolver, parsePackageName } from './package-entry.js';
import { resolveDartPackageName, resolveGoModulePath, resolvePackageFingerprint } from './repo-metadata.js';
import { createImportBuildContext } from './build-context/index.js';
import {
  createImportResolutionBudgetPolicy,
  createImportResolutionSpecifierBudgetState
} from './budgets.js';
import {
  matchGeneratedExpectationSpecifier
} from './specifier-hints.js';
import { normalizeImportSpecifier, normalizeRelPath, resolveWithinRoot, sortStrings } from './path-utils.js';
import {
  IMPORT_REASON_CODES,
  IMPORT_RESOLUTION_STATES,
  IMPORT_RESOLVER_STAGES,
  assertUnresolvedDecision,
  createUnresolvedDecision,
  isActionableDisposition,
} from './reason-codes.js';
import { createImportResolutionStageTracker } from './stage-pipeline.js';
import { createTsConfigLoader, resolveTsPaths } from './tsconfig-resolution.js';

const ABSOLUTE_SYSTEM_PATH_PREFIX_RX = /^\/(?:etc|usr|opt|var|bin|sbin|lib|lib64|dev|proc|sys|run|tmp|home|root)(?:\/|$)/i;
const SCHEME_RELATIVE_URL_RX = /^\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/:]|$)/i;
const DEFAULT_UNRESOLVED_NOISE_PREFIXES = ['node:', '@types/', 'internal/'];

const normalizeAliasRuleText = (value) => (
  typeof value === 'string'
    ? value.trim().replace(/\\/g, '/')
    : ''
);

const normalizeAliasRule = (value, index = 0) => {
  if (!value || typeof value !== 'object') return null;
  const match = normalizeAliasRuleText(
    value.match || value.from || value.find || value.pattern || value.alias
  );
  const replace = normalizeAliasRuleText(
    value.replace || value.to || value.target || value.path
  );
  if (!match || !replace) return null;
  const matchWildcard = match.endsWith('/*');
  const replaceWildcard = replace.endsWith('/*');
  if (matchWildcard !== replaceWildcard) return null;
  const prefixMode = matchWildcard || match.endsWith('/');
  const matchPrefix = matchWildcard ? match.slice(0, -1) : match;
  const replacePrefix = replaceWildcard ? replace.slice(0, -1) : replace;
  if (!matchPrefix || !replacePrefix) return null;
  return {
    id: `alias_${index}`,
    match,
    replace,
    prefixMode,
    matchPrefix,
    replacePrefix
  };
};

const normalizeAliasRulesFromMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const rules = [];
  let index = 0;
  for (const [match, replace] of Object.entries(value)) {
    const rule = normalizeAliasRule({ match, replace }, index);
    index += 1;
    if (rule) rules.push(rule);
  }
  return rules;
};

const normalizeResolverAliasRules = (resolverPlugins) => {
  if (!resolverPlugins || typeof resolverPlugins !== 'object') return [];
  const aliasSource = resolverPlugins.alias || resolverPlugins.aliases || null;
  if (!aliasSource) return [];
  const rules = [];
  if (Array.isArray(aliasSource)) {
    for (let i = 0; i < aliasSource.length; i += 1) {
      const rule = normalizeAliasRule(aliasSource[i], i);
      if (rule) rules.push(rule);
    }
    return rules;
  }
  if (aliasSource && typeof aliasSource === 'object' && Array.isArray(aliasSource.rules)) {
    for (let i = 0; i < aliasSource.rules.length; i += 1) {
      const rule = normalizeAliasRule(aliasSource.rules[i], i);
      if (rule) rules.push(rule);
    }
    return rules;
  }
  return normalizeAliasRulesFromMap(aliasSource);
};

const applyAliasRuleToSpecifier = ({ spec, rule }) => {
  if (!spec || !rule) return null;
  if (rule.prefixMode) {
    if (!spec.startsWith(rule.matchPrefix)) return null;
    const suffix = spec.slice(rule.matchPrefix.length);
    return `${rule.replacePrefix}${suffix}`;
  }
  if (spec === rule.match) return rule.replace;
  const matchPrefix = `${rule.match}/`;
  if (spec.startsWith(matchPrefix)) {
    const suffix = spec.slice(matchPrefix.length);
    const replaceBase = rule.replace.endsWith('/') ? rule.replace.slice(0, -1) : rule.replace;
    return `${replaceBase}/${suffix}`;
  }
  return null;
};

const resolveAliasPluginImport = ({
  spec,
  aliasRules,
  lookup,
  resolvePackageDirectoryImport
}) => {
  if (!spec || !Array.isArray(aliasRules) || aliasRules.length === 0) return null;
  const candidates = [];
  const seen = new Set();
  for (const rule of aliasRules) {
    const rewritten = applyAliasRuleToSpecifier({ spec, rule });
    if (!rewritten) continue;
    const normalized = normalizeRelPath(rewritten);
    if (!normalized || normalized.startsWith('/') || seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push(normalized);
  }
  for (const candidate of candidates) {
    const resolved = resolveCandidate(candidate, lookup)
      || resolvePackageDirectoryImport(candidate);
    if (resolved) return resolved;
  }
  return null;
};

const buildAliasRulesFingerprint = (aliasRules) => {
  if (!Array.isArray(aliasRules) || aliasRules.length === 0) return null;
  const payload = aliasRules
    .map((rule) => `${rule.match}->${rule.replace}`)
    .sort(sortStrings)
    .join('|');
  return payload ? sha1(payload) : null;
};

const insertResolutionCache = (cache, key, value) => {
  if (!cache || !key) return;
  if (cache.size >= MAX_RESOLUTION_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, value);
};

const bumpCount = (target, key, amount = 1) => {
  if (!target || typeof target !== 'object') return;
  if (!key) return;
  const next = Number(target[key]) || 0;
  target[key] = next + Math.max(0, Math.floor(Number(amount) || 0));
};

const toSortedCountObject = (counts) => {
  const entries = Object.entries(counts || {})
    .filter(([key, value]) => key && Number.isFinite(Number(value)) && Number(value) > 0)
    .sort((a, b) => sortStrings(a[0], b[0]));
  const output = Object.create(null);
  for (const [key, value] of entries) {
    output[key] = Math.floor(Number(value));
  }
  return output;
};

const resolveUnresolvedReasonCode = ({
  importerRel,
  spec,
  rawSpec,
  buildContextClassification = null,
  budgetExhausted = false,
  generatedExpectationMatch = null,
  expectedArtifactsIndex = null
}) => {
  if (buildContextClassification?.reasonCode) {
    return buildContextClassification.reasonCode;
  }
  const resolvedGeneratedMatch = generatedExpectationMatch || matchGeneratedExpectationSpecifier({
    importer: importerRel,
    specifier: spec || rawSpec,
    expectedArtifactsIndex
  });
  if (resolvedGeneratedMatch?.matched) {
    return IMPORT_REASON_CODES.GENERATED_EXPECTED_MISSING;
  }
  if (budgetExhausted) {
    return IMPORT_REASON_CODES.RESOLVER_BUDGET_EXHAUSTED;
  }
  return IMPORT_REASON_CODES.MISSING_FILE_RELATIVE;
};

export function resolveImportLinks({
  root,
  entries,
  importsByFile,
  fileRelations,
  log,
  mode = null,
  enableGraph = true,
  graphMeta = null,
  cache = null,
  fileHashes = null,
  cacheStats = null,
  fsMeta = null,
  fsExistsIndex = null,
  resolverPlugins = null,
  budgetRuntimeSignals = null
}) {
  const fsMemo = createFsMemo(fsMeta);
  const cacheState = cache && typeof cache === 'object' ? cache : null;
  const cacheMetrics = cacheState
    ? (cacheStats || {
      files: 0,
      filesHashed: 0,
      filesReused: 0,
      filesInvalidated: 0,
      specs: 0,
      specsReused: 0,
      specsComputed: 0,
      packageInvalidated: false,
      fileSetInvalidated: false,
      lookupReused: false,
      lookupInvalidated: false,
      fsMetaPrefetchedPaths: Number(fsMeta?.candidateCount || 0)
    })
    : null;
  if (cacheState && (!cacheState.files || typeof cacheState.files !== 'object')) {
    cacheState.files = {};
  }
  const { rootAbs, fileSet } = collectEntryFileSet({ entries, root });
  const fileSetFingerprint = cacheState ? computeFileSetFingerprint(fileSet) : null;
  const lookupCompatibilityFingerprint = cacheState
    ? buildLookupCompatibilityFingerprint({ rootAbs, fileSetFingerprint })
    : null;
  const cachedLookup = cacheState?.lookup && typeof cacheState.lookup === 'object'
    ? cacheState.lookup
    : null;
  const canReuseLookup = !!(
    cacheState
    && cachedLookup
    && lookupCompatibilityFingerprint
    && cachedLookup.compatibilityFingerprint === lookupCompatibilityFingerprint
    && cachedLookup.fileSetFingerprint === fileSetFingerprint
    && cachedLookup.rootHash === sha1(rootAbs)
  );
  const lookup = canReuseLookup
    ? createLookupFromSnapshot({ root, snapshot: cachedLookup })
    : null;
  const resolvedLookup = lookup || createFileLookup({ entries, root, fsMemo });
  const aliasRules = normalizeResolverAliasRules(resolverPlugins);
  const aliasRulesFingerprint = buildAliasRulesFingerprint(aliasRules);
  const tsConfigResolver = createTsConfigLoader({
    rootAbs: resolvedLookup.rootAbs,
    fileSet: resolvedLookup.fileSet,
    fsMemo
  });
  const goModulePath = resolveGoModulePath(resolvedLookup.rootAbs, fsMemo);
  const dartPackageName = resolveDartPackageName(resolvedLookup.rootAbs, fsMemo);
  const buildContext = createImportBuildContext({
    entries: Array.from(resolvedLookup.fileSet || []),
    resolverPlugins
  });
  const budgetPolicy = createImportResolutionBudgetPolicy({
    resolverPlugins,
    runtimeSignals: budgetRuntimeSignals
  });
  const budgetPolicyStats = {
    maxFilesystemProbesPerSpecifier: Number(budgetPolicy?.maxFilesystemProbesPerSpecifier) || 0,
    maxFallbackCandidatesPerSpecifier: Number(budgetPolicy?.maxFallbackCandidatesPerSpecifier) || 0,
    maxFallbackDepth: Number(budgetPolicy?.maxFallbackDepth) || 0,
    adaptiveEnabled: budgetPolicy?.adaptiveEnabled === true,
    adaptiveProfile: typeof budgetPolicy?.adaptiveProfile === 'string'
      ? budgetPolicy.adaptiveProfile
      : 'normal',
    adaptiveScale: Number.isFinite(Number(budgetPolicy?.adaptiveScale))
      ? Number(Number(budgetPolicy.adaptiveScale).toFixed(3))
      : 1
  };
  const expectedArtifactsIndex = buildContext.expectedArtifactsIndex;
  const fsExistsIndexStats = {
    enabled: fsExistsIndex?.enabled !== false && typeof fsExistsIndex?.lookup === 'function',
    complete: fsExistsIndex?.complete === true,
    indexedCount: Math.max(0, Number(fsExistsIndex?.indexedCount) || 0),
    fileCount: Math.max(0, Number(fsExistsIndex?.fileCount) || 0),
    truncated: fsExistsIndex?.truncated === true,
    bloomBits: Math.max(0, Number(fsExistsIndex?.bloomBits) || 0),
    exactHits: 0,
    negativeSkips: 0,
    unknownFallbacks: 0
  };
  if (cacheMetrics && canReuseLookup && lookup) {
    cacheMetrics.lookupReused = true;
  }
  if (cacheMetrics && cachedLookup && !canReuseLookup) {
    cacheMetrics.lookupInvalidated = true;
  }
  const fileSetChanged = !!(cacheState
    && fileSetFingerprint
    && cacheState.fileSetFingerprint !== fileSetFingerprint);
  const packageFingerprint = cacheState ? resolvePackageFingerprint(resolvedLookup.rootAbs, fsMemo) : null;
  const repoHash = cacheState ? sha1(resolvedLookup.rootAbs) : null;
  const cacheKeyInfo = cacheState && fileSetFingerprint
    ? buildCacheKey({
      repoHash,
      buildConfigHash: packageFingerprint || null,
      mode,
      schemaVersion: 'import-resolution-cache-v7',
      featureFlags: [
        ...(graphMeta?.importScanMode ? [`scan:${graphMeta.importScanMode}`] : []),
        ...(aliasRulesFingerprint ? [`resolverAlias:${aliasRulesFingerprint}`] : []),
        ...(buildContext?.fingerprint ? [`buildContext:${buildContext.fingerprint}`] : []),
        ...(budgetPolicy?.fingerprint ? [`resolverBudgets:${budgetPolicy.fingerprint}`] : []),
        ...(expectedArtifactsIndex?.fingerprint ? [`expectedArtifacts:${expectedArtifactsIndex.fingerprint}`] : [])
      ],
      pathPolicy: 'posix',
      extra: { fileSetFingerprint }
    })
    : null;
  const cacheKey = cacheKeyInfo?.key || null;
  const cacheKeyChanged = !!(cacheState && cacheKey && cacheState.cacheKey && cacheState.cacheKey !== cacheKey);
  if (cacheState && packageFingerprint && cacheState.packageFingerprint
    && cacheState.packageFingerprint !== packageFingerprint) {
    if (cacheMetrics) cacheMetrics.packageInvalidated = true;
    if (typeof log === 'function') {
      log('[imports] cache invalidated: package.json fingerprint changed');
    }
    cacheState.files = {};
    cacheState.lookup = null;
  }
  if (cacheState && fileSetChanged) {
    if (cacheMetrics) cacheMetrics.fileSetInvalidated = true;
    if (typeof log === 'function') {
      log('[imports] cache invalidated: file set changed');
    }
    cacheState.files = {};
    cacheState.lookup = null;
  }
  if (cacheState && cacheKeyChanged) {
    if (typeof log === 'function') {
      log('[imports] cache invalidated: cache key changed');
    }
    cacheState.files = {};
    cacheState.lookup = null;
  }
  if (cacheState && packageFingerprint) {
    cacheState.packageFingerprint = packageFingerprint;
  }
  if (cacheState && fileSetFingerprint) {
    cacheState.fileSetFingerprint = fileSetFingerprint;
  }
  if (cacheState && cacheKey) {
    cacheState.cacheKey = cacheKey;
  }
  if (cacheState && fileSetFingerprint && lookupCompatibilityFingerprint) {
    cacheState.lookup = createLookupSnapshot({
      lookup: resolvedLookup,
      fileSetFingerprint,
      compatibilityFingerprint: lookupCompatibilityFingerprint
    });
  }

  const shouldTreatAbsoluteSpecifierAsExternal = ({ spec, importerInfo }) => {
    if (SCHEME_RELATIVE_URL_RX.test(spec || '')) return true;
    if (!spec || !spec.startsWith('/')) return false;
    if (!importerInfo) return false;
    const supportsAbsoluteExternal = importerInfo.isShell || importerInfo.isPathLike || importerInfo.isClike;
    if (!supportsAbsoluteExternal) return false;
    const normalizedAbsolute = normalizeRelPath(spec.slice(1));
    if (normalizedAbsolute && resolveCandidate(normalizedAbsolute, resolvedLookup)) return false;
    if (ABSOLUTE_SYSTEM_PATH_PREFIX_RX.test(spec)) return true;
    return importerInfo.isShell === true;
  };

  const isFileStat = (value) => {
    if (!value) return false;
    if (typeof value.isFile === 'function') return value.isFile();
    return value.isFile === true;
  };
  const canReuseEphemeralExternalCacheEntry = ({
    cacheClass = null,
    fallbackPath = null,
    expiresAt = null,
    nowMs = Date.now()
  } = {}) => {
    if (cacheClass !== 'ephemeral_external') return true;
    if (!Number.isFinite(Number(expiresAt)) || Number(expiresAt) <= nowMs) return false;
    const normalizedFallbackPath = normalizeRelPath(fallbackPath);
    if (!normalizedFallbackPath) return false;
    const fallbackAbs = path.resolve(resolvedLookup.rootAbs, normalizedFallbackPath);
    const containedRel = resolveWithinRoot(resolvedLookup.rootAbs, fallbackAbs);
    if (!containedRel) return false;
    if (resolveCandidate(containedRel, resolvedLookup)) return false;
    const fallbackStat = fsMemo.statSync(fallbackAbs);
    return isFileStat(fallbackStat);
  };

  const resolveExistingNonIndexedRelativeImport = ({
    spec,
    importerInfo,
    importerRel,
    specBudget,
    fsExistsIndexState
  }) => {
    if (!spec || typeof spec !== 'string' || !importerRel) return null;
    if (!(spec.startsWith('.') || spec.startsWith('/'))) return null;
    if (spec === '.' || spec === '..') return null;
    if (specBudget && !spec.startsWith('/')) {
      const traversalDepth = spec
        .replace(/\\/g, '/')
        .split('/')
        .reduce((count, segment) => count + (segment === '..' ? 1 : 0), 0);
      if (!specBudget.allowFallbackDepth(traversalDepth)) return null;
    }
    const baseCandidates = [];
    if (spec.startsWith('/')) {
      const absoluteTarget = normalizeRelPath(spec.slice(1));
      if (absoluteTarget) {
        baseCandidates.push(absoluteTarget);
        const htmlSourceFile = importerInfo?.extension === '.html' || importerInfo?.extension === '.htm';
        if (htmlSourceFile) {
          const importerAnchored = normalizeRelPath(path.posix.join(importerInfo.importerDir, absoluteTarget));
          if (importerAnchored) baseCandidates.unshift(importerAnchored);
        }
      }
    } else {
      const importerDir = path.posix.dirname(importerRel);
      const joined = normalizeRelPath(path.posix.join(importerDir, spec));
      if (joined) baseCandidates.push(joined);
    }
    if (!baseCandidates.length) return null;
    const seenBases = new Set();
    for (const base of baseCandidates) {
      if (!base || seenBases.has(base)) continue;
      seenBases.add(base);
      const pathExt = path.posix.extname(base);
      const candidates = pathExt
        ? [base]
        : resolveRelativeImportCandidates(base, DEFAULT_IMPORT_EXTS);
      for (const candidate of candidates) {
        if (!candidate) continue;
        if (specBudget && !specBudget.consumeFallbackCandidate()) return null;
        const candidateAbs = path.resolve(resolvedLookup.rootAbs, candidate);
        const candidateRel = resolveWithinRoot(resolvedLookup.rootAbs, candidateAbs);
        if (!candidateRel) continue;
        if (fsExistsIndexState?.enabled && typeof fsExistsIndex?.lookup === 'function') {
          const lookupState = fsExistsIndex.lookup(candidateRel);
          if (lookupState === 'present') {
            fsExistsIndexState.exactHits += 1;
            return candidateRel;
          }
          if (lookupState === 'absent') {
            fsExistsIndexState.negativeSkips += 1;
            continue;
          }
          fsExistsIndexState.unknownFallbacks += 1;
        }
        if (specBudget && !specBudget.consumeFilesystemProbe()) return null;
        const candidateStat = fsMemo.statSync(candidateAbs);
        if (isFileStat(candidateStat)) return candidateRel;
      }
    }
    return null;
  };

  const resolveFileHash = (relPath) => {
    if (!fileHashes || !relPath) return null;
    if (typeof fileHashes.get === 'function') return fileHashes.get(relPath) || null;
    if (fileHashes && typeof fileHashes === 'object') return fileHashes[relPath] || null;
    return null;
  };

  const graph = enableGraph
    ? {
      generatedAt: new Date().toISOString(),
      ...(graphMeta && typeof graphMeta === 'object' ? graphMeta : {}),
      stats: {},
      nodes: [],
      edges: [],
      warnings: []
    }
    : null;
  const graphNodes = enableGraph ? new Map() : null;
  const resolvePackageDirectoryImport = createPackageDirectoryResolver({
    lookup: resolvedLookup,
    rootAbs: resolvedLookup.rootAbs
  });
  const stageTracker = createImportResolutionStageTracker();
  const resolutionCache = new Map();
  const cacheKeyFor = (importerRel, spec, tsconfig) => {
    const tsKey = tsconfig?.fingerprint || tsconfig?.tsconfigPath || 'none';
    return `${importerRel || ''}\u0000${spec || ''}\u0000${tsKey}`;
  };
  let suppressedWarnings = 0;
  let unresolvedCount = 0;
  let unresolvedActionable = 0;
  let unresolvedBudgetExhausted = 0;
  let externalCount = 0;
  let resolvedCount = 0;
  let edgeTotal = 0;
  let truncatedEdges = 0;
  const capStats = enableGraph ? { truncatedNodes: 0 } : null;
  const truncatedByKind = { import: 0 };
  const unresolvedSamples = [];
  const unresolvedReasonCounts = Object.create(null);
  const unresolvedBudgetExhaustedByType = Object.create(null);

  const warningList = unresolvedSamples;
  const unresolvedDedup = new Set();
  const unresolvedNoiseIgnore = new Set(
    Array.isArray(graphMeta?.importScan?.noiseIgnore)
      ? graphMeta.importScan.noiseIgnore
        .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
        .filter(Boolean)
      : []
  );
  const edges = enableGraph ? graph.edges : null;
  const shouldIgnoreUnresolvedImport = ({ spec, rawSpec, importerInfo }) => {
    const normalized = typeof spec === 'string' ? spec.trim() : '';
    if (!normalized) return true;
    if (normalized === '.' || normalized === '..') return true;
    const lower = normalized.toLowerCase();
    const rawNormalized = typeof rawSpec === 'string' ? rawSpec.trim() : '';
    const lowerRaw = rawNormalized.toLowerCase();
    const importerRel = String(importerInfo?.importerRel || '').toLowerCase();
    if (DEFAULT_UNRESOLVED_NOISE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
    if (importerRel.includes('/tests/expected_output/')) return true;
    if (importerRel.includes('/unittests/') && (lower.startsWith('//./') || lowerRaw.startsWith('//./'))) return true;
    if (importerRel.endsWith('/tooling/syntax/tokenstest.cpp') && lower === './foo.h') return true;
    if (/[<>|^]/.test(normalized)) return true;
    if (ABSOLUTE_SYSTEM_PATH_PREFIX_RX.test(normalized) && (importerInfo?.isShell || importerInfo?.isPathLike)) {
      return true;
    }
    return unresolvedNoiseIgnore.has(lower) || unresolvedNoiseIgnore.has(lowerRaw);
  };

  const importsEntries = importsByFile instanceof Map
    ? Array.from(importsByFile.entries())
    : Object.entries(importsByFile || {});
  importsEntries.sort((a, b) => sortStrings(normalizeRelPath(a[0]), normalizeRelPath(b[0])));
  for (const [importerRel, rawImports] of importsEntries) {
    if (!importerRel || !Array.isArray(rawImports) || !rawImports.length) continue;
    const importLinks = new Set();
    const externalImports = new Set();
    const relNormalized = normalizeRelPath(importerRel);
    const importerInfo = classifyImporter(relNormalized);
    const importerAbs = path.resolve(resolvedLookup.rootAbs, relNormalized);
    let tsconfig = null;
    let tsconfigResolved = false;

    if (enableGraph) addGraphNode(graphNodes, `file:${relNormalized}`, 'file', capStats);

    const rawSpecs = Array.from(new Set(rawImports.filter((spec) => typeof spec === 'string' && spec)));
    rawSpecs.sort(sortStrings);
    const hasNonRelative = rawSpecs.some((rawSpec) => {
      const spec = normalizeImportSpecifier(rawSpec);
      return spec && !(spec.startsWith('.') || spec.startsWith('/'));
    });
    if (hasNonRelative && !tsconfigResolved) {
      tsconfigResolved = true;
      tsconfig = tsConfigResolver ? tsConfigResolver.resolveForFile(importerAbs) : null;
    }
    const tsconfigFingerprint = tsconfig?.fingerprint || null;
    const fileHash = resolveFileHash(relNormalized);
    const fileCache = cacheState?.files?.[relNormalized] || null;
    const canReuseCache = !!(fileCache
      && fileHash
      && fileCache.hash === fileHash
      && (fileCache.tsconfigFingerprint || null) === tsconfigFingerprint);
    if (cacheMetrics) {
      cacheMetrics.files += 1;
      if (fileHash) cacheMetrics.filesHashed += 1;
      if (fileCache && !canReuseCache && fileHash) cacheMetrics.filesInvalidated += 1;
      if (canReuseCache) cacheMetrics.filesReused += 1;
    }
    const nextSpecCache = cacheState && fileHash ? {} : null;

    for (const rawSpec of rawSpecs) {
      const spec = stageTracker.withStage(
        IMPORT_RESOLVER_STAGES.NORMALIZE,
        () => normalizeImportSpecifier(rawSpec)
      );
      if (!spec) {
        stageTracker.markMiss(IMPORT_RESOLVER_STAGES.NORMALIZE);
        continue;
      }
      stageTracker.markHit(IMPORT_RESOLVER_STAGES.NORMALIZE);
      let includeGraphEdge = true;
      const isRelative = spec.startsWith('.') || spec.startsWith('/');
      if (!isRelative && !tsconfigResolved) {
        tsconfigResolved = true;
        tsconfig = tsConfigResolver ? tsConfigResolver.resolveForFile(importerAbs) : null;
      }
      let resolvedType = null;
      let resolvedPath = null;
      let tsPathPattern = null;
      let tsconfigPath = null;
      let packageName = null;
      let unresolvedReasonCodeHint = null;
      let unresolvedBudgetExhaustedTypesHint = [];
      let cacheClass = null;
      let fallbackPath = null;
      let expiresAt = null;
      let specCacheKeyUsed = null;
      let edgeTarget = null;
      let resolutionState = IMPORT_RESOLUTION_STATES.RESOLVED;
      let unresolvedReasonCode = null;
      let unresolvedFailureCause = null;
      let unresolvedDisposition = null;
      let unresolvedResolverStage = null;
      const specBudget = createImportResolutionSpecifierBudgetState(budgetPolicy);
      let buildContextClassification = null;
      const resolveBuildContextClassification = () => {
        if (!buildContextClassification) {
          buildContextClassification = stageTracker.withStage(
            IMPORT_RESOLVER_STAGES.BUILD_SYSTEM_RESOLVER,
            () => buildContext.classifyUnresolved({
              importerRel: relNormalized,
              spec,
              rawSpec
            })
          );
          if (buildContextClassification?.reasonCode) {
            stageTracker.markHit(IMPORT_RESOLVER_STAGES.BUILD_SYSTEM_RESOLVER);
          } else {
            stageTracker.markMiss(IMPORT_RESOLVER_STAGES.BUILD_SYSTEM_RESOLVER);
          }
        }
        return buildContextClassification;
      };
      let generatedExpectationMatch = null;
      const resolveGeneratedExpectationMatch = () => {
        if (!generatedExpectationMatch) {
          const classified = resolveBuildContextClassification();
          generatedExpectationMatch = classified?.generatedMatch || null;
          if (!generatedExpectationMatch) {
            generatedExpectationMatch = matchGeneratedExpectationSpecifier({
              importer: relNormalized,
              specifier: spec || rawSpec,
              expectedArtifactsIndex
            });
          }
        }
        return generatedExpectationMatch;
      };
      const nowMs = Date.now();

      if (cacheMetrics) cacheMetrics.specs += 1;
      let cachedSpec = canReuseCache && fileCache?.specs && fileCache.specs[spec]
        ? fileCache.specs[spec]
        : null;
      if (cachedSpec && fileSetChanged) {
        cachedSpec = null;
      }
      if (cachedSpec && cachedSpec.resolvedPath && !resolvedLookup.fileSet.has(cachedSpec.resolvedPath)) {
        cachedSpec = null;
      }
      if (cachedSpec && !canReuseEphemeralExternalCacheEntry({
        cacheClass: cachedSpec.cacheClass || null,
        fallbackPath: cachedSpec.fallbackPath || null,
        expiresAt: cachedSpec.expiresAt,
        nowMs
      })) {
        cachedSpec = null;
      }
      if (cachedSpec) {
        ({
          resolvedType,
          resolvedPath,
          tsPathPattern,
          tsconfigPath,
          packageName,
          unresolvedReasonCode: unresolvedReasonCodeHint = null,
          unresolvedBudgetExhaustedTypes: unresolvedBudgetExhaustedTypesHint = [],
          cacheClass = null,
          fallbackPath = null,
          expiresAt = null
        } = cachedSpec);
        if (cacheMetrics) cacheMetrics.specsReused += 1;
      } else {
        const specCacheKey = cacheKeyFor(relNormalized, spec, tsconfig);
        specCacheKeyUsed = specCacheKey;
        let cached = resolutionCache.get(specCacheKey);
        if (cached?.expiresAt && cached.expiresAt < nowMs) {
          resolutionCache.delete(specCacheKey);
          cached = null;
        }
        if (cached && !canReuseEphemeralExternalCacheEntry({
          cacheClass: cached.cacheClass || null,
          fallbackPath: cached.fallbackPath || null,
          expiresAt: cached.expiresAt,
          nowMs
        })) {
          resolutionCache.delete(specCacheKey);
          cached = null;
        }
        if (cached) {
          ({
            resolvedType,
            resolvedPath,
            tsPathPattern,
            tsconfigPath,
            packageName,
            unresolvedReasonCode: unresolvedReasonCodeHint = null,
            unresolvedBudgetExhaustedTypes: unresolvedBudgetExhaustedTypesHint = [],
            cacheClass = null,
            fallbackPath = null,
            expiresAt = null
          } = cached);
        } else if (isRelative) {
          const base = spec.startsWith('/')
            ? normalizeRelPath(spec.slice(1))
            : normalizeRelPath(path.posix.join(path.posix.dirname(relNormalized), spec));
          const languageRelativeResolved = stageTracker.withStage(
            IMPORT_RESOLVER_STAGES.LANGUAGE_RESOLVER,
            () => resolveLanguageRelativeImport({
              spec,
              base,
              importerInfo,
              lookup: resolvedLookup
            })
          );
          if (languageRelativeResolved) {
            stageTracker.markHit(IMPORT_RESOLVER_STAGES.LANGUAGE_RESOLVER);
          } else {
            stageTracker.markMiss(IMPORT_RESOLVER_STAGES.LANGUAGE_RESOLVER);
          }
          const hasExtension = Boolean(path.posix.extname(base));
          const candidate = languageRelativeResolved
            || resolveCandidate(base, resolvedLookup)
            || (!hasExtension ? resolvePackageDirectoryImport(base) : null);
          if (candidate) {
            resolvedType = 'relative';
            resolvedPath = candidate;
          } else {
            const generatedMatch = resolveGeneratedExpectationMatch();
            const skipFallbackProbe = generatedMatch?.matched
              && generatedMatch.source === 'index';
            if (skipFallbackProbe) {
              resolvedType = 'unresolved';
            } else {
              const fallbackResult = stageTracker.withStage(
                IMPORT_RESOLVER_STAGES.FILESYSTEM_PROBE,
                () => {
                  const absoluteExternal = shouldTreatAbsoluteSpecifierAsExternal({
                    spec,
                    importerInfo
                  });
                  if (absoluteExternal) {
                    return {
                      resolvedType: 'external',
                      hit: false,
                      cacheClass: null,
                      fallbackPath: null
                    };
                  }
                  const nonIndexedLocal = resolveExistingNonIndexedRelativeImport({
                    spec,
                    importerInfo,
                    importerRel: relNormalized,
                    specBudget,
                    fsExistsIndexState: fsExistsIndexStats
                  });
                  return {
                    resolvedType: nonIndexedLocal ? 'external' : 'unresolved',
                    hit: Boolean(nonIndexedLocal),
                    cacheClass: nonIndexedLocal ? 'ephemeral_external' : null,
                    fallbackPath: nonIndexedLocal || null
                  };
                }
              );
              resolvedType = fallbackResult.resolvedType;
              if (fallbackResult.cacheClass) cacheClass = fallbackResult.cacheClass;
              if (fallbackResult.fallbackPath) fallbackPath = fallbackResult.fallbackPath;
              if (fallbackResult.hit) {
                stageTracker.markHit(IMPORT_RESOLVER_STAGES.FILESYSTEM_PROBE);
              } else {
                stageTracker.markMiss(IMPORT_RESOLVER_STAGES.FILESYSTEM_PROBE);
              }
            }
          }
        } else {
          const tsResolved = resolveTsPaths({ spec, tsconfig, lookup: resolvedLookup });
          if (tsResolved) {
            resolvedType = 'ts-path';
            resolvedPath = tsResolved.resolved;
            tsPathPattern = tsResolved.pattern;
            tsconfigPath = tsconfig?.tsconfigPath || null;
          } else {
            const aliasResolvedPath = resolveAliasPluginImport({
              spec,
              aliasRules,
              lookup: resolvedLookup,
              resolvePackageDirectoryImport
            });
            if (aliasResolvedPath) {
              resolvedType = 'plugin-alias';
              resolvedPath = aliasResolvedPath;
            } else {
              const languageResolved = stageTracker.withStage(
                IMPORT_RESOLVER_STAGES.LANGUAGE_RESOLVER,
                () => resolveLanguageNonRelativeImport({
                  importerInfo,
                  spec,
                  lookup: resolvedLookup,
                  goModulePath,
                  dartPackageName
                })
              );
              if (languageResolved) {
                stageTracker.markHit(IMPORT_RESOLVER_STAGES.LANGUAGE_RESOLVER);
                resolvedType = languageResolved.resolvedType;
                resolvedPath = languageResolved.resolvedPath;
              } else {
                stageTracker.markMiss(IMPORT_RESOLVER_STAGES.LANGUAGE_RESOLVER);
                resolvedType = 'external';
                packageName = parsePackageName(spec);
              }
            }
          }
        }

        if (!cached) {
          expiresAt = resolvedType === 'unresolved'
            ? nowMs + NEGATIVE_CACHE_TTL_MS
            : (
              cacheClass === 'ephemeral_external'
                ? nowMs + EPHEMERAL_EXTERNAL_CACHE_TTL_MS
                : null
            );
          insertResolutionCache(resolutionCache, specCacheKey, {
            resolvedType,
            resolvedPath,
            tsPathPattern,
            tsconfigPath,
            packageName,
            unresolvedReasonCode: unresolvedReasonCodeHint,
            unresolvedBudgetExhaustedTypes: unresolvedBudgetExhaustedTypesHint,
            cacheClass,
            fallbackPath,
            expiresAt
          });
        }
        if (cacheMetrics) cacheMetrics.specsComputed += 1;
      }

      if (nextSpecCache) {
        nextSpecCache[spec] = {
          resolvedType,
          resolvedPath,
          tsPathPattern,
          tsconfigPath,
          packageName,
          unresolvedReasonCode: unresolvedReasonCodeHint,
          unresolvedBudgetExhaustedTypes: unresolvedBudgetExhaustedTypesHint,
          cacheClass,
          fallbackPath,
          expiresAt
        };
      }

      if (resolvedType !== 'external' && resolvedType !== 'unresolved') {
        importLinks.add(resolvedPath);
        resolvedCount += 1;
        edgeTarget = `file:${resolvedPath}`;
        if (enableGraph) addGraphNode(graphNodes, edgeTarget, 'file', capStats);
      } else if (resolvedType === 'external') {
        externalImports.add(rawSpec);
        externalCount += 1;
        edgeTarget = `ext:${spec}`;
        if (enableGraph) addGraphNode(graphNodes, edgeTarget, 'external', capStats);
      } else {
        resolutionState = IMPORT_RESOLUTION_STATES.UNRESOLVED;
        unresolvedCount += 1;
        const unresolvedKey = `${relNormalized}\u0001${spec}`;
        const ignoredUnresolved = shouldIgnoreUnresolvedImport({
          spec,
          rawSpec,
          importerInfo
        });
        const unresolvedDecision = stageTracker.withStage(
          IMPORT_RESOLVER_STAGES.CLASSIFY,
          () => assertUnresolvedDecision(
            ignoredUnresolved
              ? createUnresolvedDecision(IMPORT_REASON_CODES.PARSER_NOISE_SUPPRESSED)
              : (
                unresolvedReasonCodeHint
                  ? createUnresolvedDecision(unresolvedReasonCodeHint)
                  : createUnresolvedDecision(resolveUnresolvedReasonCode({
                    importerRel: relNormalized,
                    spec,
                    rawSpec,
                    buildContextClassification: resolveBuildContextClassification(),
                    budgetExhausted: specBudget.isExhausted(),
                    generatedExpectationMatch: resolveGeneratedExpectationMatch(),
                    expectedArtifactsIndex
                  }))
              ),
            {
              context: `imports.resolve:${relNormalized}->${spec}`
            }
          )
        );
        stageTracker.markHit(IMPORT_RESOLVER_STAGES.CLASSIFY);
        unresolvedReasonCode = unresolvedDecision.reasonCode;
        unresolvedFailureCause = unresolvedDecision.failureCause;
        unresolvedDisposition = unresolvedDecision.disposition;
        unresolvedResolverStage = unresolvedDecision.resolverStage;
        if (unresolvedReasonCode === IMPORT_REASON_CODES.RESOLVER_BUDGET_EXHAUSTED) {
          unresolvedBudgetExhausted += 1;
          const exhaustedTypes = specBudget.exhaustedTypes();
          const effectiveExhaustedTypes = exhaustedTypes.length > 0
            ? exhaustedTypes
            : (
              Array.isArray(unresolvedBudgetExhaustedTypesHint)
                ? unresolvedBudgetExhaustedTypesHint
                : []
            );
          for (const exhaustedType of effectiveExhaustedTypes) {
            bumpCount(unresolvedBudgetExhaustedByType, exhaustedType, 1);
          }
          unresolvedBudgetExhaustedTypesHint = effectiveExhaustedTypes;
        }
        if (isActionableDisposition(unresolvedDisposition)) {
          unresolvedActionable += 1;
        }
        bumpCount(unresolvedReasonCounts, unresolvedReasonCode);
        if (specCacheKeyUsed && resolutionCache.has(specCacheKeyUsed)) {
          const cachedEntry = resolutionCache.get(specCacheKeyUsed);
          if (cachedEntry && typeof cachedEntry === 'object') {
            cachedEntry.unresolvedReasonCode = unresolvedReasonCode;
            cachedEntry.unresolvedBudgetExhaustedTypes = unresolvedBudgetExhaustedTypesHint;
          }
        }
        if (nextSpecCache && nextSpecCache[spec] && typeof nextSpecCache[spec] === 'object') {
          nextSpecCache[spec].unresolvedReasonCode = unresolvedReasonCode;
          nextSpecCache[spec].unresolvedBudgetExhaustedTypes = unresolvedBudgetExhaustedTypesHint;
        }
        if (ignoredUnresolved || unresolvedDedup.has(unresolvedKey)) {
          suppressedWarnings += 1;
          includeGraphEdge = false;
        } else {
          unresolvedDedup.add(unresolvedKey);
          if (warningList.length < MAX_IMPORT_WARNINGS) {
            warningList.push({
              importer: relNormalized,
              specifier: rawSpec,
              reason: 'unresolved',
              reasonCode: unresolvedReasonCode,
              resolutionState,
              failureCause: unresolvedFailureCause,
              disposition: unresolvedDisposition,
              resolverStage: unresolvedResolverStage
            });
          } else {
            suppressedWarnings += 1;
          }
        }
      }

      if (includeGraphEdge) {
        edgeTotal += 1;
      }
      if (enableGraph && includeGraphEdge) {
        if (edges.length < MAX_GRAPH_EDGES) {
          const tsconfigRel = tsconfigPath
            ? resolveWithinRoot(resolvedLookup.rootAbs, tsconfigPath)
            : null;
          edges.push({
            from: `file:${relNormalized}`,
            to: edgeTarget,
            rawSpecifier: rawSpec,
            kind: 'import',
            resolutionState,
            resolvedType,
            resolvedPath: resolvedPath || null,
            packageName: packageName || null,
            tsconfigPath: tsconfigRel ? normalizeRelPath(tsconfigRel) : null,
            tsPathPattern: tsPathPattern || null,
            reasonCode: unresolvedReasonCode,
            failureCause: unresolvedFailureCause,
            disposition: unresolvedDisposition,
            resolverStage: unresolvedResolverStage
          });
        } else {
          truncatedEdges += 1;
          truncatedByKind.import += 1;
        }
      }
    }

    if (nextSpecCache && fileHash && cacheState) {
      cacheState.files[relNormalized] = {
        hash: fileHash,
        tsconfigFingerprint,
        specs: nextSpecCache
      };
    }
    const existing = fileRelations.get(relNormalized);
    if (existing) {
      const imports = Array.isArray(existing.imports) && existing.imports.length
        ? existing.imports
        : rawSpecs;
      fileRelations.set(relNormalized, {
        ...existing,
        imports,
        importLinks: Array.from(importLinks).sort(sortStrings),
        externalImports: Array.from(externalImports).sort(sortStrings)
      });
    }
  }

  if (enableGraph) {
    graph.warnings = warningList;
    graph.nodes = Array.from(graphNodes.values()).sort((a, b) => sortStrings(a.id, b.id));
    if (Array.isArray(edges)) {
      const sortedEdges = edges
        .map((edge) => ({ edge, key: buildEdgeSortKey(edge) }))
        .sort((a, b) => sortStrings(a.key, b.key))
        .map(({ edge }) => edge);
      graph.edges = sortedEdges;
    }
    if (Array.isArray(warningList)) {
      graph.warnings = warningList
        .map((warning) => ({ warning, key: buildWarningSortKey(warning) }))
        .sort((a, b) => sortStrings(a.key, b.key))
        .map(({ warning }) => warning);
    }
    graph.stats = {
      files: importsEntries.length,
      nodes: graphNodes.size,
      edges: edgeTotal,
      resolved: resolvedCount,
      external: externalCount,
      unresolved: unresolvedCount,
      unresolvedActionable: unresolvedActionable,
      unresolvedSuppressed: suppressedWarnings,
      unresolvedByReasonCode: toSortedCountObject(unresolvedReasonCounts),
      unresolvedBudgetExhausted,
      unresolvedBudgetExhaustedByType: toSortedCountObject(unresolvedBudgetExhaustedByType),
      truncatedEdges,
      truncatedEdgesByKind: truncatedByKind,
      truncatedNodes: capStats?.truncatedNodes ?? 0,
      maxEdges: MAX_GRAPH_EDGES,
      maxNodes: MAX_GRAPH_NODES,
      warningSuppressed: suppressedWarnings,
      resolverFsExistsIndex: fsExistsIndexStats,
      resolverBudgetPolicy: budgetPolicyStats,
      resolverPipelineStages: stageTracker.snapshot()
    };
    if (suppressedWarnings > 0 && log) {
      log(`[imports] suppressed ${suppressedWarnings} import resolution warnings.`);
    }
  }

  return {
    stats: {
      files: importsEntries.length,
      nodes: enableGraph ? graphNodes.size : null,
      edges: resolvedCount + externalCount + unresolvedCount,
      resolved: resolvedCount,
      external: externalCount,
      unresolved: unresolvedCount,
      unresolvedActionable: unresolvedActionable,
      unresolvedSuppressed: suppressedWarnings,
      unresolvedByReasonCode: toSortedCountObject(unresolvedReasonCounts),
      unresolvedBudgetExhausted,
      unresolvedBudgetExhaustedByType: toSortedCountObject(unresolvedBudgetExhaustedByType),
      truncatedEdges,
      truncatedNodes: capStats?.truncatedNodes ?? 0,
      warningSuppressed: suppressedWarnings,
      resolverFsExistsIndex: fsExistsIndexStats,
      resolverBudgetPolicy: budgetPolicyStats,
      resolverPipelineStages: stageTracker.snapshot()
    },
    graph,
    unresolvedSamples: graph?.warnings || warningList,
    unresolvedSuppressed: suppressedWarnings,
    cacheStats: cacheMetrics
  };
}
