import path from 'node:path';
import { search as coreSearch } from '../../integrations/core/index.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { isAbortError } from '../../shared/abort.js';
import { normalizeOptionalInt } from '../../shared/limits.js';
import { stableStringify } from '../../shared/stable-json.js';
import { createIndexCache } from '../index-cache.js';
import { createSqliteDbCache } from '../sqlite-cache.js';
import { loadWorkspaceConfig } from '../../workspace/config.js';
import { toRealPathSync } from '../../workspace/identity.js';
import { generateWorkspaceManifest } from '../../workspace/manifest.js';
import { buildPerRepoArgsFromCli, buildPerRepoArgsFromRequest } from './args.js';
import { selectFederationCohorts } from './cohorts.js';
import { mergeFederatedResults } from './merge.js';
import {
  buildFederatedQueryCacheKey,
  buildFederatedQueryCacheKeyPayload,
  findFederatedQueryCacheEntry,
  loadFederatedQueryCache,
  persistFederatedQueryCache,
  touchFederatedQueryCacheEntry,
  upsertFederatedQueryCacheEntry
} from './query-cache.js';
import { selectWorkspaceRepos } from './select.js';

const MODE_PAYLOAD_KEYS = Object.freeze({
  code: 'code',
  prose: 'prose',
  'extracted-prose': 'extractedProse',
  records: 'records'
});
const MAX_FEDERATED_TOP = 500;
const MAX_FEDERATED_PER_REPO_TOP = 1000;
const MAX_FEDERATED_CONCURRENCY = 32;
/**
 * Response keys that may legitimately contain filesystem paths and should be
 * redacted when debug includePaths is disabled.
 *
 * We intentionally avoid blanket redaction of "absolute-like" strings because
 * those may be user-visible hit text/snippets, not paths.
 */
const REDACTABLE_PATH_FIELDS = new Set([
  'workspacePath',
  'workspaceDir',
  'workspaceManifestPath',
  'federationCacheRoot',
  'repoPath',
  'repoRoot',
  'repoRootResolved',
  'repoRootCanonical',
  'rootAbs',
  'repoCacheRoot',
  'explicitSelects',
  'file',
  'path',
  'cacheRoot',
  'buildRoot',
  'indexRoot',
  'indexDir'
]);
const REDACTABLE_PATH_TOKEN_FIELDS = new Set([
  'message'
]);

const isAbsoluteLike = (value) => (
  path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)
);

const trimBoundaryPunctuation = (value) => (
  String(value || '').replace(/^[('"`\[{]+|[)\]'"`},.;:!?]+$/g, '')
);

/**
 * Redact absolute path tokens embedded in human-readable diagnostic text.
 *
 * This is intentionally narrower than blanket string redaction and is only
 * applied to known message-like fields so snippets/hit content remain intact.
 *
 * @param {string} value
 * @returns {string}
 */
const redactEmbeddedPathTokens = (value) => String(value || '').replace(/\S+/g, (token) => {
  const candidate = trimBoundaryPunctuation(token);
  if (!candidate || !isAbsoluteLike(candidate)) return token;
  return token.replace(candidate, '<redacted>');
});

const resolveRequestedModes = (modeValue) => {
  const mode = typeof modeValue === 'string' ? modeValue.trim().toLowerCase() : '';
  if (!mode || mode === 'default' || mode === 'both') {
    return ['code', 'prose', 'extracted-prose'];
  }
  if (mode === 'all') return ['code', 'prose', 'extracted-prose', 'records'];
  if (mode === 'code') return ['code'];
  if (mode === 'prose') return ['prose', 'extracted-prose'];
  if (mode === 'extracted-prose') return ['extracted-prose'];
  if (mode === 'records') return ['records'];
  return ['code', 'prose', 'extracted-prose'];
};

/**
 * Redact absolute path values only for known path-bearing keys.
 *
 * The redaction context is inherited through arrays (list of paths) and reset
 * per object property lookup so non-path fields are never redacted solely
 * based on string shape.
 *
 * @param {unknown} value
 * @param {{isPathField?: boolean}} [context]
 * @returns {unknown}
 */
const sanitizeObjectPaths = (value, context = {}) => {
  const isPathField = context.isPathField === true;
  const redactPathTokens = context.redactPathTokens === true;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeObjectPaths(entry, { isPathField, redactPathTokens }));
  }
  if (typeof value === 'string') {
    if (isPathField && isAbsoluteLike(value)) return '<redacted>';
    if (redactPathTokens) return redactEmbeddedPathTokens(value);
    return value;
  }
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = sanitizeObjectPaths(entry, {
      isPathField: REDACTABLE_PATH_FIELDS.has(key),
      redactPathTokens: REDACTABLE_PATH_TOKEN_FIELDS.has(key)
    });
  }
  return out;
};

const pickWorkspaceSource = (request) => {
  const workspacePath = typeof request.workspacePath === 'string' ? request.workspacePath.trim() : '';
  if (!workspacePath) {
    throw createError(ERROR_CODES.INVALID_REQUEST, 'Federated search requires workspacePath.');
  }
  return workspacePath;
};

const coerceNumber = (value, fallback, min = 1, max = Number.POSITIVE_INFINITY) => {
  const parsed = normalizeOptionalInt(value);
  const base = parsed == null ? fallback : parsed;
  return Math.min(max, Math.max(min, base));
};

/**
 * Resolve explicit repo-select tokens from federated request input.
 *
 * Accepts string/array selector forms and object forms with `repos`/`select`.
 * Non-selector objects (for example `{ includeDisabled: true }`) resolve to an
 * empty list so selection metadata/cache keys do not contain coerced
 * `[object Object]` artifacts.
 *
 * @param {unknown} selectInput
 * @returns {string|string[]}
 */
const resolveSelectTokens = (selectInput) => {
  if (typeof selectInput === 'string' || Array.isArray(selectInput)) return selectInput;
  if (!selectInput || typeof selectInput !== 'object') return [];
  if (typeof selectInput.repos === 'string' || Array.isArray(selectInput.repos)) return selectInput.repos;
  if (typeof selectInput.select === 'string' || Array.isArray(selectInput.select)) return selectInput.select;
  return [];
};

const sortDiagnostics = (entries) => entries.slice().sort((a, b) => (
  String(a?.repoId || '').localeCompare(String(b?.repoId || ''))
  || String(a?.status || '').localeCompare(String(b?.status || ''))
));

const isFederatedAbortError = (error, signal = null) => (
  isAbortError(error)
  || error?.code === ERROR_CODES.CANCELLED
  || error?.code === 'ERR_ABORTED'
  || error?.cancelled === true
  || signal?.aborted === true
);

export const applyCohortPolicy = (input) => selectFederationCohorts(input);

/**
 * Merge federated hits independently per mode after applying cohort selection.
 *
 * This prevents excluded repos in one mode from consuming global merge slots
 * (topN) that should belong to repos selected for that mode.
 *
 * @param {{
 *   perRepoResults?: Array<{repoId:string,repoAlias?:string|null,priority?:number,result?:Record<string, unknown>}>,
 *   selectedReposByMode?: Record<string, Array<{repoId:string}>>,
 *   topN?: number,
 *   perRepoTop?: number,
 *   rrfK?: number
 * }} [input]
 * @returns {{code:any[], prose:any[], extractedProse:any[], records:any[]}}
 */
export const mergeFederatedResultsByMode = ({
  perRepoResults = [],
  selectedReposByMode = {},
  topN = 10,
  perRepoTop = 20,
  rrfK = 60
} = {}) => {
  const mergedByMode = {
    code: [],
    prose: [],
    extractedProse: [],
    records: []
  };
  for (const [mode, payloadKey] of Object.entries(MODE_PAYLOAD_KEYS)) {
    const selectedRepoIds = new Set((selectedReposByMode[mode] || []).map((repo) => repo.repoId));
    if (!selectedRepoIds.size) {
      mergedByMode[payloadKey] = [];
      continue;
    }
    const scopedPerRepoResults = perRepoResults.filter((entry) => selectedRepoIds.has(entry.repoId));
    const scopedMerged = mergeFederatedResults({
      perRepoResults: scopedPerRepoResults,
      topN,
      perRepoTop,
      rrfK
    });
    mergedByMode[payloadKey] = scopedMerged[payloadKey] || [];
  }
  return mergedByMode;
};

const resolveFederatedQueryCachePath = (manifest, repoSetId) => path.join(
  manifest.federationCacheRoot,
  'federation',
  repoSetId,
  'queryCache.json'
);

const toStableResponse = (response, includePaths) => {
  if (!includePaths) {
    return JSON.parse(stableStringify(sanitizeObjectPaths(response)));
  }
  return JSON.parse(stableStringify(response));
};

/**
 * Resolve workspace config for a federated request.
 *
 * API hosts can pass a prevalidated config snapshot (trustedWorkspaceConfig)
 * to avoid time-of-check/time-of-use reload races between allowlist checks and
 * search execution.
 *
 * @param {any} request
 * @param {any} context
 * @returns {any}
 */
const resolveWorkspaceConfig = (request, context) => {
  const trustedWorkspaceConfig = context?.trustedWorkspaceConfig === true
    && request?.workspaceConfig
    && typeof request.workspaceConfig === 'object'
    && !Array.isArray(request.workspaceConfig)
    ? request.workspaceConfig
    : null;
  if (!trustedWorkspaceConfig) {
    const workspacePath = pickWorkspaceSource(request);
    return loadWorkspaceConfig(workspacePath);
  }
  const requestWorkspacePath = typeof request?.workspacePath === 'string'
    ? request.workspacePath.trim()
    : '';
  const trustedWorkspacePath = typeof trustedWorkspaceConfig.workspacePath === 'string'
    ? trustedWorkspaceConfig.workspacePath.trim()
    : '';
  if (requestWorkspacePath && trustedWorkspacePath) {
    if (toRealPathSync(path.resolve(requestWorkspacePath)) !== toRealPathSync(path.resolve(trustedWorkspacePath))) {
      throw createError(
        ERROR_CODES.INVALID_REQUEST,
        'workspacePath does not match the provided workspace configuration.'
      );
    }
  }
  return trustedWorkspaceConfig;
};

export const runFederatedSearch = async (request = {}, context = {}) => {
  const query = String(request.query || '').trim();
  if (!query) throw createError(ERROR_CODES.INVALID_REQUEST, 'Query is required.');

  const workspaceConfig = resolveWorkspaceConfig(request, context);
  if (request.workspaceId && request.workspaceId !== workspaceConfig.repoSetId) {
    throw createError(ERROR_CODES.INVALID_REQUEST, 'workspaceId does not match the provided workspacePath.');
  }

  const manifestResult = await generateWorkspaceManifest(workspaceConfig, { write: true });
  const manifest = manifestResult.manifest;
  const requestedModes = resolveRequestedModes(request.search?.mode || request.mode);
  const selection = selectWorkspaceRepos({
    workspaceConfig,
    select: resolveSelectTokens(request.select),
    tag: request.select?.tags ?? request.select?.tag ?? request.tags ?? request.tag,
    repoFilter: request.select?.repoFilter ?? request.select?.['repo-filter'] ?? request.repoFilter ?? request['repo-filter'],
    includeDisabled: request.select?.includeDisabled === true || request.includeDisabled === true
  });

  const cohortResult = applyCohortPolicy({
    repos: selection.selectedRepos.map((repo) => ({
      ...repo,
      indexes: manifest.repos.find((entry) => entry.repoId === repo.repoId)?.indexes || {}
    })),
    modes: requestedModes,
    policy: request.cohorts?.policy || request.cohortPolicy || 'default',
    cohort: request.cohort || request.cohorts?.cohort || [],
    allowUnsafeMix: request.allowUnsafeMix === true || request.cohorts?.allowUnsafeMix === true
  });

  const selectedByMode = cohortResult.selectedReposByMode || {};
  const activeRepoIds = Array.from(new Set(
    requestedModes.flatMap((mode) => (selectedByMode[mode] || []).map((repo) => repo.repoId))
  )).sort((a, b) => a.localeCompare(b));

  const topN = coerceNumber(request.search?.top ?? request.top, 10, 0, MAX_FEDERATED_TOP);
  const perRepoTop = coerceNumber(
    request.limits?.perRepoTop ?? request.perRepoTop,
    Math.min(Math.max(topN * 2, topN), 50),
    0,
    MAX_FEDERATED_PER_REPO_TOP
  );
  const concurrency = coerceNumber(
    request.limits?.concurrency ?? request.concurrency,
    4,
    1,
    MAX_FEDERATED_CONCURRENCY
  );
  const rrfK = coerceNumber(request.merge?.rrfK ?? request.rrfK, 60, 1);
  const includePaths = request.debug?.includePaths === true;
  const strictFailures = request.strict === true;

  const perRepoArgs = request.rawArgs
    ? buildPerRepoArgsFromCli({ rawArgs: request.rawArgs, perRepoTop })
    : buildPerRepoArgsFromRequest({
      query,
      search: request.search || {},
      perRepoTop
    });
  const perRepoQuery = request.rawArgs ? '' : query;
  const cohortSelectors = request.cohort || request.cohorts?.cohort || [];
  const cachePath = resolveFederatedQueryCachePath(manifest, workspaceConfig.repoSetId);
  const cachePolicy = {
    ...context.federatedCachePolicy
  };
  const cacheKeyPayload = buildFederatedQueryCacheKeyPayload({
    repoSetId: workspaceConfig.repoSetId,
    manifestHash: manifest.manifestHash,
    query,
    workspace: {
      configHash: workspaceConfig.workspaceConfigHash || null
    },
    selection: {
      selectedRepoIds: selection.selectedRepoIds,
      // Include priority in the selection fingerprint so cache hits cannot reuse
      // stale ranking when workspace priorities change without index changes.
      selectedRepoPriorities: selection.selectedRepos.map((repo) => (
        `${repo.repoId}:${Number(repo.priority || 0)}`
      )),
      includeDisabled: selection.selectionMeta?.includeDisabled === true,
      tags: selection.selectionMeta?.tags || [],
      repoFilter: selection.selectionMeta?.repoFilter || [],
      explicitSelects: selection.selectionMeta?.explicitSelects || []
    },
    cohorts: cohortResult,
    cohortSelectors,
    search: {
      ...(request.search || {}),
      mode: request.search?.mode || request.mode || null,
      top: topN
    },
    merge: {
      strategy: request.merge?.strategy || 'rrf',
      rrfK
    },
    limits: {
      top: topN,
      perRepoTop,
      concurrency
    },
    runtime: {
      perRepoArgs,
      requestedBackend: request.search?.backend || request.backend || null,
      requestedAnn: request.search?.ann ?? request.ann ?? null,
      debugIncludePaths: includePaths === true,
      strict: strictFailures === true
    }
  });
  const cacheKeyInfo = buildFederatedQueryCacheKey(cacheKeyPayload);
  let cacheData = await loadFederatedQueryCache({
    cachePath,
    repoSetId: workspaceConfig.repoSetId
  });
  const cachedEntry = findFederatedQueryCacheEntry(cacheData, {
    keyHash: cacheKeyInfo.keyHash,
    manifestHash: manifest.manifestHash
  });
  if (cachedEntry?.result) {
    touchFederatedQueryCacheEntry(cacheData, cacheKeyInfo.keyHash);
    try {
      await persistFederatedQueryCache({ cachePath, cache: cacheData });
    } catch {}
    return JSON.parse(stableStringify(cachedEntry.result));
  }
  const persistCachedResult = async (result) => {
    try {
      upsertFederatedQueryCacheEntry(cacheData, {
        keyHash: cacheKeyInfo.keyHash,
        keyPayloadHash: cacheKeyInfo.keyPayloadHash,
        manifestHash: manifest.manifestHash,
        result,
        policy: cachePolicy
      });
      await persistFederatedQueryCache({
        cachePath,
        cache: cacheData
      });
    } catch {}
  };

  /**
   * Optional cache resolver supplied by long-lived hosts (API/MCP) to reuse
   * per-repo cache instances across federated requests.
   *
   * Signature: `(repoRootCanonical: string) => Promise<{indexCache?:object, sqliteCache?:object}>`
   */
  const resolveRepoCaches = typeof context.resolveRepoCaches === 'function'
    ? context.resolveRepoCaches
    : null;
  let sharedCaches = null;
  const getSharedCaches = () => {
    if (sharedCaches) return sharedCaches;
    sharedCaches = {
      indexCache: context.indexCache || createIndexCache(),
      sqliteCache: context.sqliteCache || createSqliteDbCache()
    };
    return sharedCaches;
  };
  const searchFn = typeof context.searchFn === 'function' ? context.searchFn : coreSearch;
  const diagnostics = [];
  const perRepoResults = [];
  const perRepoErrors = [];
  const repoMap = new Map(workspaceConfig.repos.map((repo) => [repo.repoId, repo]));

  if (!activeRepoIds.length) {
    const workspaceMeta = {
      name: workspaceConfig.name || '',
      workspaceId: workspaceConfig.repoSetId
    };
    if (includePaths) workspaceMeta.workspacePath = workspaceConfig.workspacePath;
    const emptyResponse = {
      ok: true,
      backend: 'federated',
      meta: {
        repoSetId: workspaceConfig.repoSetId,
        manifestHash: manifest.manifestHash,
        workspace: workspaceMeta,
        selection: {
          selectedRepoIds: selection.selectedRepoIds,
          selectedRepos: selection.selectedRepos.map((repo) => ({
            repoId: repo.repoId,
            alias: repo.alias || null,
            priority: Number(repo.priority || 0),
            enabled: repo.enabled !== false
          })),
          ...selection.selectionMeta
        },
        cohorts: cohortResult,
        limits: {
          top: topN,
          perRepoTop,
          concurrency,
          merge: request.merge?.strategy || 'rrf',
          rrfK
        }
      },
      code: [],
      prose: [],
      extractedProse: [],
      records: [],
      repos: [],
      warnings: [...selection.warnings, ...(cohortResult.warnings || [])]
    };
    const stable = toStableResponse(emptyResponse, includePaths);
    await persistCachedResult(stable);
    return stable;
  }

  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const current = cursor;
      if (current >= activeRepoIds.length) return;
      cursor += 1;
      const repoId = activeRepoIds[current];
      const repo = repoMap.get(repoId);
      if (!repo) continue;
      try {
        let repoCaches = null;
        if (resolveRepoCaches) {
          repoCaches = await resolveRepoCaches(repo.repoRootCanonical);
        }
        const fallbackCaches = getSharedCaches();
        const result = await searchFn(repo.repoRootCanonical, {
          args: perRepoArgs,
          query: perRepoQuery,
          emitOutput: false,
          exitOnError: false,
          indexCache: repoCaches?.indexCache || fallbackCaches.indexCache,
          sqliteCache: repoCaches?.sqliteCache || fallbackCaches.sqliteCache,
          signal: context.signal || null
        });
        perRepoResults.push({
          repoId: repo.repoId,
          repoAlias: repo.alias,
          priority: repo.priority || 0,
          result
        });
        diagnostics.push({ repoId: repo.repoId, status: 'ok' });
      } catch (error) {
        const aborted = isFederatedAbortError(error, context.signal);
        perRepoErrors.push({
          repoId: repo.repoId,
          error
        });
        diagnostics.push({
          repoId: repo.repoId,
          status: aborted ? 'cancelled' : error?.code === ERROR_CODES.NO_INDEX ? 'missing_index' : 'error',
          error: {
            code: error?.code || ERROR_CODES.INTERNAL,
            message: error?.message || String(error)
          }
        });
        if (strictFailures || aborted) {
          throw error;
        }
      }
    }
  });

  try {
    await Promise.all(workers);
  } catch (error) {
    if (isFederatedAbortError(error, context.signal)) {
      throw error;
    }
    const strictError = createError(
      ERROR_CODES.INTERNAL,
      `Federated search failed in strict mode: ${error?.message || error}`
    );
    strictError.code = error?.code || ERROR_CODES.INTERNAL;
    throw strictError;
  }

  if (!perRepoResults.length) {
    const firstNonNoIndex = perRepoErrors.find((entry) => entry?.error?.code !== ERROR_CODES.NO_INDEX);
    if (firstNonNoIndex?.error) {
      const underlying = firstNonNoIndex.error;
      if (underlying instanceof Error || (underlying && typeof underlying === 'object')) {
        throw underlying;
      }
      throw createError(
        ERROR_CODES.INTERNAL,
        `Federated search failed for ${firstNonNoIndex.repoId}: ${String(underlying)}`
      );
    }
    throw createError(ERROR_CODES.NO_INDEX, 'Federated search failed: no repositories produced results.');
  }

  const merged = mergeFederatedResultsByMode({
    perRepoResults,
    selectedReposByMode: selectedByMode,
    topN,
    perRepoTop,
    rrfK
  });

  const workspaceMeta = {
    name: workspaceConfig.name || '',
    workspaceId: workspaceConfig.repoSetId
  };
  if (includePaths) workspaceMeta.workspacePath = workspaceConfig.workspacePath;

  const response = {
    ok: true,
    backend: 'federated',
    meta: {
      repoSetId: workspaceConfig.repoSetId,
      manifestHash: manifest.manifestHash,
      workspace: workspaceMeta,
      selection: {
        selectedRepoIds: selection.selectedRepoIds,
        selectedRepos: selection.selectedRepos.map((repo) => ({
          repoId: repo.repoId,
          alias: repo.alias || null,
          priority: Number(repo.priority || 0),
          enabled: repo.enabled !== false
        })),
        ...selection.selectionMeta
      },
      cohorts: cohortResult,
      limits: {
        top: topN,
        perRepoTop,
        concurrency,
        merge: request.merge?.strategy || 'rrf',
        rrfK
      }
    },
    code: merged.code,
    prose: merged.prose,
    extractedProse: merged.extractedProse,
    records: merged.records,
    repos: sortDiagnostics(diagnostics),
    warnings: [...selection.warnings, ...(cohortResult.warnings || [])]
  };

  const stable = toStableResponse(response, includePaths);
  // Avoid pinning degraded non-strict responses when any repo failed during fanout.
  if (!perRepoErrors.length) {
    await persistCachedResult(stable);
  }
  return stable;
};
