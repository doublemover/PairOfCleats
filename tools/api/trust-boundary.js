import path from 'node:path';
import { resolveFederationCacheRoot } from '../../src/workspace/manifest.js';
import { toRealPathSync } from '../shared/dict-utils.js';

export const isLocalHost = (value) => {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
};

const normalizeRoots = (values) => Array.from(new Set(
  (Array.isArray(values) ? values : [])
    .filter((entry) => typeof entry === 'string' && entry.trim())
    .map((entry) => toRealPathSync(path.resolve(entry)))
));

export const evaluateApiTrustBoundary = ({
  host,
  defaultRepo,
  allowedRepoRoots = [],
  allowUnauthenticated = false,
  authToken = '',
  corsAllowAny = false
}) => {
  const normalizedHost = String(host || '127.0.0.1').trim() || '127.0.0.1';
  const hostIsLocal = isLocalHost(normalizedHost);
  const tokenConfigured = typeof authToken === 'string' && authToken.trim().length > 0;
  const authRequired = !allowUnauthenticated && (!hostIsLocal || tokenConfigured);
  const normalizedDefaultRepo = defaultRepo ? toRealPathSync(path.resolve(defaultRepo)) : null;
  const additionalAllowedRepoRoots = normalizeRoots(allowedRepoRoots);
  const effectiveAllowedRepoRoots = Array.from(new Set(
    [normalizedDefaultRepo, ...additionalAllowedRepoRoots].filter(Boolean)
  ));
  const federationCacheRoot = toRealPathSync(resolveFederationCacheRoot(null));
  const workspacePolicyRoots = Array.from(new Set([
    ...effectiveAllowedRepoRoots,
    federationCacheRoot
  ]));
  const repoMode = additionalAllowedRepoRoots.length > 0 ? 'allowlisted' : 'default-repo-only';
  const exposure = hostIsLocal ? 'local-only' : 'non-local';
  const authentication = authRequired ? 'token-required' : 'unauthenticated';
  const summary = [
    exposure,
    authentication,
    repoMode === 'allowlisted' ? 'repo-allowlisted' : 'default-repo-only'
  ].join(' | ');
  return {
    bind: {
      host: normalizedHost,
      scope: hostIsLocal ? 'local' : 'non-local'
    },
    auth: {
      required: authRequired,
      tokenConfigured,
      allowUnauthenticated: allowUnauthenticated === true,
      mode: authRequired ? 'token' : 'none'
    },
    repos: {
      defaultRepo: normalizedDefaultRepo,
      additionalAllowedRepoRoots,
      effectiveAllowedRepoRoots,
      mode: repoMode
    },
    workspaces: {
      policyRoots: workspacePolicyRoots,
      federationCacheRoot
    },
    cors: {
      allowAnyOrigin: corsAllowAny === true
    },
    effectiveBoundary: {
      exposure,
      authentication,
      summary
    }
  };
};

export const buildApiTrustBoundaryStatusView = (trustBoundary) => ({
  bind: {
    scope: trustBoundary?.bind?.scope || 'unknown'
  },
  auth: {
    required: trustBoundary?.auth?.required === true,
    mode: trustBoundary?.auth?.mode || 'unknown'
  },
  repos: {
    mode: trustBoundary?.repos?.mode || 'unknown',
    allowedRepoRootCount: Array.isArray(trustBoundary?.repos?.effectiveAllowedRepoRoots)
      ? trustBoundary.repos.effectiveAllowedRepoRoots.length
      : 0
  },
  workspaces: {
    policyRootCount: Array.isArray(trustBoundary?.workspaces?.policyRoots)
      ? trustBoundary.workspaces.policyRoots.length
      : 0
  },
  cors: {
    allowAnyOrigin: trustBoundary?.cors?.allowAnyOrigin === true
  },
  effectiveBoundary: {
    exposure: trustBoundary?.effectiveBoundary?.exposure || 'unknown',
    authentication: trustBoundary?.effectiveBoundary?.authentication || 'unknown',
    summary: trustBoundary?.effectiveBoundary?.summary || 'unknown'
  }
});

export const validateApiTrustBoundary = (trustBoundary) => {
  const issues = [];
  if (!trustBoundary || typeof trustBoundary !== 'object') return issues;
  if (trustBoundary.bind?.scope === 'non-local' && trustBoundary.auth?.tokenConfigured !== true) {
    issues.push(
      'api-server requires PAIROFCLEATS_API_TOKEN or --auth-token when binding to non-localhost.'
    );
  }
  if (trustBoundary.bind?.scope === 'non-local' && trustBoundary.auth?.allowUnauthenticated === true) {
    issues.push(
      'api-server refuses --allow-unauthenticated when binding to non-localhost.'
    );
  }
  if (trustBoundary.bind?.scope === 'non-local' && trustBoundary.cors?.allowAnyOrigin === true) {
    issues.push(
      'api-server refuses --cors-allow-any when binding to non-localhost.'
    );
  }
  return issues;
};

export const formatApiTrustBoundarySummary = (trustBoundary) => (
  trustBoundary?.effectiveBoundary?.summary || 'unknown'
);
