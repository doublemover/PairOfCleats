import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readJsoncFile } from '../../shared/jsonc.js';
import { isAbsolutePathNative, toPosix } from '../../shared/files.js';
import { sha1 } from '../../shared/hash.js';
import { buildCacheKey } from '../../shared/cache-key.js';
import { escapeRegex } from '../../shared/text/escape-regex.js';
import { resolveRelativeImportCandidate } from '../shared/import-candidates.js';

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
const NEGATIVE_CACHE_TTL_MS = 60000;
const IMPORT_LOOKUP_CACHE_SCHEMA_VERSION = 1;
const FS_META_PREFETCH_CONCURRENCY = 32;
const FS_META_TRANSIENT_ERROR_CODES = new Set(['EAGAIN', 'EMFILE', 'ENFILE']);

const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

const stripSpecifier = (spec) => {
  if (typeof spec !== 'string') return '';
  const raw = spec.split(/[?#]/)[0];
  return raw.trim();
};

const normalizeRelPath = (value) => {
  if (!value) return '';
  const normalized = path.posix.normalize(toPosix(String(value)));
  return normalized.replace(/^\.\/?/, '');
};

const stripImportExtension = (value) => {
  if (!value) return '';
  if (value.endsWith('.d.ts')) {
    return value.slice(0, -'.d.ts'.length) || '';
  }
  for (const ext of DEFAULT_IMPORT_EXTS) {
    if (value.endsWith(ext)) {
      return value.slice(0, -ext.length) || '';
    }
  }
  return value;
};

const computeFileSetFingerprint = (fileSet) => {
  if (!fileSet || typeof fileSet.size !== 'number' || fileSet.size === 0) return null;
  const list = Array.from(fileSet);
  list.sort(sortStrings);
  const hash = crypto.createHash('sha1');
  for (const rel of list) {
    hash.update(rel);
    hash.update('\n');
  }
  return hash.digest('hex');
};

const createPathTrie = () => ({ children: new Map() });

const addPathToTrie = (trie, relPath) => {
  if (!relPath) return;
  const parts = relPath.split('/').filter(Boolean);
  let node = trie;
  for (const part of parts) {
    if (!node.children.has(part)) {
      node.children.set(part, { children: new Map() });
    }
    node = node.children.get(part);
  }
};

const trieHasPrefix = (trie, relPath) => {
  if (!relPath) return false;
  const parts = relPath.split('/').filter(Boolean);
  let node = trie;
  for (const part of parts) {
    const next = node.children.get(part);
    if (!next) return false;
    node = next;
  }
  return true;
};

const serializePathTrie = (node) => {
  if (!node || !(node.children instanceof Map)) return {};
  const out = {};
  const keys = Array.from(node.children.keys()).sort(sortStrings);
  for (const key of keys) {
    out[key] = serializePathTrie(node.children.get(key));
  }
  return out;
};

const deserializePathTrie = (raw) => {
  const node = { children: new Map() };
  if (!raw || typeof raw !== 'object') return node;
  for (const key of Object.keys(raw).sort(sortStrings)) {
    node.children.set(key, deserializePathTrie(raw[key]));
  }
  return node;
};

const buildLookupCompatibilityFingerprint = ({ rootAbs, fileSetFingerprint }) => {
  if (!rootAbs || !fileSetFingerprint) return null;
  return sha1(JSON.stringify({
    schemaVersion: IMPORT_LOOKUP_CACHE_SCHEMA_VERSION,
    rootHash: sha1(rootAbs),
    fileSetFingerprint
  }));
};

const createLookupSnapshot = ({ lookup, fileSetFingerprint, compatibilityFingerprint }) => {
  if (!lookup || !fileSetFingerprint || !compatibilityFingerprint) return null;
  const fileSet = Array.from(lookup.fileSet || []);
  fileSet.sort(sortStrings);
  const fileLower = {};
  for (const [key, value] of Array.from(lookup.fileLower?.entries?.() || [])) {
    fileLower[key] = value;
  }
  return {
    compatibilityFingerprint,
    rootHash: sha1(lookup.rootAbs),
    fileSetFingerprint,
    hasTsconfig: lookup.hasTsconfig === true,
    fileSet,
    fileLower,
    pathTrie: serializePathTrie(lookup.pathTrie)
  };
};

const createLookupFromSnapshot = ({ root, snapshot }) => {
  if (!root || !snapshot || typeof snapshot !== 'object') return null;
  const rootAbs = path.resolve(root);
  const files = Array.isArray(snapshot.fileSet) ? snapshot.fileSet : [];
  if (!files.length) return null;
  const fileSet = new Set(files.map((entry) => normalizeRelPath(entry)).filter(Boolean));
  const fileLower = new Map();
  for (const [lower, relPath] of Object.entries(snapshot.fileLower || {})) {
    if (typeof lower !== 'string' || typeof relPath !== 'string') continue;
    fileLower.set(lower, normalizeRelPath(relPath));
  }
  if (fileLower.size === 0) {
    for (const relPath of fileSet.values()) {
      const lower = relPath.toLowerCase();
      if (!fileLower.has(lower) || sortStrings(relPath, fileLower.get(lower)) < 0) {
        fileLower.set(lower, relPath);
      }
    }
  }
  const pathTrie = deserializePathTrie(snapshot.pathTrie);
  return {
    rootAbs,
    fileSet,
    fileLower,
    hasTsconfig: snapshot.hasTsconfig === true,
    pathTrie
  };
};

const resolveWithinRoot = (rootAbs, absPath) => {
  const rel = path.relative(rootAbs, absPath);
  if (!rel || rel.startsWith('..') || isAbsolutePathNative(rel)) return null;
  return normalizeRelPath(toPosix(rel));
};

const normalizeMetaPath = (targetPath) => path.resolve(String(targetPath || ''));

/**
 * Transient fs errors should not be persisted as "file missing" because they
 * can self-resolve moments later under lower descriptor pressure.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
const isTransientFsMetaError = (error) => FS_META_TRANSIENT_ERROR_CODES.has(String(error?.code || ''));

const isMissingFsMetaError = (error) => {
  const code = String(error?.code || '');
  return code === 'ENOENT' || code === 'ENOTDIR';
};

const createFsMemo = (preloaded = null) => {
  const existsCache = new Map();
  const statCache = new Map();
  const existsByPath = preloaded && typeof preloaded === 'object' && preloaded.existsByPath
    ? preloaded.existsByPath
    : null;
  const statByPath = preloaded && typeof preloaded === 'object' && preloaded.statByPath
    ? preloaded.statByPath
    : null;
  const transientByPath = preloaded && typeof preloaded === 'object' && preloaded.transientByPath
    ? preloaded.transientByPath
    : null;
  const hasOwn = Object.prototype.hasOwnProperty;
  const hasTransient = (key) => transientByPath && hasOwn.call(transientByPath, key) && transientByPath[key] === true;
  return {
    existsSync: (targetPath) => {
      const key = normalizeMetaPath(targetPath);
      if (existsCache.has(key)) return existsCache.get(key);
      if (hasTransient(key)) {
        let exists = false;
        try {
          exists = fs.existsSync(key);
        } catch {}
        existsCache.set(key, exists);
        return exists;
      }
      if (existsByPath && hasOwn.call(existsByPath, key)) {
        const exists = existsByPath[key] === true;
        existsCache.set(key, exists);
        return exists;
      }
      let exists = false;
      try {
        exists = fs.existsSync(key);
      } catch {}
      existsCache.set(key, exists);
      return exists;
    },
    statSync: (targetPath) => {
      const key = normalizeMetaPath(targetPath);
      if (statCache.has(key)) return statCache.get(key);
      if (hasTransient(key)) {
        let stat = null;
        try {
          stat = fs.statSync(key);
        } catch {}
        statCache.set(key, stat);
        return stat;
      }
      if (statByPath && hasOwn.call(statByPath, key)) {
        const stat = statByPath[key] || null;
        statCache.set(key, stat);
        return stat;
      }
      let stat = null;
      try {
        stat = fs.statSync(key);
      } catch {}
      statCache.set(key, stat);
      return stat;
    }
  };
};

/**
 * Preload fs existence/stat metadata for import resolution to avoid repeating
 * synchronous fs checks for tsconfig/package lookups on large warm builds.
 *
 * @param {{root:string,entries?:Array<object|string>,importsByFile?:Map<string,string[]>|object}} input
 * @returns {Promise<{
 *   existsByPath:Record<string,boolean>,
 *   statByPath:Record<string,object|null>,
 *   transientByPath:Record<string,boolean>,
 *   candidateCount:number
 * }|null>}
 */
export const prepareImportResolutionFsMeta = async ({
  root,
  entries,
  importsByFile
} = {}) => {
  if (!root) return null;
  const rootAbs = path.resolve(root);
  const candidatePaths = new Set([path.join(rootAbs, 'package.json'), path.join(rootAbs, 'tsconfig.json')]);

  const addDirAncestors = (startDir) => {
    let dir = path.resolve(startDir);
    for (;;) {
      const rel = path.relative(rootAbs, dir);
      if (rel && (rel.startsWith('..') || isAbsolutePathNative(rel))) break;
      candidatePaths.add(path.join(dir, 'tsconfig.json'));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  };

  if (importsByFile && typeof importsByFile === 'object') {
    const importerFiles = importsByFile instanceof Map
      ? Array.from(importsByFile.keys())
      : Object.keys(importsByFile);
    for (const importer of importerFiles) {
      if (typeof importer !== 'string' || !importer) continue;
      addDirAncestors(path.dirname(path.resolve(rootAbs, importer)));
    }
  } else if (Array.isArray(entries)) {
    for (const entry of entries) {
      const abs = typeof entry === 'string' ? entry : entry?.abs;
      if (!abs) continue;
      addDirAncestors(path.dirname(path.resolve(abs)));
    }
  }

  const existsByPath = Object.create(null);
  const statByPath = Object.create(null);
  const transientByPath = Object.create(null);
  const candidates = Array.from(candidatePaths, (candidate) => normalizeMetaPath(candidate));
  const workerCount = Math.max(1, Math.min(FS_META_PREFETCH_CONCURRENCY, candidates.length));
  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= candidates.length) break;
      const key = candidates[index];
      try {
        const stat = await fsPromises.stat(key);
        existsByPath[key] = true;
        statByPath[key] = {
          mtimeMs: Number.isFinite(stat?.mtimeMs) ? stat.mtimeMs : null,
          size: Number.isFinite(stat?.size) ? stat.size : null,
          isFile: typeof stat?.isFile === 'function' ? stat.isFile() : true
        };
      } catch (error) {
        if (isTransientFsMetaError(error)) {
          transientByPath[key] = true;
          continue;
        }
        if (isMissingFsMetaError(error)) {
          existsByPath[key] = false;
          statByPath[key] = null;
          continue;
        }
        existsByPath[key] = false;
        statByPath[key] = null;
      }
    }
  });
  await Promise.all(workers);

  return {
    existsByPath,
    statByPath,
    transientByPath,
    candidateCount: candidatePaths.size
  };
};

const collectEntryFileSet = ({ entries, root }) => {
  const rootAbs = path.resolve(root);
  const fileSet = new Set();
  for (const entry of entries || []) {
    const abs = typeof entry === 'string' ? entry : entry?.abs;
    if (!abs) continue;
    const rel = typeof entry === 'object' && entry.rel
      ? entry.rel
      : path.relative(rootAbs, abs);
    const relPosix = normalizeRelPath(toPosix(rel));
    if (!relPosix) continue;
    fileSet.add(relPosix);
  }
  return { rootAbs, fileSet };
};

const createFileLookup = ({ entries, root, fsMemo = null }) => {
  const io = fsMemo || createFsMemo();
  const rootAbs = path.resolve(root);
  const fileSet = new Set();
  const fileLower = new Map();
  const pathTrie = createPathTrie();
  let hasTsconfig = false;
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
    if (lower.endsWith('tsconfig.json')) hasTsconfig = true;
    if (!fileLower.has(lower) || sortStrings(relPosix, fileLower.get(lower)) < 0) {
      fileLower.set(lower, relPosix);
    }
    const basePath = stripImportExtension(relPosix);
    if (basePath) addPathToTrie(pathTrie, basePath);
    addPathToTrie(pathTrie, relPosix);
  }
  if (!hasTsconfig) {
    try {
      if (io.existsSync(path.join(rootAbs, 'tsconfig.json'))) {
        hasTsconfig = true;
      }
    } catch {}
  }
  return { rootAbs, fileSet, fileLower, hasTsconfig, pathTrie };
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
  const trieKey = stripImportExtension(trimmed);
  if (lookup?.pathTrie && trieKey && !trieHasPrefix(lookup.pathTrie, trieKey)) {
    return null;
  }
  return resolveRelativeImportCandidate(trimmed, {
    extensions: DEFAULT_IMPORT_EXTS,
    resolve: (candidate) => resolveFromLookup(candidate, lookup)
  });
};

const compileTsPattern = (pattern) => {
  if (!pattern) return null;
  const starCount = (pattern.match(/\*/g) || []).length;
  const parts = pattern.split('*').map(escapeRegex);
  const regex = new RegExp(`^${parts.join('(.+?)')}$`);
  return { pattern, regex, starCount };
};

const matchTsPattern = (pattern, spec) => {
  if (!pattern || !spec) return null;
  const compiled = compileTsPattern(pattern);
  if (!compiled) return null;
  const match = spec.match(compiled.regex);
  if (!match) return null;
  return { captures: match.slice(1), starCount: compiled.starCount };
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
  if (isAbsolutePathNative(raw) || raw.startsWith('.')) {
    const resolved = isAbsolutePathNative(raw) ? raw : path.resolve(baseDir, raw);
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

const createTsConfigLoader = ({ rootAbs, fileSet, fsMemo = null }) => {
  const io = fsMemo || createFsMemo();
  const tsconfigCache = new Map();
  const dirCache = new Map();
  const fileLookup = fileSet instanceof Set ? fileSet : null;
  const isWithinRoot = (dir) => {
    const rel = path.relative(rootAbs, dir);
    return rel === '' || (!rel.startsWith('..') && !isAbsolutePathNative(rel));
  };

  const loadConfig = (tsconfigPath, stack = new Set()) => {
    if (!tsconfigPath || stack.has(tsconfigPath)) return null;
    const stat = io.statSync(tsconfigPath);
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
    const compiledPaths = Object.entries(paths).flatMap(([pattern, replacements]) => {
      const compiled = compileTsPattern(pattern);
      if (!compiled) return [];
      const list = Array.isArray(replacements) ? replacements : [replacements];
      const filtered = list.filter((replacement) => typeof replacement === 'string');
      if (!filtered.length) return [];
      return [{
        ...compiled,
        replacements: filtered
      }];
    });

    const fingerprint = sha1(JSON.stringify({
      baseUrlAbs,
      paths
    }));
    const value = {
      tsconfigPath,
      compilerOptions,
      baseUrlAbs,
      paths,
      compiledPaths,
      fingerprint
    };
    tsconfigCache.set(tsconfigPath, { key: cacheKey, value });
    return value;
  };

  const findNearest = (importerAbs) => {
    const startDir = path.dirname(importerAbs);
    let dir = startDir;
    const visited = [];
    while (dir && isWithinRoot(dir)) {
      if (dirCache.has(dir)) {
        const cached = dirCache.get(dir);
        for (const seen of visited) dirCache.set(seen, cached);
        return cached;
      }
      visited.push(dir);
      const candidate = path.join(dir, 'tsconfig.json');
      const candidateRel = resolveWithinRoot(rootAbs, candidate);
      let hasCandidate = false;
      if (candidateRel && fileLookup) {
        hasCandidate = fileLookup.has(candidateRel);
        if (!hasCandidate) {
          hasCandidate = io.existsSync(candidate);
        }
      } else if (candidateRel) {
        hasCandidate = io.existsSync(candidate);
      } else {
        hasCandidate = io.existsSync(candidate);
      }
      if (hasCandidate) {
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
  const compiled = Array.isArray(tsconfig.compiledPaths) ? tsconfig.compiledPaths : null;
  const entries = compiled || Object.entries(tsconfig.paths);
  if (!entries.length) return null;
  const candidates = [];
  for (const entry of entries) {
    let pattern = null;
    let replacements = null;
    let captures = null;
    let starCount = 0;
    if (compiled) {
      pattern = entry.pattern;
      replacements = entry.replacements;
      const match = spec.match(entry.regex);
      if (!match) continue;
      captures = match.slice(1);
      starCount = entry.starCount || 0;
    } else {
      pattern = entry[0];
      replacements = entry[1];
      const match = matchTsPattern(pattern, spec);
      if (!match) continue;
      captures = match.captures;
      starCount = match.starCount;
    }
    const list = Array.isArray(replacements) ? replacements : [replacements];
    for (const replacement of list) {
      if (typeof replacement !== 'string') continue;
      const substituted = applyTsTemplate(replacement, captures);
      const candidateAbs = path.resolve(tsconfig.baseUrlAbs, substituted);
      const rel = resolveWithinRoot(lookup.rootAbs, candidateAbs);
      if (!rel) continue;
      const resolved = resolveCandidate(rel, lookup);
      if (!resolved) continue;
      candidates.push({
        resolved,
        pattern,
        starCount,
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

const resolvePackageFingerprint = (rootAbs, fsMemo = null) => {
  const io = fsMemo || createFsMemo();
  if (!rootAbs) return null;
  const packagePath = path.join(rootAbs, 'package.json');
  if (!io.existsSync(packagePath)) return null;
  try {
    const raw = fs.readFileSync(packagePath, 'utf8');
    return sha1(raw);
  } catch {
    return null;
  }
};

const addGraphNode = (nodes, id, type, stats) => {
  if (nodes.has(id)) return;
  if (nodes.size >= MAX_GRAPH_NODES) {
    if (stats) stats.truncatedNodes += 1;
    return;
  }
  nodes.set(id, { id, type });
};

const buildEdgeSortKey = (edge) => [
  edge?.from || '',
  edge?.to || '',
  edge?.rawSpecifier || '',
  edge?.resolvedType || '',
  edge?.resolvedPath || '',
  edge?.packageName || '',
  edge?.tsconfigPath || '',
  edge?.tsPathPattern || ''
].join('|');

const buildWarningSortKey = (warning) => (
  `${warning?.importer || ''}|${warning?.specifier || ''}|${warning?.reason || ''}`
);

/**
 * Resolve import specifiers to file paths and optionally emit a graph artifact.
 * @param {{root:string,entries:object[],importsByFile:Map<string,string[]>|object,fileRelations:Map<string,object>,log?:(msg:string)=>void,enableGraph?:boolean,graphMeta?:object}} input
 * @returns {{stats:{files:number,edges:number,resolved:number,external:number,unresolved:number},graph:object|null}}
 */
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
  const resolutionCache = new Map();
  const cacheKeyFor = (importerRel, spec, tsconfig) => {
    const tsKey = tsconfig?.fingerprint || tsconfig?.tsconfigPath || 'none';
    return buildCacheKey({
      repoHash,
      buildConfigHash: tsKey,
      mode,
      schemaVersion: 'import-resolution-cache-v3',
      featureFlags: null,
      pathPolicy: 'posix',
      extra: {
        importer: importerRel || '',
        spec: spec || ''
      }
    }).key;
  };
  let suppressedWarnings = 0;
  let unresolvedCount = 0;
  let externalCount = 0;
  let resolvedCount = 0;
  let edgeCount = 0;
  let edgeTotal = 0;
  let truncatedEdges = 0;
  const capStats = enableGraph ? { truncatedNodes: 0 } : null;
  const truncatedByKind = { import: 0 };
  const unresolvedSamples = [];

  const warningList = unresolvedSamples;
  const edges = enableGraph ? graph.edges : null;

  const importsEntries = importsByFile instanceof Map
    ? Array.from(importsByFile.entries())
    : Object.entries(importsByFile || {});
  importsEntries.sort((a, b) => sortStrings(normalizeRelPath(a[0]), normalizeRelPath(b[0])));
  for (const [importerRel, rawImports] of importsEntries) {
    if (!importerRel || !Array.isArray(rawImports) || !rawImports.length) continue;
    const importLinks = new Set();
    const externalImports = new Set();
    const relNormalized = normalizeRelPath(importerRel);
    const importerAbs = path.resolve(resolvedLookup.rootAbs, relNormalized);
    let tsconfig = null;
    let tsconfigResolved = false;

    if (enableGraph) addGraphNode(graphNodes, `file:${relNormalized}`, 'file', capStats);

    const rawSpecs = Array.from(new Set(rawImports.filter((spec) => typeof spec === 'string' && spec)));
    rawSpecs.sort(sortStrings);
    const hasNonRelative = rawSpecs.some((rawSpec) => {
      const spec = stripSpecifier(rawSpec);
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
      const spec = stripSpecifier(rawSpec);
      if (!spec) continue;
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
        const cacheKey = cacheKeyFor(relNormalized, spec, tsconfig);
        let cached = resolutionCache.get(cacheKey);
        if (cached?.expiresAt && cached.expiresAt < Date.now()) {
          resolutionCache.delete(cacheKey);
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
          const candidate = resolveCandidate(base, resolvedLookup);
          if (candidate) {
            resolvedType = 'relative';
            resolvedPath = candidate;
          } else {
            resolvedType = 'unresolved';
          }
        } else {
          const tsResolved = resolveTsPaths({ spec, tsconfig, lookup: resolvedLookup });
          if (tsResolved) {
            resolvedType = 'ts-path';
            resolvedPath = tsResolved.resolved;
            tsPathPattern = tsResolved.pattern;
            tsconfigPath = tsconfig?.tsconfigPath || null;
          } else {
            resolvedType = 'external';
            packageName = parsePackageName(spec);
          }
        }

        if (!cached) {
          const expiresAt = resolvedType === 'unresolved'
            ? Date.now() + NEGATIVE_CACHE_TTL_MS
            : null;
          resolutionCache.set(cacheKey, {
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

      if (resolvedType === 'relative' || resolvedType === 'ts-path') {
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

      edgeTotal += 1;
      if (enableGraph) {
        if (edges.length < MAX_GRAPH_EDGES) {
          const tsconfigRel = tsconfigPath
            ? resolveWithinRoot(resolvedLookup.rootAbs, tsconfigPath)
            : null;
          const edge = {
            from: `file:${relNormalized}`,
            to: edgeTarget,
            rawSpecifier: rawSpec,
            kind: 'import',
            resolvedType,
            resolvedPath: resolvedPath || null,
            packageName: packageName || null,
            tsconfigPath: tsconfigRel ? normalizeRelPath(tsconfigRel) : null,
            tsPathPattern: tsPathPattern || null
          };
          edge.__sortKey = buildEdgeSortKey(edge);
          edges.push(edge);
          edgeCount += 1;
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
      edges.sort((a, b) => {
        if (!a.__sortKey) a.__sortKey = buildEdgeSortKey(a);
        if (!b.__sortKey) b.__sortKey = buildEdgeSortKey(b);
        return sortStrings(a.__sortKey, b.__sortKey);
      });
      for (const edge of edges) {
        if (edge && Object.prototype.hasOwnProperty.call(edge, '__sortKey')) {
          delete edge.__sortKey;
        }
      }
    }
    if (Array.isArray(warningList)) {
      warningList.sort((a, b) => {
        if (!a.__sortKey) a.__sortKey = buildWarningSortKey(a);
        if (!b.__sortKey) b.__sortKey = buildWarningSortKey(b);
        return sortStrings(a.__sortKey, b.__sortKey);
      });
      for (const warning of warningList) {
        if (warning && Object.prototype.hasOwnProperty.call(warning, '__sortKey')) {
          delete warning.__sortKey;
        }
      }
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
    unresolvedSamples: warningList,
    unresolvedSuppressed: suppressedWarnings,
    cacheStats: cacheMetrics
  };
}
