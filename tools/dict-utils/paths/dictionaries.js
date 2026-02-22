import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDictConfig } from '../config.js';
import { isTestingEnv } from '../../../src/shared/env.js';
import { getDefaultCacheRoot } from '../cache.js';
import { getRepoId, getLegacyRepoId, resolvePath } from './repo.js';
import {
  CODE_DICT_COMMON_FILE,
  CODE_DICT_DIR_NAME,
  normalizeCodeDictLanguage,
  normalizeCodeDictLanguages
} from '../../../src/shared/code-dictionaries.js';

const BUNDLED_CODE_DICTIONARY_MANIFEST = 'manifest.json';
const BUNDLED_CODE_DICTIONARY_RELATIVE_ROOT = path.join('assets', 'dictionary', 'packs');
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const resolveBundledCodeDictionaryRoot = () => (
  path.resolve(MODULE_DIR, '../../../', BUNDLED_CODE_DICTIONARY_RELATIVE_ROOT)
);

const loadBundledCodeDictionaryManifest = async (baseDir) => {
  const manifestPath = path.join(baseDir, BUNDLED_CODE_DICTIONARY_MANIFEST);
  try {
    const parsed = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

const toBundledList = (value) => (
  Array.isArray(value)
    ? value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
    : []
);

const resolveBundledLanguageEntries = (manifest) => {
  const value = manifest?.languages;
  if (!value || typeof value !== 'object') return new Map();
  const out = new Map();
  for (const [languageIdRaw, filesRaw] of Object.entries(value)) {
    const languageId = normalizeCodeDictLanguage(languageIdRaw);
    if (!languageId) continue;
    const files = toBundledList(filesRaw);
    if (!files.length) continue;
    out.set(languageId, files);
  }
  return out;
};

const resolveBundledCommonEntries = (manifest) => {
  const files = toBundledList(manifest?.common);
  return files.length ? files : [];
};

const resolveBundledCodeDictionaryPaths = async ({ languages = null } = {}) => {
  const baseDir = resolveBundledCodeDictionaryRoot();
  const manifest = await loadBundledCodeDictionaryManifest(baseDir);
  if (!manifest) {
    return {
      baseDir,
      profileVersion: null,
      common: [],
      byLanguage: new Map(),
      all: []
    };
  }
  const languageFilter = languages instanceof Set ? languages : null;
  const addIfExists = async (bucket, relativePath) => {
    const resolved = path.join(baseDir, relativePath);
    try {
      const stat = await fsPromises.stat(resolved);
      if (!stat.isFile()) return;
      bucket.push(resolved);
    } catch {}
  };
  const common = [];
  for (const relativePath of resolveBundledCommonEntries(manifest)) {
    await addIfExists(common, relativePath);
  }
  const byLanguage = new Map();
  for (const [languageId, relativePaths] of resolveBundledLanguageEntries(manifest).entries()) {
    if (languageFilter && !languageFilter.has(languageId)) continue;
    const files = [];
    for (const relativePath of relativePaths) {
      await addIfExists(files, relativePath);
    }
    if (files.length) byLanguage.set(languageId, files);
  }
  const all = [
    ...common,
    ...Array.from(byLanguage.values()).flat()
  ];
  return {
    baseDir,
    profileVersion: typeof manifest?.profileVersion === 'string'
      ? manifest.profileVersion
      : null,
    common,
    byLanguage,
    all: Array.from(new Set(all)).sort()
  };
};

/**
 * Resolve the path for the repo-specific dictionary file.
 * @param {string} repoRoot
 * @param {object|null} dictConfig
 * @returns {string}
 */
export function getRepoDictPath(repoRoot, dictConfig = null) {
  const config = dictConfig || getDictConfig(repoRoot);
  const repoId = getRepoId(repoRoot);
  return path.join(config.dir, 'repos', `${repoId}.txt`);
}

/**
 * List .txt files in a directory.
 * @param {string} dirPath
 * @returns {Promise<string[]>}
 */
async function listTxtFiles(dirPath) {
  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.txt'))
      .map((entry) => path.join(dirPath, entry.name));
  } catch {
    return [];
  }
}

/**
 * List .txt files in a directory and one level of subdirectories.
 * @param {string} dirPath
 * @returns {Promise<{root:string[],byDir:Map<string,string[]>}>}
 */
async function listTxtFilesNested(dirPath) {
  const rootFiles = [];
  const byDir = new Map();
  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.txt')) {
        rootFiles.push(path.join(dirPath, entry.name));
      } else if (entry.isDirectory()) {
        const subDir = path.join(dirPath, entry.name);
        const files = await listTxtFiles(subDir);
        if (files.length) {
          byDir.set(entry.name, files);
        }
      }
    }
  } catch {
    return { root: [], byDir: new Map() };
  }
  return { root: rootFiles, byDir };
}

/**
 * Resolve all dictionary paths to load for a repo.
 * @param {string} repoRoot
 * @param {object|null} dictConfig
 * @returns {Promise<string[]>}
 */
export async function getDictionaryPaths(repoRoot, dictConfig = null, options = {}) {
  const config = dictConfig || getDictConfig(repoRoot);
  const allowFallback = options?.allowFallback !== false;
  const buildPaths = async (dictDir) => {
    const resolvedConfig = dictDir === config.dir ? config : { ...config, dir: dictDir };
    const paths = [];

    const combinedPath = path.join(dictDir, 'combined.txt');
    if (fs.existsSync(combinedPath)) {
      paths.push(combinedPath);
    }

    const languages = Array.from(new Set(resolvedConfig.languages || []));
    for (const lang of languages) {
      const langFile = path.join(dictDir, `${lang}.txt`);
      if (fs.existsSync(langFile)) paths.push(langFile);
    }

    const legacyWords = path.join(dictDir, 'words_alpha.txt');
    if (!paths.length && fs.existsSync(legacyWords)) paths.push(legacyWords);

    for (const filePath of resolvedConfig.files) {
      const resolved = resolvePath(repoRoot, filePath);
      if (resolved && fs.existsSync(resolved)) paths.push(resolved);
    }

    if (resolvedConfig.includeSlang) {
      const slangDirs = resolvedConfig.slangDirs.length
        ? resolvedConfig.slangDirs
        : [path.join(dictDir, 'slang')];
      for (const slangDir of slangDirs) {
        const resolved = resolvePath(repoRoot, slangDir);
        if (!resolved) continue;
        const slangFiles = await listTxtFiles(resolved);
        paths.push(...slangFiles);
      }
      for (const slangFile of resolvedConfig.slangFiles) {
        const resolved = resolvePath(repoRoot, slangFile);
        if (resolved && fs.existsSync(resolved)) paths.push(resolved);
      }
    }

    if (resolvedConfig.enableRepoDictionary) {
      const repoDict = getRepoDictPath(repoRoot, resolvedConfig);
      if (fs.existsSync(repoDict)) paths.push(repoDict);
      const legacyRepoDict = path.join(resolvedConfig.dir, 'repos', `${getLegacyRepoId(repoRoot)}.txt`);
      if (fs.existsSync(legacyRepoDict)) paths.push(legacyRepoDict);
    }

    if (!paths.length) {
      const fallback = path.join(repoRoot, 'tools', 'words_alpha.txt');
      if (fs.existsSync(fallback)) paths.push(fallback);
    }

    return Array.from(new Set(paths));
  };

  const dictDir = config.dir;
  let paths = await buildPaths(dictDir);

  if (!paths.length && isTestingEnv() && allowFallback) {
    const fallbackDir = path.join(getDefaultCacheRoot(), 'dictionaries');
    if (fallbackDir && fallbackDir !== dictDir) {
      const fallbackPaths = await buildPaths(fallbackDir);
      if (fallbackPaths.length) paths = fallbackPaths;
    }
  }

  return paths;
}

/**
 * Resolve code dictionary paths by language (common + per-language).
 * @param {string} repoRoot
 * @param {object|null} dictConfig
 * @param {{languages?:string[]|Set<string>}} [options]
 * @returns {Promise<{baseDir:string,common:string[],byLanguage:Map<string,string[]>,all:string[]}>}
 */
export async function getCodeDictionaryPaths(repoRoot, dictConfig = null, options = {}) {
  const config = dictConfig || getDictConfig(repoRoot);
  const baseDir = path.join(config.dir, CODE_DICT_DIR_NAME);
  const hasLanguageFilter = Array.isArray(options.languages) || options.languages instanceof Set;
  const allowedLanguages = hasLanguageFilter ? normalizeCodeDictLanguages(options.languages) : null;
  const useBundledFallback = options.useBundledFallback !== false;
  const allowCommon = !hasLanguageFilter || allowedLanguages.size > 0;
  const { root: rootFiles, byDir } = await listTxtFilesNested(baseDir);
  const common = new Set();
  const byLanguage = new Map();
  const all = new Set();
  const maybeAdd = (lang, filePath) => {
    if (allowedLanguages && !allowedLanguages.has(lang)) return;
    const bucket = byLanguage.get(lang) || [];
    bucket.push(filePath);
    byLanguage.set(lang, bucket);
    all.add(filePath);
  };
  for (const filePath of rootFiles) {
    const baseName = path.parse(filePath).name.toLowerCase();
    if (baseName === 'common' || baseName === CODE_DICT_COMMON_FILE.replace(/\.txt$/i, '').toLowerCase()) {
      if (allowCommon) {
        common.add(filePath);
        all.add(filePath);
      }
      continue;
    }
    const lang = normalizeCodeDictLanguage(baseName);
    if (!lang) continue;
    maybeAdd(lang, filePath);
  }
  for (const [dirName, files] of byDir.entries()) {
    const lang = normalizeCodeDictLanguage(dirName);
    if (!lang) continue;
    for (const filePath of files) {
      maybeAdd(lang, filePath);
    }
  }
  const commonList = Array.from(common).sort();
  for (const [lang, files] of byLanguage.entries()) {
    files.sort();
    byLanguage.set(lang, files);
  }
  let bundled = null;
  if (useBundledFallback) {
    bundled = await resolveBundledCodeDictionaryPaths({
      languages: allowedLanguages
    });
    const addBundledCommon = allowCommon && commonList.length === 0;
    if (addBundledCommon) {
      for (const filePath of bundled.common) {
        if (!common.has(filePath)) common.add(filePath);
        all.add(filePath);
      }
    }
    for (const [lang, bundledFiles] of bundled.byLanguage.entries()) {
      const existing = byLanguage.get(lang) || [];
      if (existing.length > 0) continue;
      byLanguage.set(lang, bundledFiles.slice().sort());
      for (const filePath of bundledFiles) {
        all.add(filePath);
      }
    }
  }
  const mergedCommon = Array.from(common).sort();
  const mergedAll = Array.from(all).sort();
  return {
    baseDir,
    common: mergedCommon,
    byLanguage,
    all: mergedAll,
    bundleProfileVersion: bundled?.profileVersion || null,
    bundledBaseDir: bundled?.baseDir || null
  };
}
