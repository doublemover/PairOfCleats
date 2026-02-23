import path from 'node:path';
import { createRequire } from 'node:module';
import { readJsoncFile } from '../../../shared/jsonc.js';
import { sha1 } from '../../../shared/hash.js';
import { isAbsolutePathNative, isRelativePathEscape } from '../../../shared/files.js';
import { escapeRegex } from '../../../shared/text/escape-regex.js';
import { createFsMemo } from './fs-meta.js';
import { resolveCandidate, resolveWithinRoot } from './lookup.js';
import { sortStrings } from './path-utils.js';

const requireFromImportResolution = createRequire(import.meta.url);

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
  try {
    return requireFromImportResolution.resolve(raw, { paths: [baseDir] });
  } catch {}
  if (!raw.endsWith('.json')) {
    try {
      return requireFromImportResolution.resolve(`${raw}.json`, { paths: [baseDir] });
    } catch {}
  }
  return null;
};

export const createTsConfigLoader = ({ rootAbs, fileSet, fsMemo = null }) => {
  const io = fsMemo || createFsMemo();
  const tsconfigCache = new Map();
  const dirCache = new Map();
  const fileLookup = fileSet instanceof Set ? fileSet : null;
  const isWithinRoot = (dir) => {
    const rel = path.relative(rootAbs, dir);
    return rel === '' || (!isRelativePathEscape(rel) && !isAbsolutePathNative(rel));
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

export const resolveTsPaths = ({ spec, tsconfig, lookup }) => {
  if (!tsconfig?.paths || !spec) return null;
  const compiled = Array.isArray(tsconfig.compiledPaths) ? tsconfig.compiledPaths : null;
  const entries = compiled || Object.entries(tsconfig.paths);
  if (!entries.length) return null;
  let best = null;
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
      const candidate = {
        resolved,
        pattern,
        starCount,
        pathLength: resolved.length
      };
      if (!best) {
        best = candidate;
        continue;
      }
      const order = (
        candidate.starCount - best.starCount
        || candidate.pathLength - best.pathLength
        || sortStrings(candidate.resolved, best.resolved)
      );
      if (order < 0) best = candidate;
    }
  }
  return best;
};
