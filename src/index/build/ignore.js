import fs from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import { SKIP_DIRS, SKIP_FILES, SKIP_GLOBS } from '../constants.js';

/**
 * Build ignore matcher for indexing.
 * @param {{root:string,userConfig:object}} input
 * @returns {Promise<{ignoreMatcher:import('ignore').Ignore,config:object,ignoreFiles:string[],warnings:Array<object>}>}
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
  const warnings = [];
  const rootResolved = path.resolve(root);
  const normalizeRelative = (value) => value.split(path.sep).join('/');
  const recordWarning = (warning) => {
    if (!warning) return;
    warnings.push({
      type: warning.type || 'unknown',
      file: warning.file || null,
      detail: warning.detail || null
    });
  };
  const resolveIgnorePath = (value) => {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return null;
    const resolved = path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(root, raw);
    if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
      recordWarning({ type: 'outside-root', file: raw });
      return null;
    }
    const rel = normalizeRelative(path.relative(rootResolved, resolved));
    return { raw, resolved, rel };
  };
  if (config.useGitignore) ignoreFiles.push('.gitignore');
  if (config.usePairofcleatsIgnore) ignoreFiles.push('.pairofcleatsignore');
  ignoreFiles.push(...config.ignoreFiles);

  const loadedFiles = [];
  for (const ignoreFile of ignoreFiles) {
    const resolved = resolveIgnorePath(ignoreFile);
    if (!resolved) continue;
    try {
      const contents = await fs.readFile(resolved.resolved, 'utf8');
      ignoreMatcher.add(contents);
      loadedFiles.push(resolved.rel || resolved.raw);
    } catch (err) {
      recordWarning({
        type: 'read-failed',
        file: resolved.rel || resolved.raw,
        detail: err?.code || err?.message || 'read-failed'
      });
    }
  }
  const expandExtraIgnore = (patterns) => {
    const expanded = [];
    const seen = new Set();
    const reignored = new Set();
    const hasGlob = (value) => /[*?\[\]{}]/.test(value);
    const addPattern = (value) => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      expanded.push(value);
    };
    for (const raw of patterns) {
      const pattern = typeof raw === 'string' ? raw.trim() : '';
      if (!pattern) continue;
      if (!pattern.startsWith('!')) {
        addPattern(pattern);
        continue;
      }
      const negated = pattern.slice(1).trim();
      const rel = negated.startsWith('/') ? negated.slice(1) : negated;
      const parts = rel.split('/').filter(Boolean);
      if (parts.length > 1) {
        let current = '';
        for (let i = 0; i < parts.length - 1; i += 1) {
          const part = parts[i];
          if (!part || hasGlob(part)) break;
          current = current ? `${current}/${part}` : part;
          addPattern(`!${current}/`);
          if (!reignored.has(current) && ignoreMatcher.ignores(`${current}/`)) {
            addPattern(`${current}/**`);
            reignored.add(current);
          }
        }
      }
      addPattern(pattern);
    }
    return expanded;
  };
  if (config.extraIgnore.length) {
    ignoreMatcher.add(expandExtraIgnore(config.extraIgnore));
  }

  return { ignoreMatcher, config, ignoreFiles: loadedFiles, warnings };
}
