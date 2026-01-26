import path from 'node:path';
import { DEFAULT_TRIAGE_PROMOTE_FIELDS } from '../constants.js';
import { loadUserConfig } from '../config.js';
import { getRepoCacheRoot, resolvePath } from './repo.js';

/**
 * Resolve triage configuration for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{recordsDir:string,storeRawPayload:boolean,promoteFields:string[],contextPack:{maxHistory:number,maxEvidencePerQuery:number}}}
 */
export function getTriageConfig(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const triage = cfg.triage || {};
  const repoCacheRoot = getRepoCacheRoot(repoRoot, cfg);
  const defaultRecordsDir = path.join(repoCacheRoot, 'triage', 'records');
  const recordsDir = (typeof triage.recordsDir === 'string' && triage.recordsDir.trim())
    ? resolvePath(repoRoot, triage.recordsDir)
    : defaultRecordsDir;
  const promoteFields = Array.isArray(triage.promoteFields)
    ? triage.promoteFields
    : DEFAULT_TRIAGE_PROMOTE_FIELDS;
  const contextPack = triage.contextPack || {};
  const maxHistory = Number.isFinite(Number(contextPack.maxHistory)) ? Number(contextPack.maxHistory) : 5;
  const maxEvidencePerQuery = Number.isFinite(Number(contextPack.maxEvidencePerQuery))
    ? Number(contextPack.maxEvidencePerQuery)
    : 5;
  return {
    recordsDir,
    storeRawPayload: triage.storeRawPayload === true,
    promoteFields,
    contextPack: {
      maxHistory,
      maxEvidencePerQuery
    }
  };
}

/**
 * Resolve the triage records directory for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getTriageRecordsDir(repoRoot, userConfig = null) {
  return getTriageConfig(repoRoot, userConfig).recordsDir;
}
