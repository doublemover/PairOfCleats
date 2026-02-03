import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readJsoncFile } from '../../shared/jsonc.js';
import { isAbsolutePath, toPosix } from '../../shared/files.js';

const DEFAULT_IMPORT_EXTS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.d.ts'
];

const MAX_IMPORT_WARNINGS = 200;
const MAX_GRAPH_EDGES = 200000;
const MAX_GRAPH_NODES = 100000;

const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

const stripSpecifier = (spec) => {
  if (typeof spec !== 'string') return '';
  const raw = spec.split(/[?#]/)[0];
  return raw.trim();
};

const normalizeRelPath = (value) => {
  if (!value) return '';
  const normalized = path.posix.normalize(String(value).replace(/\\/g, '/'));
  return normalized.replace(/^\.\/?/, '');
};

const resolveWithinRoot = (rootAbs, absPath) => {
  const rel = path.relative(rootAbs, absPath);
  if (!rel || rel.startsWith('..') || isAbsolutePath(rel)) return null;
  return normalizeRelPath(toPosix(rel));
};

const createFileLookup = ({ entries, root }) => {
  const rootAbs = path.resolve(root);
  const fileSet = new Set();
  const fileLower = new Map();
  for (const entry of entries) {
    const abs = typeof entry === 'string' ? entry : entry.abs;
    if (!abs) continue;
    const rel = typeof entry === 'object' && entry.rel
      ? entry.rel
      : path.relative(rootAbs, abs);
    const relPosix = normalizeRelPath(toPosix(rel));
    if (!relPosix) continue;
    fileSet.add(relPosix);
    const lower = relPosix.toLowerCase();
    if (!fileLower.has(lower)) fileLower.set(lower, relPosix);
  }
  return { rootAbs, fileSet, fileLower };
};

const resolveFromLookup = (relPath, lookup) => {
  if (!relPath) return null;
  const normalized = normalizeRelPath(relPath);
  if (lookup.fileSet.has(normalized)) return normalized;
  const lower = normalized.toLowerCase();
  if (lookup.fileLower.has(lower)) return lookup.fileLower.get(lower);
  return null;
};

const resolveCandidate = (relPath, lookup) => {
  if (!relPath) return null;
  const normalized = normalizeRelPath(relPath);
  const trimmed = normalized.replace(/\/+$/, '');
  const ext = path.posix.extname(trimmed);
  if (ext) {
    return resolveFromLookup(trimmed, lookup);
  }
  for (const candidateExt of DEFAULT_IMPORT_EXTS) {
    const candidate = resolveFromLookup(`${trimmed}${candidateExt}`, lookup);
    if (candidate) return candidate;
  }
  for (const candidateExt of DEFAULT_IMPORT_EXTS) {
    const candidate = resolveFromLookup(`${trimmed}/index${candidateExt}`, lookup);
    if (candidate) return candidate;
  }
  return null;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchTsPattern = (pattern, spec) => {
  if (!pattern || !spec) return null;
  const starCount = (pattern.match(/\*/g) || []).length;
  const parts = pattern.split('*').map(escapeRegex);
  const regex = new RegExp(`^${parts.join('(.+?)')}$`);
  const match = spec.match(regex);
  if (!match) return null;
  return { captures: match.slice(1), starCount };
};

const applyTsTemplate = (template, captures) => {
  if (!template) return '';
  let index = 0;
  return template.replace(/\*/g, () => {
    const value = captures[index] ?? '';
    index += 1;
    return value;
  });
};

const resolveTsConfigExtends = (baseDir, extendsValue) => {
  if (!extendsValue || typeof extendsValue !== 'string') return null;
  const raw = extendsValue.trim();
  if (!raw) return null;
  if (isAbsolutePath(raw) || raw.startsWith('.')) {
    const resolved = isAbsolutePath(raw) ? raw : path.resolve(baseDir, raw);
    return resolved.endsWith('.json') ? resolved : `${resolved}.json`;
  }
  const requireFrom = createRequire(import.meta.url);
  try {
    return requireFrom.resolve(raw, { paths: [baseDir] });
  } catch {}
  if (!raw.endsWith('.json')) {
    try {
      return requireFrom.resolve(`${raw}.json`, { paths: [baseDir] });
    } catch {}
  }
  return null;
};

const createTsConfigLoader = ({ rootAbs }) => {
  const tsconfigCache = new Map();
  const dirCache = new Map();

  const loadConfig = (tsconfigPath, stack = new Set()) => {
    if (!tsconfigPath || stack.has(tsconfigPath)) return null;
    const stat = fs.existsSync(tsconfigPath) ? fs.statSync(tsconfigPath) : null;
    if (!stat) return null;
    const cacheKey = `${stat.mtimeMs}:${stat.size}`;
    const cached = tsconfigCache.get(tsconfigPath);
    if (cached && cached.key === cacheKey) return cached.value;

    stack.add(tsconfigPath);
    let parsed;
    try {
      parsed = readJsoncFile(tsconfigPath);
    } catch {
      parsed = null;
    }
    const baseDir = path.dirname(tsconfigPath);
    let baseConfig = null;
    const extendsPath = resolveTsConfigExtends(baseDir, parsed?.extends);
    if (extendsPath) {
      baseConfig = loadConfig(extendsPath, stack);
    }
    stack.delete(tsconfigPath);

    const compilerOptions = parsed?.compilerOptions && typeof parsed.compilerOptions === 'object'
      ? parsed.compilerOptions
      : {};
    const baseCompiler = baseConfig?.compilerOptions || {};
    const rawBaseUrl = typeof compilerOptions.baseUrl === 'string'
      ? compilerOptions.baseUrl
      : (typeof baseCompiler.baseUrl === 'string' ? baseCompiler.baseUrl : '');
    const baseUrlAbs = rawBaseUrl
      ? path.resolve(baseDir, rawBaseUrl)
      : (baseConfig?.baseUrlAbs || baseDir);
    const rawPaths = compilerOptions.paths && typeof compilerOptions.paths === 'object'
      ? compilerOptions.paths
      : null;
    const basePaths = baseConfig?.paths || {};
    const paths = rawPaths ? { ...basePaths, ...rawPaths } : basePaths;

    const value = {
      tsconfigPath,
      compilerOptions,
      baseUrlAbs,
      paths
    };
    tsconfigCache.set(tsconfigPath, { key: cacheKey, value });
    return value;
  };

  const findNearest = (importerAbs) => {
    const startDir = path.dirname(importerAbs);
    let dir = startDir;
    const visited = [];
    while (dir && dir.startsWith(rootAbs)) {
      if (dirCache.has(dir)) {
        const cached = dirCache.get(dir);
        for (const seen of visited) dirCache.set(seen, cached);
        return cached;
      }
      visited.push(dir);
      const candidate = path.join(dir, 'tsconfig.json');
      if (fs.existsSync(candidate)) {
        for (const seen of visited) dirCache.set(seen, candidate);
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    for (const seen of visited) dirCache.set(seen, null);
    return null;
  };

  const resolveForFile = (importerAbs) => {
    const tsconfigPath = findNearest(importerAbs);
    if (!tsconfigPath) return null;
    return loadConfig(tsconfigPath);
  };

  return { resolveForFile };
};

const resolveTsPaths = ({ spec, tsconfig, lookup }) => {
  if (!tsconfig?.paths || !spec) return null;
  const entries = Object.entries(tsconfig.paths);
  if (!entries.length) return null;
  const candidates = [];
  for (const [pattern, replacements] of entries) {
    const match = matchTsPattern(pattern, spec);
    if (!match) continue;
    const list = Array.isArray(replacements) ? replacements : [replacements];
    for (const replacement of list) {
      if (typeof replacement !== 'string') continue;
      const substituted = applyTsTemplate(replacement, match.captures);
      const candidateAbs = path.resolve(tsconfig.baseUrlAbs, substituted);
      const rel = resolveWithinRoot(lookup.rootAbs, candidateAbs);
      if (!rel) continue;
      const resolved = resolveCandidate(rel, lookup);
      if (!resolved) continue;
      candidates.push({
        resolved,
        pattern,
        starCount: match.starCount,
        pathLength: resolved.length
      });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (
    a.starCount - b.starCount
    || a.pathLength - b.pathLength
    || sortStrings(a.resolved, b.resolved)
  ));
  return candidates[0];
};

const parsePackageName = (spec) => {
  if (!spec) return null;
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  const [name] = spec.split('/');
  return name || null;
};

const addGraphNode = (nodes, id, type) => {
  if (nodes.has(id)) return;
  if (nodes.size >= MAX_GRAPH_NODES) return;
  nodes.set(id, { id, type });
};

export function resolveImportLinks({
  root,
  entries,
  importsByFile,
  fileRelations,
  log,
  enableGraph = true,
  graphMeta = null
}) {
  const lookup = createFileLookup({ entries, root });
  const tsConfigResolver = createTsConfigLoader({ rootAbs: lookup.rootAbs });
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
  let suppressedWarnings = 0;
  let unresolvedCount = 0;
  let externalCount = 0;
  let resolvedCount = 0;
  let edgeCount = 0;
  let edgeTotal = 0;

  const warningList = enableGraph ? graph.warnings : null;
  const edges = enableGraph ? graph.edges : null;

  const importsEntries = importsByFile instanceof Map
    ? Array.from(importsByFile.entries())
    : Object.entries(importsByFile || {});
  for (const [importerRel, rawImports] of importsEntries) {
    if (!importerRel || !Array.isArray(rawImports) || !rawImports.length) continue;
    const importLinks = new Set();
    const externalImports = new Set();
    const relNormalized = normalizeRelPath(importerRel);
    const importerAbs = path.resolve(lookup.rootAbs, relNormalized);
    const tsconfig = tsConfigResolver.resolveForFile(importerAbs);

    if (enableGraph) addGraphNode(graphNodes, `file:${relNormalized}`, 'file');

    const rawSpecs = Array.from(new Set(rawImports.filter((spec) => typeof spec === 'string' && spec)));
    rawSpecs.sort(sortStrings);

    for (const rawSpec of rawSpecs) {
      const spec = stripSpecifier(rawSpec);
      if (!spec) continue;
      let resolvedType = null;
      let resolvedPath = null;
      let tsPathPattern = null;
      let tsconfigPath = null;
      let packageName = null;
      let edgeTarget = null;
      let isExternal = false;

      if (spec.startsWith('.') || spec.startsWith('/')) {
        const base = spec.startsWith('/')
          ? normalizeRelPath(spec.slice(1))
          : normalizeRelPath(path.posix.join(path.posix.dirname(relNormalized), spec));
        const candidate = resolveCandidate(base, lookup);
        if (candidate) {
          resolvedType = 'relative';
          resolvedPath = candidate;
        } else {
          resolvedType = 'unresolved';
        }
      } else {
        const tsResolved = resolveTsPaths({ spec, tsconfig, lookup });
        if (tsResolved) {
          resolvedType = 'ts-path';
          resolvedPath = tsResolved.resolved;
          tsPathPattern = tsResolved.pattern;
          tsconfigPath = tsconfig?.tsconfigPath || null;
        } else {
          resolvedType = 'external';
          isExternal = true;
          packageName = parsePackageName(spec);
        }
      }

      if (resolvedType === 'relative' || resolvedType === 'ts-path') {
        importLinks.add(resolvedPath);
        resolvedCount += 1;
        edgeTarget = `file:${resolvedPath}`;
        if (enableGraph) addGraphNode(graphNodes, edgeTarget, 'file');
      } else if (resolvedType === 'external') {
        externalImports.add(rawSpec);
        externalCount += 1;
        edgeTarget = `ext:${spec}`;
        if (enableGraph) addGraphNode(graphNodes, edgeTarget, 'external');
      } else {
        unresolvedCount += 1;
        if (enableGraph) {
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

      edgeTotal += 1;
      if (enableGraph && edges.length < MAX_GRAPH_EDGES) {
        const tsconfigRel = tsconfigPath
          ? resolveWithinRoot(lookup.rootAbs, tsconfigPath)
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
        edgeCount += 1;
      }
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
    graph.nodes = Array.from(graphNodes.values()).sort((a, b) => sortStrings(a.id, b.id));
    if (Array.isArray(edges)) {
      edges.sort((a, b) => {
        const aKey = [
          a.from || '',
          a.to || '',
          a.rawSpecifier || '',
          a.resolvedType || '',
          a.resolvedPath || '',
          a.packageName || '',
          a.tsconfigPath || '',
          a.tsPathPattern || ''
        ].join('|');
        const bKey = [
          b.from || '',
          b.to || '',
          b.rawSpecifier || '',
          b.resolvedType || '',
          b.resolvedPath || '',
          b.packageName || '',
          b.tsconfigPath || '',
          b.tsPathPattern || ''
        ].join('|');
        return sortStrings(aKey, bKey);
      });
    }
    if (Array.isArray(warningList)) {
      warningList.sort((a, b) => {
        const aKey = `${a?.importer || ''}|${a?.specifier || ''}|${a?.reason || ''}`;
        const bKey = `${b?.importer || ''}|${b?.specifier || ''}|${b?.reason || ''}`;
        return sortStrings(aKey, bKey);
      });
    }
    graph.stats = {
      files: importsEntries.length,
      edges: edgeTotal,
      resolved: resolvedCount,
      external: externalCount,
      unresolved: unresolvedCount,
      truncatedEdges: edgeTotal > MAX_GRAPH_EDGES,
      truncatedNodes: graphNodes.size >= MAX_GRAPH_NODES,
      warningSuppressed: suppressedWarnings
    };
    if (suppressedWarnings > 0 && log) {
      log(`[imports] suppressed ${suppressedWarnings} import resolution warnings.`);
    }
  }

  return {
    stats: {
      files: importsEntries.length,
      edges: resolvedCount + externalCount + unresolvedCount,
      resolved: resolvedCount,
      external: externalCount,
      unresolved: unresolvedCount
    },
    graph
  };
}
