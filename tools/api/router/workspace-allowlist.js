import path from 'node:path';

import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { loadWorkspaceConfig } from '../../../src/workspace/config.js';
import { resolveFederationCacheRoot } from '../../../src/workspace/manifest.js';
import { isWithinRoot, toRealPathSync } from '../../shared/dict-utils.js';

export const resolveWorkspacePathFromPayload = (payload) => {
  const value = payload?.workspacePath;
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return path.resolve(trimmed);
};

const createForbiddenError = (message) => {
  const err = new Error(message);
  err.code = ERROR_CODES.FORBIDDEN;
  return err;
};

export const createWorkspaceAllowlist = ({
  defaultRepo,
  allowedRepoRoots = [],
  resolveRepo,
  loadWorkspaceConfigFn = loadWorkspaceConfig,
  resolveFederationCacheRootFn = resolveFederationCacheRoot
} = {}) => {
  const canonicalConfiguredAllowedRoots = [defaultRepo, ...allowedRepoRoots]
    .filter((entry) => typeof entry === 'string' && entry.trim())
    .map((entry) => toRealPathSync(path.resolve(entry)));
  const canonicalWorkspacePolicyRoots = Array.from(new Set([
    ...canonicalConfiguredAllowedRoots,
    // Always include the default federation cache root so explicit repo-root
    // allowlists do not accidentally block workspace-path/cache-root workflows.
    resolveFederationCacheRootFn(null)
  ]));

  const isAllowedWorkspacePath = (workspacePath) => {
    if (!canonicalWorkspacePolicyRoots.length) return true;
    const workspaceCanonical = toRealPathSync(workspacePath);
    return canonicalWorkspacePolicyRoots.some((root) => isWithinRoot(workspaceCanonical, root));
  };

  const ensureWorkspaceAllowlist = async (payload) => {
    const resolvedWorkspacePath = resolveWorkspacePathFromPayload(payload);
    if (!resolvedWorkspacePath) {
      throw new Error('Federated search requires workspacePath.');
    }
    if (!isAllowedWorkspacePath(resolvedWorkspacePath)) {
      throw createForbiddenError('Workspace path not permitted by server configuration.');
    }

    const workspaceConfig = loadWorkspaceConfigFn(resolvedWorkspacePath);
    if (typeof resolveRepo === 'function') {
      for (const repo of workspaceConfig.repos) {
        await resolveRepo(repo.repoRootCanonical);
      }
    }

    const federationCacheRoot = resolveFederationCacheRootFn(workspaceConfig);
    if (!isAllowedWorkspacePath(federationCacheRoot)) {
      throw createForbiddenError('Workspace cache root not permitted by server configuration.');
    }
    if (payload?.workspaceId && payload.workspaceId !== workspaceConfig.repoSetId) {
      throw new Error('workspaceId does not match the provided workspacePath.');
    }
    return workspaceConfig;
  };

  return {
    canonicalWorkspacePolicyRoots,
    ensureWorkspaceAllowlist,
    isAllowedWorkspacePath
  };
};
