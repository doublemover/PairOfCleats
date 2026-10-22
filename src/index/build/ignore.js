import fs from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import { sha1 } from '../../shared/hash.js';
import { stableStringify } from '../../shared/stable-json.js';
import { SKIP_DIRS, SKIP_FILES, SKIP_GLOBS } from '../constants.js';
import { isAbsolutePathNative, toPosix } from '../../shared/file-paths.js';
import { isWithinRoot, toRealPathSync } from '../../workspace/identity.js';
import {
  buildGeneratedPolicyConfig,
  GENERATED_POLICY_DEFAULT_SKIP_DIRS,
  GENERATED_POLICY_DEFAULT_SKIP_GLOBS
} from './generated-policy.js';

/**
 * Build ignore matcher for indexing.
 * @param {{root:string,userConfig:object,generatedPolicy?:object|null}} input
 * @returns {Promise<{ignoreMatcher:import('ignore').Ignore,config:object,ignoreFiles:string[],warnings:Array<object>}>}
 */
export async function buildIgnoreMatcher({ root, userConfig, generatedPolicy = null }) {
  const resolvedConfig = userConfig && typeof userConfig === 'object' ? userConfig : {};
  const effectiveGeneratedPolicy = generatedPolicy && typeof generatedPolicy === 'object'
    ? generatedPolicy
    : buildGeneratedPolicyConfig(resolvedConfig.indexing || {});
  const config = {
    useDefaultSkips: resolvedConfig.useDefaultSkips !== false,
    useGitignore: resolvedConfig.useGitignore !== false,
    usePairofcleatsIgnore: resolvedConfig.usePairofcleatsIgnore !== false,
    ignoreFiles: Array.isArray(resolvedConfig.ignoreFiles) ? resolvedConfig.ignoreFiles : [],
    extraIgnore: Array.isArray(resolvedConfig.extraIgnore) ? resolvedConfig.extraIgnore : []
  };

  const ignoreMatcher = ignore();
  const traversalUnignorePrefixes = new Set();
  if (config.useDefaultSkips) {
    const skipDirs = Array.from(SKIP_DIRS).filter((dir) => !GENERATED_POLICY_DEFAULT_SKIP_DIRS.has(dir));
    const skipGlobs = Array.from(SKIP_GLOBS).filter((glob) => !GENERATED_POLICY_DEFAULT_SKIP_GLOBS.has(glob));
    const defaultIgnorePatterns = [
      ...Array.from(skipDirs, (dir) => `${dir}/`),
      ...Array.from(SKIP_FILES),
      ...Array.from(skipGlobs)
    ];
    ignoreMatcher.add(defaultIgnorePatterns);
  }

  const ignoreFiles = [];
  const warnings = [];
  const rootResolved = toRealPathSync(path.resolve(root));
  const normalizeRelative = (value) => toPosix(value);
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
    const candidate = isAbsolutePathNative(raw)
      ? path.resolve(raw)
      : path.resolve(root, raw);
    const resolved = toRealPathSync(candidate);
    if (!isWithinRoot(resolved, rootResolved)) {
      recordWarning({ type: 'outside-root', file: raw });
      return null;
    }
    const rel = normalizeRelative(path.relative(rootResolved, resolved));
    return { raw, resolved, rel };
  };
  if (config.useGitignore) {
    ignoreFiles.push({ path: '.gitignore', optional: true });
  }
  if (config.usePairofcleatsIgnore) {
    ignoreFiles.push({ path: '.pairofcleatsignore', optional: true });
  }
  for (const value of config.ignoreFiles) {
    ignoreFiles.push({ path: value, optional: false });
  }

  const expandIgnorePatterns = (patterns) => {
    const expanded = [];
    const prefixMatcher = ignore().add(ignoreMatcher);
    const hasGlob = (value) => /[*?\[\]{}]/.test(value);
    const addPattern = (value) => {
      if (!value) return;
      expanded.push(value);
      prefixMatcher.add(value);
    };
    for (const raw of patterns) {
      const pattern = typeof raw === 'string' ? raw : '';
      if (!pattern) continue;
      if (!pattern.startsWith('!')) {
        addPattern(pattern);
        continue;
      }
      const negated = pattern.slice(1);
      const rel = negated.startsWith('/') ? negated.slice(1) : negated;
      const parts = rel.split('/').filter(Boolean);
      if (parts.length > 1) {
        let current = '';
        for (let i = 0; i < parts.length - 1; i += 1) {
          const part = parts[i];
          if (!part || hasGlob(part)) break;
          current = current ? `${current}/${part}` : part;
          traversalUnignorePrefixes.add(`${current}/`);
          // Test the complete preceding rule program before reopening traversal.
          // Retain child exclusion so a single selected leaf does not admit siblings.
          const excluded = prefixMatcher.ignores(`${current}/`);
          addPattern(`!${current}/`);
          if (excluded) addPattern(`${current}/**`);
        }
      }
      addPattern(pattern);
    }
    return expanded;
  };

  const loadedFiles = [];
  const policyFileInputs = [];
  let policyComplete = true;
  for (const ignoreFile of ignoreFiles) {
    const resolved = resolveIgnorePath(ignoreFile?.path);
    if (!resolved) continue;
    try {
      const contents = await fs.readFile(resolved.resolved, 'utf8');
      policyFileInputs.push([resolved.rel || resolved.raw, sha1(contents)]);
      ignoreMatcher.add(expandIgnorePatterns(contents.split(/\r?\n/)));
      loadedFiles.push(resolved.rel || resolved.raw);
    } catch (err) {
      const code = String(err?.code || '').toUpperCase();
      const missingOptional = ignoreFile?.optional === true && (code === 'ENOENT' || code === 'ENOTDIR');
      if (missingOptional) { policyFileInputs.push([resolved.rel || resolved.raw, 'absent']); continue; }
      policyComplete = false;
      recordWarning({
        type: 'read-failed',
        file: resolved.rel || resolved.raw,
        detail: err?.code || err?.message || 'read-failed'
      });
    }
  }
  if (config.extraIgnore.length) {
    ignoreMatcher.add(expandIgnorePatterns(config.extraIgnore));
  }
  const generatedIncludePatterns = effectiveGeneratedPolicy.includePatterns || [];
  if (generatedIncludePatterns.length) {
    const includeUnignore = generatedIncludePatterns.map((pattern) => `!${pattern}`);
    ignoreMatcher.add(expandIgnorePatterns(includeUnignore));
  }

  ignoreMatcher.shouldTraverseIgnoredDirectory = (relPath) => {
    const normalized = toPosix(String(relPath || '')).replace(/^\/+/, '').replace(/\/+$/, '');
    if (!normalized) return false;
    const bounded = `${normalized}/`;
    for (const prefix of traversalUnignorePrefixes) {
      if (prefix === bounded || prefix.startsWith(bounded)) {
        return true;
      }
    }
    return false;
  };
  ignoreMatcher.policyFingerprint = policyComplete ? sha1(stableStringify({ config,
    defaultSkips: config.useDefaultSkips ? [Array.from(SKIP_DIRS), Array.from(SKIP_FILES), Array.from(SKIP_GLOBS)] : null,
    generatedIncludePatterns, policyFileInputs })) : null;

  return { ignoreMatcher, config, ignoreFiles: loadedFiles, warnings };
}
