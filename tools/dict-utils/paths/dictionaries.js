import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getDictConfig } from '../config.js';
import { isTestingEnv } from '../../src/shared/env.js';
import { getDefaultCacheRoot } from '../cache.js';
import { getRepoId, getLegacyRepoId, resolvePath } from './repo.js';

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
