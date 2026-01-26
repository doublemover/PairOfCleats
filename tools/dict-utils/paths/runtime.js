import os from 'node:os';
import { resolveRuntimeEnvelope, resolveRuntimeEnv as resolveRuntimeEnvFromEnvelope } from '../../../src/shared/runtime-envelope.js';
import { loadUserConfig } from '../config.js';
import { getToolVersion } from '../tool.js';

/**
 * Resolve runtime configuration for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{maxOldSpaceMb:number|null,nodeOptions:string,uvThreadpoolSize:number|null}}
 */
export function getRuntimeConfig(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const cpuCount = os.cpus().length;
  const envelope = resolveRuntimeEnvelope({
    argv: {},
    rawArgv: [],
    userConfig: cfg,
    env: process.env,
    execArgv: process.execArgv,
    cpuCount,
    processInfo: {
      pid: process.pid,
      argv: process.argv,
      execPath: process.execPath,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount
    },
    toolVersion: getToolVersion()
  });
  return {
    maxOldSpaceMb: envelope.runtime?.maxOldSpaceMb?.requested?.value ?? null,
    nodeOptions: envelope.runtime?.nodeOptions?.requested?.value ?? '',
    uvThreadpoolSize: envelope.runtime?.uvThreadpoolSize?.requested?.value ?? null,
    ioOversubscribe: envelope.runtime?.ioOversubscribe?.value ?? false,
    envelope
  };
}

/**
 * Merge runtime Node options with existing NODE_OPTIONS.
 * @param {{maxOldSpaceMb:number|null,nodeOptions:string}} runtimeConfig
 * @param {string} [baseOptions]
 * @returns {string}
 */
export function resolveNodeOptions(runtimeConfig, baseOptions = process.env.NODE_OPTIONS || '') {
  const base = typeof baseOptions === 'string' ? baseOptions.trim() : '';
  const extras = [];
  if (runtimeConfig?.nodeOptions) extras.push(runtimeConfig.nodeOptions.trim());
  if (Number.isFinite(runtimeConfig?.maxOldSpaceMb) && runtimeConfig.maxOldSpaceMb > 0) {
    const combined = [base, ...extras].join(' ');
    if (!combined.includes('--max-old-space-size')) {
      extras.push(`--max-old-space-size=${Math.floor(runtimeConfig.maxOldSpaceMb)}`);
    }
  }
  return [base, ...extras].filter(Boolean).join(' ').trim();
}

/**
 * Resolve the environment for spawning child processes that need runtime tuning.
 * Respects existing env vars (e.g. will not override an already-set UV_THREADPOOL_SIZE).
 * @param {{maxOldSpaceMb:number|null,nodeOptions:string,uvThreadpoolSize:number|null}} runtimeConfig
 * @param {Record<string, string|undefined>} [baseEnv]
 * @returns {Record<string, string|undefined>}
 */
export function resolveRuntimeEnv(runtimeConfig, baseEnv = {}) {
  if (runtimeConfig?.envelope) {
    return resolveRuntimeEnvFromEnvelope(runtimeConfig.envelope, baseEnv);
  }
  const env = { ...baseEnv };
  const resolvedNodeOptions = resolveNodeOptions(runtimeConfig, env.NODE_OPTIONS || '');
  if (resolvedNodeOptions) {
    env.NODE_OPTIONS = resolvedNodeOptions;
  }
  const uvSize = Number(runtimeConfig?.uvThreadpoolSize);
  if (Number.isFinite(uvSize) && uvSize > 0) {
    const existing = env.UV_THREADPOOL_SIZE;
    if (existing == null || existing === '') {
      env.UV_THREADPOOL_SIZE = String(Math.max(1, Math.min(128, Math.floor(uvSize))));
    }
  }
  return env;
}
