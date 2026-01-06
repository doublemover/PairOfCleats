import fs from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import { SKIP_DIRS, SKIP_FILES, SKIP_GLOBS } from '../constants.js';

/**
 * Build ignore matcher for indexing.
 * @param {{root:string,userConfig:object}} input
 * @returns {Promise<{ignoreMatcher:import('ignore').Ignore,config:object,ignoreFiles:string[]}>}
 */
export async function buildIgnoreMatcher({ root, userConfig }) {
  const config = {
    useDefaultSkips: userConfig.useDefaultSkips !== false,
    useGitignore: userConfig.useGitignore !== false,
    usePairofcleatsIgnore: userConfig.usePairofcleatsIgnore !== false,
    ignoreFiles: Array.isArray(userConfig.ignoreFiles) ? userConfig.ignoreFiles : [],
    extraIgnore: Array.isArray(userConfig.extraIgnore) ? userConfig.extraIgnore : []
  };

  const ignoreMatcher = ignore();
  if (config.useDefaultSkips) {
    const defaultIgnorePatterns = [
      ...Array.from(SKIP_DIRS, (dir) => `${dir}/`),
      ...Array.from(SKIP_FILES),
      ...Array.from(SKIP_GLOBS)
    ];
    ignoreMatcher.add(defaultIgnorePatterns);
  }

  const ignoreFiles = [];
  if (config.useGitignore) ignoreFiles.push('.gitignore');
  if (config.usePairofcleatsIgnore) ignoreFiles.push('.pairofcleatsignore');
  ignoreFiles.push(...config.ignoreFiles);

  for (const ignoreFile of ignoreFiles) {
    try {
      const ignorePath = path.join(root, ignoreFile);
      const contents = await fs.readFile(ignorePath, 'utf8');
      ignoreMatcher.add(contents);
    } catch {}
  }
  if (config.extraIgnore.length) {
    ignoreMatcher.add(config.extraIgnore);
  }

  return { ignoreMatcher, config, ignoreFiles };
}
