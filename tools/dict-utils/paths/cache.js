import path from 'node:path';
import { DEFAULT_CACHE_MB, DEFAULT_CACHE_TTL_MS } from '../../src/shared/cache.js';
import { isTestingEnv } from '../../src/shared/env.js';
import { getCacheRoot, loadUserConfig } from '../config.js';
import { getDefaultCacheRoot } from '../cache.js';
import { getRepoCacheRoot } from './repo.js';

/**
 * Resolve runtime cache limits and TTLs for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{fileText:{maxMb:number,ttlMs:number},summary:{maxMb:number,ttlMs:number},lint:{maxMb:number,ttlMs:number},complexity:{maxMb:number,ttlMs:number},gitMeta:{maxMb:number,ttlMs:number}}}
 */
export function getCacheRuntimeConfig(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const runtimeCache = cfg.cache?.runtime || {};
  const resolveEntry = (key) => {
    const entry = runtimeCache[key] || {};
    const maxMbRaw = entry.maxMb;
    const ttlMsRaw = entry.ttlMs;
    const maxMb = Number.isFinite(Number(maxMbRaw))
      ? Math.max(0, Number(maxMbRaw))
      : (DEFAULT_CACHE_MB[key] || 0);
    const ttlMs = Number.isFinite(Number(ttlMsRaw))
      ? Math.max(0, Number(ttlMsRaw))
      : (DEFAULT_CACHE_TTL_MS[key] || 0);
    return { maxMb, ttlMs };
  };
  return {
    fileText: resolveEntry('fileText'),
    summary: resolveEntry('summary'),
    lint: resolveEntry('lint'),
    complexity: resolveEntry('complexity'),
    gitMeta: resolveEntry('gitMeta')
  };
}

/**
 * Resolve the models cache directory.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getModelsDir(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const cacheRoot = (cfg.cache && cfg.cache.root) || getCacheRoot();
  const models = cfg.models || {};
  return models.dir || path.join(cacheRoot, 'models');
}

/**
 * Resolve the tooling cache directory.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getToolingDir(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const cacheRoot = (cfg.cache && cfg.cache.root) || getCacheRoot();
  const tooling = cfg.tooling || {};
  return tooling.dir || path.join(cacheRoot, 'tooling');
}

/**
 * Resolve tooling configuration for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{autoInstallOnDetect:boolean,autoEnableOnDetect:boolean,installScope:string,allowGlobalFallback:boolean,dir:string,enabledTools:string[],disabledTools:string[],typescript:{enabled:boolean,resolveOrder:string[],useTsconfig:boolean,tsconfigPath:string},clangd:{requireCompilationDatabase:boolean,compileCommandsDir:string}}}
 */
export function getToolingConfig(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const tooling = cfg.tooling || {};
  const typescript = tooling.typescript || {};
  const clangd = tooling.clangd || {};
  const timeoutMs = Number(tooling.timeoutMs);
  const maxRetries = Number(tooling.maxRetries);
  const breakerThreshold = Number(tooling.circuitBreakerThreshold);
  const logDir = typeof tooling.logDir === 'string' ? tooling.logDir : '';
  const installScope = (tooling.installScope || 'cache').toLowerCase();
  const normalizeOrder = (value) => {
    if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
    if (typeof value === 'string') {
      return value.split(',').map((entry) => entry.trim()).filter(Boolean);
    }
    return null;
  };
  const normalizeToolList = (value) => {
    if (Array.isArray(value)) {
      return value.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
    }
    return [];
  };
  const enabledTools = normalizeToolList(tooling.enabledTools);
  const disabledTools = normalizeToolList(tooling.disabledTools);
  const resolveOrder = normalizeOrder(typescript.resolveOrder) || ['repo', 'cache', 'global'];
  return {
    autoInstallOnDetect: tooling.autoInstallOnDetect === true,
    autoEnableOnDetect: tooling.autoEnableOnDetect !== false,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(1000, Math.floor(timeoutMs)) : null,
    maxRetries: Number.isFinite(maxRetries) ? Math.max(0, Math.floor(maxRetries)) : null,
    circuitBreakerThreshold: Number.isFinite(breakerThreshold) ? Math.max(1, Math.floor(breakerThreshold)) : null,
    logDir: logDir.trim(),
    installScope,
    allowGlobalFallback: tooling.allowGlobalFallback !== false,
    dir: getToolingDir(repoRoot, cfg),
    enabledTools,
    disabledTools,
    typescript: {
      enabled: typescript.enabled !== false,
      resolveOrder,
      useTsconfig: typescript.useTsconfig !== false,
      tsconfigPath: typeof typescript.tsconfigPath === 'string' ? typescript.tsconfigPath : ''
    },
    clangd: {
      requireCompilationDatabase: clangd.requireCompilationDatabase === true,
      compileCommandsDir: typeof clangd.compileCommandsDir === 'string' ? clangd.compileCommandsDir : ''
    }
  };
}

/**
 * Resolve the extensions cache directory.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getExtensionsDir(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const extensions = cfg.extensions || {};
  const sqliteVector = cfg.sqlite?.vectorExtension || {};
  if (extensions.dir) return extensions.dir;
  if (sqliteVector.dir) return sqliteVector.dir;
  const cacheRoot = isTestingEnv() ? getDefaultCacheRoot() : getCacheRoot();
  return path.join(cacheRoot, 'extensions');
}

/**
 * Resolve the repometrics directory for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getMetricsDir(repoRoot, userConfig = null) {
  return path.join(getRepoCacheRoot(repoRoot, userConfig), 'repometrics');
}
