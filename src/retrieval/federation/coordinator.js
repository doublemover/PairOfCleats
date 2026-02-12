import path from 'node:path';
import { search as coreSearch } from '../../integrations/core/index.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { stableStringify } from '../../shared/stable-json.js';
import { createIndexCache } from '../index-cache.js';
import { createSqliteDbCache } from '../sqlite-cache.js';
import { loadWorkspaceConfig } from '../../workspace/config.js';
import { generateWorkspaceManifest } from '../../workspace/manifest.js';
import { buildPerRepoArgsFromCli, buildPerRepoArgsFromRequest } from './args.js';
import { selectFederationCohorts } from './cohorts.js';
import { mergeFederatedResults } from './merge.js';
import { selectWorkspaceRepos } from './select.js';

const MODE_PAYLOAD_KEYS = Object.freeze({
  code: 'code',
  prose: 'prose',
  'extracted-prose': 'extractedProse',
  records: 'records'
});

const isAbsoluteLike = (value) => (
  path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)
);

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

const sanitizeObjectPaths = (value) => {
  if (Array.isArray(value)) return value.map((entry) => sanitizeObjectPaths(entry));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && isAbsoluteLike(entry)) {
      out[key] = '<redacted>';
      continue;
    }
    out[key] = sanitizeObjectPaths(entry);
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

const coerceNumber = (value, fallback, min = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
};

const sortDiagnostics = (entries) => entries.slice().sort((a, b) => (
  String(a?.repoId || '').localeCompare(String(b?.repoId || ''))
  || String(a?.status || '').localeCompare(String(b?.status || ''))
));

export const applyCohortPolicy = (input) => selectFederationCohorts(input);

const toStableResponse = (response, includePaths) => {
  if (!includePaths) {
    return JSON.parse(stableStringify(sanitizeObjectPaths(response)));
  }
  return JSON.parse(stableStringify(response));
};

export const runFederatedSearch = async (request = {}, context = {}) => {
  const query = String(request.query || '').trim();
  if (!query) throw createError(ERROR_CODES.INVALID_REQUEST, 'Query is required.');

  const workspacePath = pickWorkspaceSource(request);
  const workspaceConfig = loadWorkspaceConfig(workspacePath);
  if (request.workspaceId && request.workspaceId !== workspaceConfig.repoSetId) {
    throw createError(ERROR_CODES.INVALID_REQUEST, 'workspaceId does not match the provided workspacePath.');
  }

  const manifestResult = await generateWorkspaceManifest(workspaceConfig, { write: true });
  const manifest = manifestResult.manifest;
  const requestedModes = resolveRequestedModes(request.search?.mode || request.mode);
  const selection = selectWorkspaceRepos({
    workspaceConfig,
    select: request.select?.repos || request.select?.select || request.select,
    tag: request.select?.tags || request.tags || request.tag,
    repoFilter: request.select?.repoFilter || request.repoFilter,
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

  const topN = coerceNumber(request.search?.top ?? request.top, 10, 1);
  const perRepoTop = coerceNumber(
    request.limits?.perRepoTop ?? request.perRepoTop,
    Math.min(Math.max(topN * 2, topN), 50),
    1
  );
  const concurrency = coerceNumber(request.limits?.concurrency ?? request.concurrency, 4, 1);
  const rrfK = coerceNumber(request.merge?.rrfK ?? request.rrfK, 60, 1);
  const includePaths = request.debug?.includePaths === true;

  const perRepoArgs = request.rawArgs
    ? buildPerRepoArgsFromCli({ rawArgs: request.rawArgs, perRepoTop })
    : buildPerRepoArgsFromRequest({
      query,
      search: request.search || {},
      perRepoTop
    });

  const indexCache = context.indexCache || createIndexCache();
  const sqliteCache = context.sqliteCache || createSqliteDbCache();
  const searchFn = typeof context.searchFn === 'function' ? context.searchFn : coreSearch;
  const strictFailures = request.strict === true;
  const diagnostics = [];
  const perRepoResults = [];
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
    return toStableResponse(emptyResponse, includePaths);
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
        const result = await searchFn(repo.repoRootCanonical, {
          args: perRepoArgs,
          query,
          emitOutput: false,
          exitOnError: false,
          indexCache,
          sqliteCache,
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
        diagnostics.push({
          repoId: repo.repoId,
          status: error?.code === ERROR_CODES.NO_INDEX ? 'missing_index' : 'error',
          error: {
            code: error?.code || ERROR_CODES.INTERNAL,
            message: error?.message || String(error)
          }
        });
        if (strictFailures) {
          throw error;
        }
      }
    }
  });

  try {
    await Promise.all(workers);
  } catch (error) {
    const strictError = createError(
      ERROR_CODES.INTERNAL,
      `Federated search failed in strict mode: ${error?.message || error}`
    );
    strictError.code = error?.code || ERROR_CODES.INTERNAL;
    throw strictError;
  }

  if (!perRepoResults.length) {
    throw createError(ERROR_CODES.NO_INDEX, 'Federated search failed: no repositories produced results.');
  }

  const merged = mergeFederatedResults({
    perRepoResults,
    topN,
    perRepoTop,
    rrfK
  });

  for (const [mode, payloadKey] of Object.entries(MODE_PAYLOAD_KEYS)) {
    const selectedRepoIds = new Set((selectedByMode[mode] || []).map((repo) => repo.repoId));
    merged[payloadKey] = (merged[payloadKey] || []).filter((hit) => selectedRepoIds.has(hit.repoId));
  }

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

  return toStableResponse(response, includePaths);
};
