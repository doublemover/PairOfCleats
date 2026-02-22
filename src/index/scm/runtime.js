import path from 'node:path';
import { sha1 } from '../../shared/hash.js';
import { stableStringifyForSignature } from '../../shared/stable-json.js';

let activeConfig = {};
let activeConfigSignature = sha1(stableStringifyForSignature(activeConfig));
let activeConfigEpoch = 0;

const cloneConfig = (config) => (
  config && typeof config === 'object' ? { ...config } : {}
);

const sanitizeScmConfigForSignature = (config) => {
  const cloned = cloneConfig(config);
  delete cloned.repoHeadId;
  delete cloned.repoProvenance;
  return cloned;
};

const resolveScmConfigSignature = (config) => {
  try {
    return sha1(stableStringifyForSignature(
      sanitizeScmConfigForSignature(config && typeof config === 'object' ? config : {})
    ));
  } catch {
    return sha1(stableStringifyForSignature({}));
  }
};

const normalizeRepoRoot = (value) => {
  if (!value || typeof value !== 'string') return null;
  const resolved = path.resolve(value);
  return process.platform === 'win32'
    ? resolved.toLowerCase()
    : resolved;
};

const normalizeHeadId = (value) => {
  const trimmed = String(value || '').trim();
  return trimmed || null;
};

const resolveRepoHeadId = (value) => (
  normalizeHeadId(value?.head?.changeId)
  || normalizeHeadId(value?.head?.commitId)
  || normalizeHeadId(value?.commit)
  || normalizeHeadId(value?.repoHeadId)
  || null
);

/**
 * Build an SCM freshness guard key for per-run in-memory cache reuse.
 *
 * @param {{
 *  provider?: string|null,
 *  repoRoot?: string|null,
 *  repoProvenance?: object|null,
 *  repoHeadId?: string|null,
 *  includeChurn?: boolean,
 *  config?: object|null,
 *  configSignature?: string|null
 * }} [input]
 * @returns {{
 *  provider:string|null,
 *  repoRoot:string|null,
 *  headId:string|null,
 *  includeChurn:boolean,
 *  configSignature:string|null,
 *  key:string|null
 * }}
 */
export const buildScmFreshnessGuard = (input = {}) => {
  const provider = typeof input?.provider === 'string' && input.provider.trim()
    ? input.provider.trim().toLowerCase()
    : null;
  const repoRoot = normalizeRepoRoot(input?.repoRoot || null);
  const config = input?.config && typeof input.config === 'object'
    ? input.config
    : activeConfig;
  const configSignature = typeof input?.configSignature === 'string' && input.configSignature.trim()
    ? input.configSignature.trim()
    : (config === activeConfig ? activeConfigSignature : resolveScmConfigSignature(config));
  const headId = normalizeHeadId(input?.repoHeadId)
    || resolveRepoHeadId(input?.repoProvenance)
    || resolveRepoHeadId(config?.repoProvenance)
    || normalizeHeadId(config?.repoHeadId)
    || null;
  const includeChurn = input?.includeChurn === true;
  const key = provider && repoRoot && headId && configSignature
    ? `${provider}|${repoRoot}|${headId}|${includeChurn ? '1' : '0'}|${configSignature}`
    : null;
  return {
    provider,
    repoRoot,
    headId,
    includeChurn,
    configSignature,
    key
  };
};

export const setScmRuntimeConfig = (config) => {
  activeConfig = cloneConfig(config);
  activeConfigSignature = resolveScmConfigSignature(activeConfig);
  activeConfigEpoch += 1;
};

export const getScmRuntimeConfig = () => activeConfig;

export const getScmRuntimeConfigSignature = () => activeConfigSignature;

export const getScmRuntimeConfigEpoch = () => activeConfigEpoch;
