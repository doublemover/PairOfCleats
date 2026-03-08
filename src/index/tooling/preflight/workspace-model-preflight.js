import { findWorkspaceMarkerNearPaths, hasWorkspaceMarker } from '../workspace-model.js';

const normalizePolicy = (value) => (
  String(value || '').trim().toLowerCase() === 'block' ? 'block' : 'warn'
);

const resolveMissingCheck = ({
  missingCheck,
  fallbackName,
  fallbackMessage
}) => {
  const name = typeof missingCheck?.name === 'string' && missingCheck.name.trim()
    ? missingCheck.name.trim()
    : String(fallbackName || 'workspace_model_missing');
  const message = typeof missingCheck?.message === 'string' && missingCheck.message.trim()
    ? missingCheck.message.trim()
    : String(fallbackMessage || 'workspace model markers not found near repo root.');
  return { name, status: 'warn', message };
};

/**
 * Resolve workspace-model preflight state for a provider.
 *
 * @param {{
 *   repoRoot:string,
 *   markerOptions:object,
 *   candidatePaths?:string[]|null,
 *   missingCheck?:{name?:string,message?:string}|null,
 *   fallbackName:string,
 *   fallbackMessage:string,
 *   policy?:'warn'|'block'
 * }} input
 * @returns {{
 *   state:'ready'|'degraded'|'blocked',
 *   reasonCode:string|null,
 *   blockProvider:boolean,
 *   check:object|null
 * }}
 */
export const resolveWorkspaceModelPreflight = ({
  repoRoot,
  markerOptions,
  candidatePaths = null,
  missingCheck = null,
  fallbackName,
  fallbackMessage,
  policy = 'warn'
}) => {
  const normalizedRepoRoot = repoRoot || process.cwd();
  const nearbyMarker = findWorkspaceMarkerNearPaths(
    normalizedRepoRoot,
    Array.isArray(candidatePaths) ? candidatePaths : [],
    markerOptions || {}
  );
  const markerFound = nearbyMarker.found || hasWorkspaceMarker(normalizedRepoRoot, markerOptions || {});
  if (markerFound) {
    return {
      state: 'ready',
      reasonCode: null,
      blockProvider: false,
      check: null,
      markerDirRel: nearbyMarker.found ? nearbyMarker.markerDirRel : null
    };
  }
  const normalizedPolicy = normalizePolicy(policy);
  return {
    state: normalizedPolicy === 'block' ? 'blocked' : 'degraded',
    reasonCode: String(fallbackName || 'workspace_model_missing'),
    blockProvider: normalizedPolicy === 'block',
    check: resolveMissingCheck({
      missingCheck,
      fallbackName,
      fallbackMessage
    })
  };
};
