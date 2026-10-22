import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';
import { sha1 } from '../../../shared/hash.js';
import { isAbsolutePathNative, isRelativePathEscape } from '../../../shared/file-paths.js';
import { escapeRegex } from '../../../shared/text/escape-regex.js';
import { createFsMemo } from './fs-meta.js';
import { resolveCandidate, resolveWithinRoot } from './lookup.js';



const compileTsPattern = (pattern) => {
  if (!pattern) return null;
  const starCount = (pattern.match(/\*/g) || []).length;
  const parts = pattern.split('*').map(escapeRegex);
  const regex = new RegExp(`^${parts.join('(.*?)')}$`);
  return { pattern, regex, starCount };
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

// Reuse TypeScript's config parser for ordered extends, declaration-relative
// paths and package tsconfig entries. Disable source glob expansion: this owner
// resolves configuration only, not a second repository discovery scan.
export const loadTsConfigCompilerOptions = tsconfigPath => {
  const dependencies = new Map();
  let failed = false;
  const parsed = ts.getParsedCommandLineOfConfigFile(tsconfigPath, {}, { ...ts.sys,
    readDirectory: () => [],
    readFile(file) {
      const text = ts.sys.readFile(file);
      dependencies.set(path.resolve(file), text == null ? null : sha1(text));
      return text;
    },
    onUnRecoverableConfigFileDiagnostic() { failed = true; }
  });
  if (!parsed || failed || parsed.errors.some(error => error.category === ts.DiagnosticCategory.Error
    && error.code !== 18003)) return null;
  return { compilerOptions: parsed.options, dependencies: [...dependencies].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0) };
};

export const resolveTsConfigExtends = (baseDir, extendsValue) => {
  if (typeof extendsValue !== 'string' || !extendsValue.trim()) return null;
  const raw = extendsValue.trim();
  const asConfig = candidate => {
    for (const file of [candidate, candidate + '.json', path.join(candidate, 'tsconfig.json')]) {
      try { if (fs.statSync(file).isFile() && file.endsWith('.json')) return file; } catch {}
    }
    return null;
  };
  if (isAbsolutePathNative(raw) || raw.startsWith('.')) return asConfig(path.resolve(baseDir, raw));
  for (let directory = path.resolve(baseDir);;) {
    const candidate = path.join(directory, 'node_modules', raw);
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8'));
      if (typeof pkg.tsconfig === 'string') { const config = asConfig(path.resolve(candidate,pkg.tsconfig)); if (config) return config; }
    } catch {}
    const config = asConfig(candidate);
    if (config) return config;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
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

  const loadConfig = tsconfigPath => {
    if (!tsconfigPath) return null;
    const cached = tsconfigCache.get(tsconfigPath);
    if (cached) return cached;
    const loaded = loadTsConfigCompilerOptions(tsconfigPath);
    if (!loaded) return null;
    const compilerOptions = loaded.compilerOptions;
    const baseUrlAbs = compilerOptions.baseUrl || compilerOptions.pathsBasePath || path.dirname(tsconfigPath);
    const paths = compilerOptions.paths || {};
    const compiledPaths = Object.entries(paths).flatMap(([pattern,replacements]) => {
      const compiled = compileTsPattern(pattern);
      if (!compiled) return [];
      const filtered = (Array.isArray(replacements) ? replacements : [replacements]).filter(value => typeof value === 'string');
      return filtered.length ? [{ ...compiled,replacements:filtered }] : [];
    });
    const fingerprint = sha1(JSON.stringify({ baseUrlAbs, paths, dependencies:loaded.dependencies }));
    const value = { tsconfigPath,compilerOptions,baseUrlAbs,paths,compiledPaths,fingerprint };
    tsconfigCache.set(tsconfigPath,value);
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

export const resolveTsPaths = ({ spec,tsconfig,lookup }) => {
  if (!tsconfig?.paths || !spec) return null;
  const compiled = Array.isArray(tsconfig.compiledPaths) ? tsconfig.compiledPaths
    : Object.entries(tsconfig.paths).flatMap(([pattern,replacements]) => {
      const entry=compileTsPattern(pattern);
      return entry ? [{...entry,replacements:Array.isArray(replacements)?replacements:[replacements]}] : [];
    });
  let best=null;
  for (const entry of compiled) {
    const match=spec.match(entry.regex);
    if (!match) continue;
    const star=entry.pattern.indexOf('*');
    const prefix=star<0?entry.pattern.length:star;
    const suffix=star<0?0:entry.pattern.length-star-1;
    const exact=star<0;
    if (!best || (exact && !best.exact) || (exact===best.exact
      && (prefix>best.prefix || (prefix===best.prefix && suffix>best.suffix)))) {
      best={entry,captures:match.slice(1),prefix,suffix,exact};
    }
  }
  if (!best) return null;
  for (const replacement of best.entry.replacements) {
    if (typeof replacement!=='string') continue;
    const candidateAbs=path.resolve(tsconfig.baseUrlAbs,applyTsTemplate(replacement,best.captures));
    const rel=resolveWithinRoot(lookup.rootAbs,candidateAbs);
    if (!rel) continue;
    const resolved=resolveCandidate(rel,lookup);
    if (resolved) return {resolved,pattern:best.entry.pattern,starCount:best.entry.starCount};
  }
  return null;
};
