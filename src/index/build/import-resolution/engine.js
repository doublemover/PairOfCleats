import path from 'node:path';
import { buildCacheKey } from '../../../shared/cache-key.js';
import { sha1 } from '../../../shared/hash.js';
import {
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
  MAX_IMPORT_WARNINGS,
  MAX_RESOLUTION_CACHE_ENTRIES,
  NEGATIVE_CACHE_TTL_MS
} from './constants.js';
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
import { normalizeImportSpecifier, normalizeRelPath, resolveWithinRoot, sortStrings } from './path-utils.js';
import { createTsConfigLoader, resolveTsPaths } from './tsconfig-resolution.js';

const ABSOLUTE_SYSTEM_PATH_PREFIX_RX = /^\/(?:etc|usr|opt|var|bin|sbin|lib|lib64|dev|proc|sys|run|tmp|home|root)(?:\/|$)/i;
const DEFAULT_UNRESOLVED_NOISE_PREFIXES = ['node:', '@types/', 'internal/'];

const insertResolutionCache = (cache, key, value) => {
  if (!cache || !key) return;
  if (cache.size >= MAX_RESOLUTION_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, value);
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
  fsMeta = null
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
  const tsConfigResolver = createTsConfigLoader({
    rootAbs: resolvedLookup.rootAbs,
    fileSet: resolvedLookup.fileSet,
    fsMemo
  });
  const goModulePath = resolveGoModulePath(resolvedLookup.rootAbs, fsMemo);
  const dartPackageName = resolveDartPackageName(resolvedLookup.rootAbs, fsMemo);
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
      schemaVersion: 'import-resolution-cache-v3',
      featureFlags: graphMeta?.importScanMode ? [`scan:${graphMeta.importScanMode}`] : null,
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
    if (!spec || !spec.startsWith('/')) return false;
    if (!importerInfo) return false;
    const supportsAbsoluteExternal = importerInfo.isShell || importerInfo.isPathLike || importerInfo.isClike;
    if (!supportsAbsoluteExternal) return false;
    const normalizedAbsolute = normalizeRelPath(spec.slice(1));
    if (normalizedAbsolute && resolveCandidate(normalizedAbsolute, resolvedLookup)) return false;
    if (ABSOLUTE_SYSTEM_PATH_PREFIX_RX.test(spec)) return true;
    return importerInfo.isShell === true;
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
  const resolutionCache = new Map();
  const cacheKeyFor = (importerRel, spec, tsconfig) => {
    const tsKey = tsconfig?.fingerprint || tsconfig?.tsconfigPath || 'none';
    return `${importerRel || ''}\u0000${spec || ''}\u0000${tsKey}`;
  };
  let suppressedWarnings = 0;
  let unresolvedCount = 0;
  let externalCount = 0;
  let resolvedCount = 0;
  let edgeTotal = 0;
  let truncatedEdges = 0;
  const capStats = enableGraph ? { truncatedNodes: 0 } : null;
  const truncatedByKind = { import: 0 };
  const unresolvedSamples = [];

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
  const shouldIgnoreUnresolvedImport = ({ spec, importerInfo }) => {
    const normalized = typeof spec === 'string' ? spec.trim() : '';
    if (!normalized) return true;
    if (normalized === '.' || normalized === '..') return true;
    const lower = normalized.toLowerCase();
    const importerRel = String(importerInfo?.importerRel || '').toLowerCase();
    if (DEFAULT_UNRESOLVED_NOISE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
    if (importerRel.includes('/tests/expected_output/')) return true;
    if (importerRel.includes('/unittests/') && lower.startsWith('//./')) return true;
    if (importerRel.endsWith('/tooling/syntax/tokenstest.cpp') && lower === './foo.h') return true;
    if (/[<>|^]/.test(normalized)) return true;
    if (ABSOLUTE_SYSTEM_PATH_PREFIX_RX.test(normalized) && (importerInfo?.isShell || importerInfo?.isPathLike)) {
      return true;
    }
    return unresolvedNoiseIgnore.has(lower);
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
      const spec = normalizeImportSpecifier(rawSpec);
      if (!spec) continue;
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
      let edgeTarget = null;

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
      if (cachedSpec) {
        ({
          resolvedType,
          resolvedPath,
          tsPathPattern,
          tsconfigPath,
          packageName
        } = cachedSpec);
        if (cacheMetrics) cacheMetrics.specsReused += 1;
      } else {
        const specCacheKey = cacheKeyFor(relNormalized, spec, tsconfig);
        const nowMs = Date.now();
        let cached = resolutionCache.get(specCacheKey);
        if (cached?.expiresAt && cached.expiresAt < nowMs) {
          resolutionCache.delete(specCacheKey);
          cached = null;
        }
        if (cached) {
          ({
            resolvedType,
            resolvedPath,
            tsPathPattern,
            tsconfigPath,
            packageName
          } = cached);
        } else if (isRelative) {
          const base = spec.startsWith('/')
            ? normalizeRelPath(spec.slice(1))
            : normalizeRelPath(path.posix.join(path.posix.dirname(relNormalized), spec));
          const languageRelativeResolved = resolveLanguageRelativeImport({
            spec,
            base,
            importerInfo,
            lookup: resolvedLookup
          });
          const hasExtension = Boolean(path.posix.extname(base));
          const candidate = languageRelativeResolved
            || resolveCandidate(base, resolvedLookup)
            || (!hasExtension ? resolvePackageDirectoryImport(base) : null);
          if (candidate) {
            resolvedType = 'relative';
            resolvedPath = candidate;
          } else {
            const absoluteExternal = shouldTreatAbsoluteSpecifierAsExternal({
              spec,
              importerInfo
            });
            if (absoluteExternal) {
              resolvedType = 'external';
            } else {
              resolvedType = 'unresolved';
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
            const languageResolved = resolveLanguageNonRelativeImport({
              importerInfo,
              spec,
              lookup: resolvedLookup,
              goModulePath,
              dartPackageName
            });
            if (languageResolved) {
              resolvedType = languageResolved.resolvedType;
              resolvedPath = languageResolved.resolvedPath;
            } else {
              resolvedType = 'external';
              packageName = parsePackageName(spec);
            }
          }
        }

        if (!cached) {
          const expiresAt = resolvedType === 'unresolved'
            ? nowMs + NEGATIVE_CACHE_TTL_MS
            : null;
          insertResolutionCache(resolutionCache, specCacheKey, {
            resolvedType,
            resolvedPath,
            tsPathPattern,
            tsconfigPath,
            packageName,
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
          packageName
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
        unresolvedCount += 1;
        const unresolvedKey = `${relNormalized}\u0001${spec}`;
        const ignoredUnresolved = shouldIgnoreUnresolvedImport({
          spec,
          importerInfo
        });
        if (ignoredUnresolved || unresolvedDedup.has(unresolvedKey)) {
          suppressedWarnings += 1;
          includeGraphEdge = false;
        } else {
          unresolvedDedup.add(unresolvedKey);
          if (warningList.length < MAX_IMPORT_WARNINGS) {
            warningList.push({
              importer: relNormalized,
              specifier: rawSpec,
              reason: 'unresolved'
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
            resolvedType,
            resolvedPath: resolvedPath || null,
            packageName: packageName || null,
            tsconfigPath: tsconfigRel ? normalizeRelPath(tsconfigRel) : null,
            tsPathPattern: tsPathPattern || null
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
      truncatedEdges,
      truncatedEdgesByKind: truncatedByKind,
      truncatedNodes: capStats?.truncatedNodes ?? 0,
      maxEdges: MAX_GRAPH_EDGES,
      maxNodes: MAX_GRAPH_NODES,
      warningSuppressed: suppressedWarnings
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
      truncatedEdges,
      truncatedNodes: capStats?.truncatedNodes ?? 0,
      warningSuppressed: suppressedWarnings
    },
    graph,
    unresolvedSamples: graph?.warnings || warningList,
    unresolvedSuppressed: suppressedWarnings,
    cacheStats: cacheMetrics
  };
}
