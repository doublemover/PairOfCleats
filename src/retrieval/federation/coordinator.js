import path from 'node:path';
import { search as coreSearch } from '../../integrations/core/search.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { isAbortError } from '../../shared/abort.js';
import { normalizeOptionalInt } from '../../shared/limits.js';
import { stableStringify } from '../../shared/stable-json.js';
import { toArray } from '../../shared/iterables.js';
import { createIndexCache } from '../index-cache.js';
import { createSqliteDbCache } from '../sqlite-cache.js';
import { loadWorkspaceConfig } from '../../workspace/config.js';
import { toRealPathSync } from '../../workspace/identity.js';
import { generateWorkspaceManifest } from '../../workspace/manifest.js';
import { buildPerRepoArgsFromCli, buildPerRepoArgsFromRequest } from './args.js';
import { selectFederationCohorts } from './cohorts.js';
import { mergeFederatedModeResults } from './merge.js';
import {
  buildFederatedQueryCacheKey,
  buildFederatedQueryCacheKeyPayload,
  findFederatedQueryCacheEntry,
  loadFederatedQueryCache,
  persistFederatedQueryCache,
  persistFederatedQueryCacheTouch,
  touchFederatedQueryCacheEntry,
  upsertFederatedQueryCacheEntry
} from './query-cache.js';

import { selectWorkspaceRepos } from './select.js';
import { enumerateWorkspace, withoutCursor } from './enumeration.js';
import { parseSearchArgs, hasSearchFilterArgs } from '../cli-args.js';
import { bindRelativeModificationArgs } from './time-filter.js';
import { captureFederatedShadow, publishFederatedShadow } from './shadow-routing.js';
import { createFederatedAdmission } from './admission.js';
import { verifyFederatedModeGeneration, buildPinnedFederatedModePlans,
  bindFederatedBuildRef, bindFederatedModeRequest } from './generation.js';
import { INTERNAL_ADMITTED_GENERATION } from '../../index/as-of.js';
import { applyModeOverride } from './modes.js';
import { resolveFederatedCursor } from './request.js';
import { INTERNAL_EXACT_SEARCH_MODE } from '../cli.js';
import { validateFederatedModeResult, isReusableFederatedCacheResult } from './results.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { INTERNAL_SEARCH_POLICY } from '../cli/effective-plan.js';
import { createFederatedCacheRetirement } from './retirement.js';

export const resolveFederatedUnavailableModes = ({repos,requestedModes,eligibleModesByRepo,cohortExcluded={}}) =>
  (repos || []).flatMap(repo=>(requestedModes || [])
    .filter(mode=>!eligibleModesByRepo.get(repo.repoId)?.has(mode)
      && !toArray(cohortExcluded[mode]).some(excluded=>excluded.repoId === repo.repoId && excluded.reason === 'cohort-excluded'))
    .map(mode=>({repoId:repo.repoId,mode,reason:'not-eligible-for-request'})));

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

const sortModes = (modes) => Array.from(new Set(toArray(modes).filter(Boolean))).sort();

const buildRepoFreshness = (manifestRepo, requestedModes = [], manifestGeneratedAt = null) => {
  if (!manifestRepo || typeof manifestRepo !== 'object') {
    return {
      buildId: null,
      activeBuildRoot: null,
      generationKey: null,
      currentJsonMtimeMs: null,
      manifestGeneratedAt,
      byMode: {}
    };
  }
  const modeKeys = requestedModes.length
    ? requestedModes
    : Object.keys(manifestRepo.indexes || {});
  const byMode = {};
  for (const mode of modeKeys) {
    const indexEntry = manifestRepo.indexes?.[mode] || null;
    const sqliteEntry = manifestRepo.sqlite?.dbs?.[mode] || null;
    byMode[mode] = {
      present: indexEntry?.present === true,
      indexSignatureHash: indexEntry?.indexSignatureHash || null,
      availabilityReason: indexEntry?.availabilityReason || 'missing-index-dir',
      sqlitePresent: sqliteEntry?.present === true,
      sqliteFileSignature: sqliteEntry?.fileSignature || null
    };
  }
  return {
    buildId: manifestRepo.build?.buildId || null,
    activeBuildRoot: manifestRepo.build?.activeRoot || null,
    generationKey: manifestRepo.build?.generationKey || null,
    currentJsonMtimeMs: Number.isFinite(Number(manifestRepo.build?.currentJsonMtimeMs))
      ? Number(manifestRepo.build.currentJsonMtimeMs)
      : null,
    manifestGeneratedAt,
    byMode
  };
};

const resolveRepoCompleteness = ({
  status,
  eligibleModes = [],
  fulfilledModes = [],
  unavailableModes = [],
  executionFailures = [],
  hitCount = 0
}) => {
  if (status === 'error' || status === 'missing_index') {
    return 'partial';
  }
  if (status === 'skipped') {
    return unavailableModes.length ? 'degraded' : 'empty';
  }
  if (executionFailures.length) {
    return 'partial';
  }
  if (unavailableModes.length || eligibleModes.length !== fulfilledModes.length) {
    return 'degraded';
  }
  if (hitCount === 0) {
    return 'empty';
  }
  return 'complete';
};

const resolveFederatedResponseStatus = ({
  repoReports = [],
  totalHits = 0
}) => {
  if (repoReports.some((entry) => entry?.completeness === 'partial')) {
    return 'partial';
  }
  if (repoReports.some((entry) => entry?.completeness === 'degraded')) {
    return 'degraded';
  }
  if (totalHits === 0) {
    return 'empty';
  }
  return 'complete';
};

const buildRepoGenerationContext = (repoCaches = null) => (
  repoCaches && typeof repoCaches === 'object'
    ? {
      buildId: repoCaches.buildId || null,
      buildRoot: repoCaches.buildRoot || null,
      activeBuildRoot: repoCaches.activeBuildRoot || null,
      buildGenerationKey: repoCaches.buildGenerationKey || null
    }
    : null
);

const buildPolicyMeta = ({ strictFailures, responseStatus = null }) => ({
  strictFailures: strictFailures === true,
  acceptPartialResults: strictFailures !== true,
  responseStatus
});

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
  rrfK = 60,
  signal = null
} = {}) => {
  const mergedByMode = {
    code: [],
    prose: [],
    extractedProse: [],
    records: []
  };
  for (const [mode, payloadKey] of Object.entries(MODE_PAYLOAD_KEYS)) {
    const selectedRepoIds = new Set(
      toArray(selectedReposByMode?.[mode])
        .map((repo) => repo?.repoId)
        .filter(Boolean)
    );
    if (!selectedRepoIds.size) {
      mergedByMode[payloadKey] = [];
      continue;
    }
    const scopedPerRepoResults = perRepoResults.filter((entry) => selectedRepoIds.has(entry.repoId));
    mergedByMode[payloadKey] = mergeFederatedModeResults({
      perRepoResults: scopedPerRepoResults,
      mode,
      topN,
      perRepoTop,
      rrfK,
      signal
    });
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

const countRepoCompleteness = (repos = []) => ({
  complete: repos.filter((entry) => entry.completeness === 'complete').length,
  partial: repos.filter((entry) => entry.completeness === 'partial').length,
  degraded: repos.filter((entry) => entry.completeness === 'degraded').length,
  empty: repos.filter((entry) => entry.completeness === 'empty').length
});

const buildFederatedResponse = ({
  workspaceConfig,
  manifest,
  selection,
  cohortResult,
  topN,
  perRepoTop,
  concurrency,
  mergeStrategy,
  rrfK,
  strictFailures,
  includePaths,
  repos,
  warnings,
  modeResults = {}
}) => {
  const workspaceMeta = {
    name: workspaceConfig.name || '',
    workspaceId: workspaceConfig.repoSetId
  };
  if (includePaths) workspaceMeta.workspacePath = workspaceConfig.workspacePath;
  const response = {
    ok: true,
    backend: 'federated',
    status: null,
    meta: {
      repoSetId: workspaceConfig.repoSetId,
      manifestHash: manifest.manifestHash,
      manifestGeneratedAt: manifest.generatedAt,
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
        merge: mergeStrategy,
        rrfK
      },
      policy: buildPolicyMeta({ strictFailures, responseStatus: null }),
      completeness: null
    },
    partialSuccess: false,
    code: modeResults.code || [],
    prose: modeResults.prose || [],
    extractedProse: modeResults.extractedProse || [],
    records: modeResults.records || [],
    repos,
    warnings
  };
  const totalHits = response.code.length
    + response.prose.length
    + response.extractedProse.length
    + response.records.length;
  response.status = resolveFederatedResponseStatus({
    repoReports: response.repos,
    totalHits
  });
  response.meta.completeness = {
    status: response.status,
    strict: strictFailures,
    repoCounts: countRepoCompleteness(response.repos)
  };
  response.meta.policy = buildPolicyMeta({
    strictFailures,
    responseStatus: response.status
  });
  response.partialSuccess = response.status === 'partial' || response.status === 'degraded';
  return response;
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

/**
 * Ranked strict failures and external cancellation reject promptly and stop new
 * repository/mode admissions. Already started reads drain with their original
 * signal; request-owned caches retire only after every worker settles. Borrowed
 * host caches keep their host ownership, including after the caller rejects.
 */
export const runFederatedSearch = async (request = {}, context = {}) => {
  const checkAbort = () => {
    if (context.signal?.aborted) throw createError(ERROR_CODES.CANCELLED, 'Federated search cancelled.');
  };
  checkAbort();
  const timeAnchor = Date.now();
  const query = String(request.query || '').trim();
  const requestCursor = resolveFederatedCursor(request);

  const workspaceConfig = resolveWorkspaceConfig(request, context);
  if (request.workspaceId && request.workspaceId !== workspaceConfig.repoSetId) {
    throw createError(ERROR_CODES.INVALID_REQUEST, 'workspaceId does not match the provided workspacePath.');
  }
  const readManifest = async write => {
    try { return await generateWorkspaceManifest(workspaceConfig, { write, signal: context.signal }); }
    catch (error) {
      observeStorageResource(error, { phase: 'federated-manifest' }).requireSettled();
      if (context.signal?.aborted && isAbortError(error)) {
        throw Object.assign(createError(ERROR_CODES.CANCELLED, 'Federated search cancelled.'), { cause: error });
      }
      throw error;
    }
  };
  const manifestResult = await readManifest(true);
  checkAbort();
  const manifest = manifestResult.manifest;
  const verifyRankedGeneration = async () => {
    checkAbort();
    const current = await readManifest(false);
    checkAbort();
    if (current.manifest.manifestHash !== manifest.manifestHash) {
      throw createError(ERROR_CODES.INVALID_REQUEST, 'Workspace generation changed during ranked search. Retry against the current generation.');
    }
  };
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
  const repoEligibleModesById = new Map();
  for (const mode of requestedModes) {
    for (const repo of toArray(selectedByMode?.[mode])) {
      if (!repo?.repoId) continue;
      if (!repoEligibleModesById.has(repo.repoId)) {
        repoEligibleModesById.set(repo.repoId, new Set());
      }
      repoEligibleModesById.get(repo.repoId).add(mode);
    }
  }
  const activeRepoIds = Array.from(new Set(
    requestedModes.flatMap((mode) => (
      toArray(selectedByMode?.[mode]).map((repo) => repo?.repoId).filter(Boolean)
    ))
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
  const unavailableRequestedModes=resolveFederatedUnavailableModes({repos:selection.selectedRepos,requestedModes,
    eligibleModesByRepo:repoEligibleModesById,cohortExcluded:cohortResult.excluded});
  if(strictFailures && unavailableRequestedModes.length) {
    throw Object.assign(createError(ERROR_CODES.NO_INDEX,'Some requested repository modes are unavailable for workspace search.'),
      {unavailable:unavailableRequestedModes});
  }

  const basePerRepoArgs = bindRelativeModificationArgs(request.rawArgs
    ? buildPerRepoArgsFromCli({ rawArgs: request.rawArgs, perRepoTop })
    : buildPerRepoArgsFromRequest({
      query,
      search: request.search || {},
      perRepoTop
    }), timeAnchor);
  const perRepoQuery = request.rawArgs ? '' : query;
  if (!query) {
    const enumerationArgs = withoutCursor(request.rawArgs
      ? buildPerRepoArgsFromCli({ rawArgs: request.rawArgs, perRepoTop: Math.max(1, topN) })
      : buildPerRepoArgsFromRequest({ query: '', search: { ...request.search, cursor: null }, perRepoTop: Math.max(1, topN) }));
    if (!hasSearchFilterArgs(parseSearchArgs(enumerationArgs))) {
      throw createError(ERROR_CODES.INVALID_REQUEST, 'Provide query text or at least one search filter.');
    }
    const tasks = activeRepoIds.flatMap((repoId) => {
      const repo = selection.selectedRepos.find((entry) => entry.repoId === repoId);
      return Array.from(repoEligibleModesById.get(repoId) || []).sort().map((mode) => ({ repo, mode }));
    });
    const result = await enumerateWorkspace({
      tasks, args: enumerationArgs, cursor: requestCursor,
      manifestHash: manifest.manifestHash, search: context.searchFn || coreSearch, signal: context.signal,
      bindRequest: (task, args) => bindFederatedModeRequest(args,
        manifest.repos.find(repo => repo.repoId === task.repo.repoId), task.mode),
      verifyResult: (task, result) => verifyFederatedModeGeneration({ repoId: task.repo.repoId,
        modes: [task.mode], result, manifestRepo: manifest.repos.find(repo => repo.repoId === task.repo.repoId) }),
      verifyGeneration: async () => {
        const current = await readManifest(false);
        if (current.manifest.manifestHash !== manifest.manifestHash) {
          throw createError(ERROR_CODES.INVALID_REQUEST, 'Workspace generation changed during enumeration. Restart without --cursor.');
        }
      }
    });
    const unavailable = unavailableRequestedModes;
    if (strictFailures && unavailable.length) {
      throw createError(ERROR_CODES.NO_INDEX, 'Some requested repository modes are unavailable for workspace enumeration.');
    }
    result.status = unavailable.length ? 'partial' : 'ok';
    result.partialSuccess = unavailable.length > 0;
    result.warnings = [...toArray(selection.warnings), ...toArray(cohortResult?.warnings)];
    result.meta = { manifestHash: manifest.manifestHash, cohorts: cohortResult, selectedRepoIds: selection.selectedRepoIds,
      completeness: { scope: 'eligible-indexed-metadata', unavailable, remainingPages: result.pagination.hasMore } };
    return toStableResponse(result, includePaths);
  }
  const cohortSelectors = request.cohort || request.cohorts?.cohort || [];
  const customSearch = typeof context.searchFn === 'function' && context.searchFn !== coreSearch;
  const customPolicyId = typeof context.searchPolicyId === 'string' && context.searchPolicyId.trim()
    && context.searchPolicyId.length <= 256 ? context.searchPolicyId : null;
  let policyQualified = !customSearch || customPolicyId !== null;
  const manifestRepoMap = new Map(
    toArray(manifest.repos).map((entry) => [entry?.repoId, entry])
  );
  const selectedRepoMap = new Map(selection.selectedRepos.map(repo => [repo.repoId, repo]));
  const capturedModePlans = new Map();
  const policyIdentities = [];
  const { loadFederatedSearchPolicy, captureFederatedSearchPolicy } = policyQualified
    ? await import('./effective-plan.js') : {};
  // This uses the same bounded repository concurrency as execution. Load config
  // and auto-policy once per repo, then normalize all its pinned mode calls.
  let policyCursor = 0;
  const policyWorkers = await Promise.allSettled(Array.from({ length: Math.min(concurrency, activeRepoIds.length) }, async () => {
    while (policyCursor < activeRepoIds.length) {
      checkAbort();
      const repoId = activeRepoIds[policyCursor++];
      const repo = selectedRepoMap.get(repoId);
      const pinned = buildPinnedFederatedModePlans({ modes: Array.from(repoEligibleModesById.get(repoId) || []),
        manifestRepo: manifestRepoMap.get(repoId), args: basePerRepoArgs });
      const plans = (pinned.length ? pinned : [{ modeFlag: null, modesCovered: new Set(requestedModes) }])
        .map(plan => ({ ...plan, args: bindFederatedBuildRef(applyModeOverride(basePerRepoArgs, plan.modeFlag), plan.indexRef) }));
      capturedModePlans.set(repoId, plans);
      if (!loadFederatedSearchPolicy) continue;
      try {
        const inputs = await loadFederatedSearchPolicy(repo.repoRootCanonical, context.signal);
        for (const plan of plans) {
          const exactMode = plan.modesCovered.size === 1 ? [...plan.modesCovered][0] : null;
          plan.policy = captureFederatedSearchPolicy(inputs, { args: plan.args, query: perRepoQuery, exactMode });
          policyIdentities.push({ repoId, modes: [...plan.modesCovered].sort(), identity: plan.policy.identity });
        }
      } catch (error) {
        observeStorageResource(error, { phase: 'federated-search-policy' }).requireSettled();
        if (isFederatedAbortError(error, context.signal)) throw error;
        policyQualified = false;
        for (const plan of plans) plan.policyError = error;
      }
    }
  }));
  const failedPolicyWorker = policyWorkers.find(outcome => outcome.status === 'rejected');
  if (failedPolicyWorker) throw failedPolicyWorker.reason;
  policyIdentities.sort((left, right) => {
    const a = stableStringify(left), b = stableStringify(right); return a < b ? -1 : a > b ? 1 : 0;
  });
  const cachePath = policyQualified ? resolveFederatedQueryCachePath(manifest, workspaceConfig.repoSetId) : null;
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
      effectivePlans: policyIdentities,
      searchPolicyId: customPolicyId,
      perRepoArgs: basePerRepoArgs,
      requestedBackend: request.search?.backend || request.backend || null,
      requestedAnn: request.search?.ann ?? request.ann ?? null,
      debugIncludePaths: includePaths === true,
      strict: strictFailures === true
    }
  });
  const cacheKeyInfo = buildFederatedQueryCacheKey(cacheKeyPayload);
  const emitShadow = (pools, manifestRepos = null) => {
    if (context.shadowRouting !== true || typeof context.onShadowRouting !== 'function') return;
    try {
      publishFederatedShadow(context, captureFederatedShadow({ query, queryAst: context.queryAst || null,
        manifest, selectedByMode, requestedModes, perRepoResults: pools, manifestRepos,
        queryKey: cacheKeyInfo.keyHash, budget: topN, signal: context.signal }));
    } catch { publishFederatedShadow(context, { authoritative: false, complete: false, reason: 'shadow-failed', metrics: null }); }
  };
  let cacheData = await loadFederatedQueryCache({
    cachePath,
    repoSetId: workspaceConfig.repoSetId
  });
  checkAbort();
  const cachedEntry = policyQualified ? findFederatedQueryCacheEntry(cacheData, {
    keyHash: cacheKeyInfo.keyHash,
    manifestHash: manifest.manifestHash,
    policy: cachePolicy,
    now: timeAnchor
  }) : null;
  if (isReusableFederatedCacheResult(cachedEntry?.result, { manifestHash: manifest.manifestHash,
    repoSetId: workspaceConfig.repoSetId, selectedRepoIds: selection.selectedRepoIds,
    selectedReposByMode: selectedByMode, topN, strictFailures })) {
    await verifyRankedGeneration();
    emitShadow(null);
    touchFederatedQueryCacheEntry(cacheData, cacheKeyInfo.keyHash, new Date(timeAnchor).toISOString());
    try {
      const touched = await persistFederatedQueryCacheTouch({ cachePath, cache: cacheData,
        keyHash: cacheKeyInfo.keyHash, maxEntries: cachePolicy.maxEntries });
      if (!touched) await persistFederatedQueryCache({ cachePath, cache: cacheData });
    } catch (error) { observeStorageResource(error, { phase: 'federated-cache-touch' }).requireSettled(); }
    checkAbort();
    return structuredClone(cachedEntry.result);
  }
  const persistCachedResult = async (result) => {
    if (!policyQualified) return;
    checkAbort();
    try {
      upsertFederatedQueryCacheEntry(cacheData, {
        keyHash: cacheKeyInfo.keyHash,
        keyPayloadHash: cacheKeyInfo.keyPayloadHash,
        manifestHash: manifest.manifestHash,
        result,
        now: new Date(timeAnchor).toISOString(),
        policy: cachePolicy
      });
      await persistFederatedQueryCache({
        cachePath,
        cache: cacheData
      });
    } catch (error) { observeStorageResource(error, { phase: 'federated-cache-checkpoint' }).requireSettled(); }
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
  const retirement = createFederatedCacheRetirement();
  const getSharedCaches = () => {
    if (sharedCaches) return sharedCaches;
    sharedCaches = {
      indexCache: context.indexCache || createIndexCache(),
      sqliteCache: context.sqliteCache || createSqliteDbCache()
    };
    retirement.register({ repoRoot: workspaceConfig.repoSetId,
      indexCache: context.indexCache ? null : sharedCaches.indexCache,
      sqliteCache: context.sqliteCache ? null : sharedCaches.sqliteCache });
    return sharedCaches;
  };
  const searchFn = typeof context.searchFn === 'function' ? context.searchFn : coreSearch;
  const perRepoResults = [];
  const perRepoErrors = [];
  const repoMap = new Map(workspaceConfig.repos.map((repo) => [repo.repoId, repo]));
  const repoOutcomes = new Map();

  const recordRepoOutcome = (repoId, patch) => {
    const existing = repoOutcomes.get(repoId) || { repoId };
    repoOutcomes.set(repoId, {
      ...existing,
      ...patch
    });
  };

  const buildRepoReports = () => sortDiagnostics(selection.selectedRepos.map((repo) => {
    const manifestRepo = manifestRepoMap.get(repo.repoId) || null;
    const outcome = repoOutcomes.get(repo.repoId) || null;
    const eligibleModes = sortModes(repoEligibleModesById.get(repo.repoId) || []);
    const fulfilledModes = sortModes(outcome?.fulfilledModes || []);
    const unavailableModes = unavailableRequestedModes.filter(entry => entry.repoId === repo.repoId)
      .map(entry => entry.mode)
      .map((mode) => ({
        mode,
        availabilityReason: manifestRepo?.indexes?.[mode]?.availabilityReason || 'not-eligible-for-request'
      }));
    const executionFailures = Array.isArray(outcome?.executionFailures)
      ? outcome.executionFailures.slice()
      : [];
    const hitCounts = outcome?.hitCounts || {
      code: 0,
      prose: 0,
      extractedProse: 0,
      records: 0
    };
    const hitCount = Object.values(hitCounts).reduce((sum, value) => sum + Number(value || 0), 0);
    const status = outcome?.status || 'skipped';
    return {
      repoId: repo.repoId,
      status,
      completeness: resolveRepoCompleteness({
        status,
        eligibleModes,
        fulfilledModes,
        unavailableModes,
        executionFailures,
        hitCount
      }),
      freshness: buildRepoFreshness(manifestRepo, requestedModes, manifest.generatedAt),
      modes: {
        requested: requestedModes.slice(),
        eligible: eligibleModes,
        fulfilled: fulfilledModes,
        unavailable: unavailableModes,
        executionFailures,
        hitCounts
      },
      error: outcome?.error || null
    };
  }));

  if (!activeRepoIds.length) {
    const emptyResponse = buildFederatedResponse({
      workspaceConfig,
      manifest,
      selection,
      cohortResult,
      topN,
      perRepoTop,
      concurrency,
      mergeStrategy: request.merge?.strategy || 'rrf',
      rrfK,
      strictFailures,
      includePaths,
      repos: buildRepoReports(),
      warnings: [...toArray(selection.warnings), ...toArray(cohortResult?.warnings)]
    });
    const stable = toStableResponse(emptyResponse, includePaths);
    await verifyRankedGeneration();
    await persistCachedResult(stable);
    checkAbort();
    emitShadow([]);
    return stable;
  }

  const admission = createFederatedAdmission(context.signal);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (admission.accepting()) {
      const current = cursor;
      if (current >= activeRepoIds.length) return;
      cursor += 1;
      const repoId = activeRepoIds[current];
      const repo = repoMap.get(repoId);
      if (!repo) continue;
      try {
        let repoCaches = null;
        if (resolveRepoCaches) {
          try {
            repoCaches = await resolveRepoCaches(repo.repoRootCanonical);
          } catch (error) {
            // Cache resolver failures are repo-scoped faults. In non-strict mode
            // we downgrade them to diagnostics so one stale/broken repo does not
            // abort the full federated fanout.
            const aborted = isFederatedAbortError(error, context.signal);
            perRepoErrors.push({
              repoId: repo.repoId,
              error
            });
            if (strictFailures || aborted) {
              throw admission.stop(error);
            }
            recordRepoOutcome(repo.repoId, {
              status: error?.code === ERROR_CODES.NO_INDEX ? 'missing_index' : 'error',
              error: {
                code: error?.code || ERROR_CODES.INTERNAL,
                message: error?.message || String(error)
              },
              fulfilledModes: [],
              executionFailures: [],
              hitCounts: {
                code: 0,
                prose: 0,
                extractedProse: 0,
                records: 0
              }
            });
            continue;
          }
        }
        if (!admission.accepting()) return;
        const fallbackCaches = getSharedCaches();
        const admittedBuild = manifestRepoMap.get(repo.repoId)?.build || null;
        const resolvedGeneration = buildRepoGenerationContext(repoCaches);
        if (resolvedGeneration && admittedBuild && (
          (resolvedGeneration.buildGenerationKey && resolvedGeneration.buildGenerationKey !== admittedBuild.generationKey)
          || (resolvedGeneration.buildId && resolvedGeneration.buildId !== admittedBuild.buildId)
          || (resolvedGeneration.activeBuildRoot && resolvedGeneration.activeBuildRoot !== admittedBuild.activeRoot)
        )) {
          throw createError(ERROR_CODES.INVALID_REQUEST, `Repository ${repo.repoId} generation changed after workspace admission. Retry the search.`);
        }
        let callSucceeded = false;
        const modePlans = capturedModePlans.get(repo.repoId);
        const combined = {
          backend: 'federated',
          code: [],
          prose: [],
          extractedProse: [],
          records: []
        };
        let firstRepoError = null;
        const fulfilledModes = new Set();
        const executionFailures = [];
        for (const plan of modePlans) {
          if (!admission.accepting()) return;
          const repoArgs = plan.args;
          try {
            if (plan.policyError) throw plan.policyError;
            const result = await searchFn(repo.repoRootCanonical, {
              [INTERNAL_SEARCH_POLICY]: plan.policy,
              [INTERNAL_ADMITTED_GENERATION]: plan.admittedGeneration,
              args: repoArgs,
              argsMode: 'complete',
              query: perRepoQuery,
              emitOutput: false,
              exitOnError: false,
              indexCache: repoCaches?.indexCache || fallbackCaches.indexCache,
              sqliteCache: repoCaches?.sqliteCache || fallbackCaches.sqliteCache,
              signal: context.signal || null,
              generationContext: admittedBuild ? {
                buildId: admittedBuild.buildId || null,
                buildRoot: admittedBuild.buildRoot || null,
                activeBuildRoot: admittedBuild.activeRoot || null,
                buildGenerationKey: admittedBuild.generationKey || null
              } : resolvedGeneration,
              ...(plan.modesCovered.size === 1 ? { [INTERNAL_EXACT_SEARCH_MODE]: [...plan.modesCovered][0] } : {})
            });
            validateFederatedModeResult(result, plan.modesCovered);
            verifyFederatedModeGeneration({ repoId: repo.repoId, modes: plan.modesCovered, result,
              manifestRepo: manifestRepoMap.get(repo.repoId) });
            if (result?.backend) combined.backend = result.backend;
            for (const mode of plan.modesCovered) {
              const key = MODE_PAYLOAD_KEYS[mode];
              if (!key) continue;
              const hits = Array.isArray(result?.[key]) ? result[key] : [];
              for (let hitIndex = 0; hitIndex < Math.min(hits.length, perRepoTop); hitIndex += 1) {
                combined[key].push(hits[hitIndex]);
              }
              fulfilledModes.add(mode);
            }
            callSucceeded = true;
          } catch (error) {
            const aborted = isFederatedAbortError(error, context.signal);
            perRepoErrors.push({
              repoId: repo.repoId,
              error
            });
            if (!firstRepoError) firstRepoError = error;
            if (strictFailures || aborted) {
              throw admission.stop(error);
            }
            executionFailures.push({
              modes: Array.from(plan.modesCovered).sort(),
              code: error?.code || ERROR_CODES.INTERNAL,
              message: error?.message || String(error)
            });
          }
        }
        if (!callSucceeded) {
          const error = firstRepoError || createError(
            ERROR_CODES.NO_INDEX,
            `Federated search failed for ${repo.repoId}: no eligible mode call succeeded.`
          );
          recordRepoOutcome(repo.repoId, {
            status: error?.code === ERROR_CODES.NO_INDEX ? 'missing_index' : 'error',
            error: {
              code: error?.code || ERROR_CODES.INTERNAL,
              message: error?.message || String(error)
            },
            fulfilledModes: [],
            executionFailures,
            hitCounts: {
              code: 0,
              prose: 0,
              extractedProse: 0,
              records: 0
            }
          });
          continue;
        }
        perRepoResults.push({
          repoId: repo.repoId,
          repoAlias: repo.alias,
          priority: repo.priority || 0,
          result: combined,
          fulfilledModes: Array.from(fulfilledModes).sort(),
          executionFailures
        });
        recordRepoOutcome(repo.repoId, {
          status: 'ok',
          error: null,
          fulfilledModes: Array.from(fulfilledModes).sort(),
          executionFailures,
          hitCounts: {
            code: combined.code.length,
            prose: combined.prose.length,
            extractedProse: combined.extractedProse.length,
            records: combined.records.length
          }
        });
      } catch (error) {
        throw admission.stop(error);
      }
    }
  });

  // Strict failure remains fail-fast, but sibling workers may still be running.
  // Keep request-local caches alive until every worker settles, then retire
  // only caches created here. Host-provided caches keep their host ownership.
  retirement.start(workers, admission.dispose);
  try {
    await Promise.race([Promise.all(workers), admission.whenStopped]);
  } catch (error) {
    const original = observeStorageResource(error, { phase: 'federation-request' });
    let aborted, message, code;
    try {
      aborted = isFederatedAbortError(error);
      message = typeof error?.message === 'string' ? error.message : typeof error === 'string' ? error : 'Unknown execution failure';
      code = typeof error?.code === 'string' ? error.code : ERROR_CODES.INTERNAL;
    } catch (inspection) {
      throw retirement.attach(original.retain(inspection, { inspectionPresent: true }), original);
    }
    if (aborted) {
      throw retirement.attach(error, original);
    }
    const strictError = createError(
      ERROR_CODES.INTERNAL,
      `Federated search failed in strict mode: ${message.slice(0, 4096)}`
    );
    strictError.code = code;
    strictError.cause = error;
    throw retirement.attach(strictError, original, { ownedError: true });
  }
  await retirement.drain();

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
    rrfK,
    signal: context.signal
  });
  await verifyRankedGeneration();

  const response = buildFederatedResponse({
    workspaceConfig,
    manifest,
    selection,
    cohortResult,
    topN,
    perRepoTop,
    concurrency,
    mergeStrategy: request.merge?.strategy || 'rrf',
    rrfK,
    strictFailures,
    includePaths,
    modeResults: merged,
    repos: buildRepoReports(),
    warnings: [...toArray(selection.warnings), ...toArray(cohortResult?.warnings)]
  });

  const stable = toStableResponse(response, includePaths);
  if(strictFailures && toArray(response.repos).some(repo=>activeRepoIds.includes(repo.repoId)
    && toArray(repo.modes?.eligible).some(mode=>!toArray(repo.modes?.fulfilled).includes(mode)))) {
    throw createError(ERROR_CODES.NO_INDEX,'Federated search did not fulfill every admitted requested mode.');
  }
  // Avoid pinning degraded non-strict responses when any repo failed during fanout.
  if (!perRepoErrors.length) {
    await persistCachedResult(stable);
  }
  emitShadow(perRepoResults, manifestRepoMap);
  checkAbort();
  return stable;
};
