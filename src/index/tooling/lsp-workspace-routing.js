import fs from 'node:fs';
import path from 'node:path';
import { findWorkspaceMarkersNearPaths } from './workspace-model.js';

const normalizePolicy = (value) => (
  String(value || '').trim().toLowerCase() === 'block' ? 'block' : 'warn'
);

const normalizeRelPath = (value) => {
  const normalized = String(value || '.')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return normalized || '.';
};

const scanWorkspaceMarkerRoots = (repoRoot, markerOptions) => {
  const rootAbs = String(repoRoot || process.cwd());
  const candidatePaths = ['__workspace_probe__'];
  try {
    const rootEntries = fs.readdirSync(rootAbs, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry?.isDirectory?.()) continue;
      const dirName = String(entry.name || '').trim();
      if (!dirName) continue;
      candidatePaths.push(`${dirName}/__workspace_probe__`);
    }
  } catch {
    // Fall back to repo-root-only matching when the root cannot be listed.
  }
  return findWorkspaceMarkersNearPaths(rootAbs, candidatePaths, markerOptions);
};

const buildPartitionEntry = ({ partitionKey, rootRel, rootDir, markerName }) => ({
  partitionKey,
  workspaceKey: partitionKey,
  rootRel,
  rootDir,
  markerName: String(markerName || '').trim() || null,
  documents: [],
  targets: []
});

const collectWorkspaceCandidatePaths = (doc, matchingTargets = []) => {
  const candidatePaths = new Set();
  const pushValue = (value) => {
    const normalized = String(value || '').trim();
    if (normalized) candidatePaths.add(normalized);
  };
  pushValue(doc?.virtualPath);
  pushValue(doc?.path);
  pushValue(doc?.containerPath);
  pushValue(doc?.legacyVirtualPath);
  for (const target of (Array.isArray(matchingTargets) ? matchingTargets : [])) {
    pushValue(target?.virtualPath);
    pushValue(target?.chunkRef?.file);
  }
  return Array.from(candidatePaths);
};

const samplePartitionRoots = (partitions) => (
  (Array.isArray(partitions) ? partitions : [])
    .map((entry) => String(entry?.rootRel || '.'))
    .filter(Boolean)
    .slice(0, 4)
    .join(', ')
);

const buildWorkspacePartitionSummary = ({
  providerId,
  state,
  strategy,
  partitioned,
  partitions,
  unmatchedDocuments,
  unmatchedTargets
}) => ({
  providerId: String(providerId || '').trim() || null,
  state,
  strategy,
  partitioned,
  partitionCount: Array.isArray(partitions) ? partitions.length : 0,
  matchedDocumentCount: Array.isArray(partitions)
    ? partitions.reduce((sum, entry) => sum + (Array.isArray(entry?.documents) ? entry.documents.length : 0), 0)
    : 0,
  unmatchedDocumentCount: Array.isArray(unmatchedDocuments) ? unmatchedDocuments.length : 0,
  unmatchedTargetCount: Array.isArray(unmatchedTargets) ? unmatchedTargets.length : 0,
  partitions: (Array.isArray(partitions) ? partitions : []).map((entry) => ({
    partitionKey: entry.partitionKey,
    rootRel: entry.rootRel,
    markerName: entry.markerName || null,
    documentCount: Array.isArray(entry.documents) ? entry.documents.length : 0,
    targetCount: Array.isArray(entry.targets) ? entry.targets.length : 0
  }))
});

export const resolveLspWorkspaceRouting = ({
  repoRoot,
  providerId,
  documents,
  targets,
  workspaceMarkerOptions = null,
  requireWorkspaceModel = false,
  workspaceModelPolicy = 'warn'
}) => {
  const docs = Array.isArray(documents) ? documents : [];
  const targetList = Array.isArray(targets) ? targets : [];
  const policy = normalizePolicy(workspaceModelPolicy);
  const normalizedRepoRoot = String(repoRoot || process.cwd());
  const markerOptions = workspaceMarkerOptions && typeof workspaceMarkerOptions === 'object'
    ? workspaceMarkerOptions
    : null;

  if (!markerOptions) {
    const singlePartition = {
      partitionKey: '.',
      workspaceKey: '.',
      rootRel: '.',
      rootDir: normalizedRepoRoot,
      markerName: null,
      documents: docs.slice(),
      targets: targetList.slice()
    };
    return {
      state: 'ready',
      reasonCode: null,
      checks: [],
      partitions: [singlePartition],
      unmatchedDocuments: [],
      unmatchedTargets: [],
      workspaceModel: buildWorkspacePartitionSummary({
        providerId,
        state: 'ready',
        strategy: 'repo-root',
        partitioned: false,
        partitions: [singlePartition],
        unmatchedDocuments: [],
        unmatchedTargets: []
      })
    };
  }

  const partitionByKey = new Map();
  const partitionKeyByVirtualPath = new Map();
  const unmatchedDocuments = [];
  const targetsByVirtualPath = new Map();
  for (const target of targetList) {
    const targetVirtualPath = String(target?.virtualPath || '').trim();
    if (!targetVirtualPath) continue;
    const list = targetsByVirtualPath.get(targetVirtualPath) || [];
    list.push(target);
    targetsByVirtualPath.set(targetVirtualPath, list);
  }

  for (const doc of docs) {
    const virtualPath = String(doc?.virtualPath || '').trim();
    if (!virtualPath) continue;
    const candidatePaths = collectWorkspaceCandidatePaths(doc, targetsByVirtualPath.get(virtualPath) || []);
    const matches = findWorkspaceMarkersNearPaths(normalizedRepoRoot, candidatePaths, markerOptions);
    const match = matches.length > 0 ? matches[0] : null;
    if (!match) {
      if (requireWorkspaceModel) {
        unmatchedDocuments.push(doc);
        continue;
      }
      const fallbackKey = '.';
      partitionKeyByVirtualPath.set(virtualPath, fallbackKey);
      if (!partitionByKey.has(fallbackKey)) {
        partitionByKey.set(fallbackKey, buildPartitionEntry({
          partitionKey: fallbackKey,
          rootRel: '.',
          rootDir: normalizedRepoRoot,
          markerName: null
        }));
      }
      partitionByKey.get(fallbackKey).documents.push(doc);
      continue;
    }
    const rootRel = normalizeRelPath(match.markerDirRel || '.');
    const partitionKey = rootRel;
    partitionKeyByVirtualPath.set(virtualPath, partitionKey);
    if (!partitionByKey.has(partitionKey)) {
      partitionByKey.set(partitionKey, buildPartitionEntry({
        partitionKey,
        rootRel,
        rootDir: String(match.markerDirAbs || normalizedRepoRoot),
        markerName: match.markerName
      }));
    }
    partitionByKey.get(partitionKey).documents.push(doc);
  }

  const unmatchedTargets = [];
  for (const target of targetList) {
    const virtualPath = String(target?.virtualPath || '').trim();
    const partitionKey = partitionKeyByVirtualPath.get(virtualPath) || null;
    if (!partitionKey) {
      if (requireWorkspaceModel) {
        unmatchedTargets.push(target);
        continue;
      }
      const fallback = partitionByKey.get('.') || buildPartitionEntry({
        partitionKey: '.',
        rootRel: '.',
        rootDir: normalizedRepoRoot,
        markerName: null
      });
      if (!partitionByKey.has('.')) partitionByKey.set('.', fallback);
      fallback.targets.push(target);
      continue;
    }
    const partition = partitionByKey.get(partitionKey);
    if (!partition) {
      unmatchedTargets.push(target);
      continue;
    }
    partition.targets.push(target);
  }

  if (!partitionByKey.size && requireWorkspaceModel && markerOptions) {
    const uniqueRoots = scanWorkspaceMarkerRoots(normalizedRepoRoot, markerOptions);
    if (uniqueRoots.length === 1 && docs.length && targetList.length) {
      const match = uniqueRoots[0];
      const rootRel = normalizeRelPath(match.markerDirRel || '.');
      const fallbackPartition = buildPartitionEntry({
        partitionKey: rootRel,
        rootRel,
        rootDir: String(match.markerDirAbs || normalizedRepoRoot),
        markerName: match.markerName
      });
      fallbackPartition.documents.push(...docs);
      fallbackPartition.targets.push(...targetList);
      partitionByKey.set(rootRel, fallbackPartition);
    }
  }

  const partitions = Array.from(partitionByKey.values())
    .filter((entry) => Array.isArray(entry?.documents) && entry.documents.length && Array.isArray(entry?.targets) && entry.targets.length)
    .sort((left, right) => String(left.rootRel || '.').localeCompare(String(right.rootRel || '.')));

  const checks = [];
  let state = 'ready';
  let reasonCode = null;

  if (!partitions.length) {
    state = policy === 'block' ? 'blocked' : 'degraded';
    reasonCode = `${String(providerId || 'lsp')}_workspace_model_missing`;
    checks.push({
      name: reasonCode,
      status: 'warn',
      message: `${providerId} workspace markers were not found for the selected documents.`
    });
  } else if (
    requireWorkspaceModel
    && unmatchedDocuments.length === docs.length
    && unmatchedTargets.length === targetList.length
    && partitions.length === 1
    && docs.length > 0
    && targetList.length > 0
  ) {
    state = 'degraded';
    reasonCode = `${String(providerId || 'lsp')}_workspace_partition_assumed_root`;
    checks.push({
      name: reasonCode,
      status: 'warn',
      message: `${providerId} workspace routing selected a single deterministic workspace root without a direct path match for the requested documents.`
    });
  } else if (unmatchedDocuments.length || unmatchedTargets.length) {
    state = 'degraded';
    reasonCode = `${String(providerId || 'lsp')}_workspace_partition_incomplete`;
    checks.push({
      name: reasonCode,
      status: 'warn',
      message: `${providerId} workspace routing skipped ${unmatchedDocuments.length} document(s) and ${unmatchedTargets.length} target(s) without a deterministic workspace marker match.`
    });
  }

  if (partitions.length > 1) {
    const sample = samplePartitionRoots(partitions);
    const suffix = partitions.length > 4 ? ` (+${partitions.length - 4} more)` : '';
    checks.push({
      name: `${String(providerId || 'lsp')}_workspace_partition_multi_root`,
      status: 'info',
      message: `${providerId} workspace routing partitioned the selection across ${partitions.length} roots (${sample}${suffix}).`
    });
  } else if (partitions.length === 1 && partitions[0].rootRel !== '.') {
    checks.push({
      name: `${String(providerId || 'lsp')}_workspace_partition_narrowed`,
      status: 'info',
      message: `${providerId} workspace routing narrowed the active workspace root to "${partitions[0].rootRel}".`
    });
  }

  const workspaceModel = buildWorkspacePartitionSummary({
    providerId,
    state,
    strategy: 'nearest-marker',
    partitioned: partitions.length > 1,
    partitions,
    unmatchedDocuments,
    unmatchedTargets
  });

  return {
    state,
    reasonCode,
    checks,
    partitions,
    unmatchedDocuments,
    unmatchedTargets,
    workspaceModel
  };
};

const coerceFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const mergeHoverMetrics = (runtimes) => {
  const fields = [
    'requested',
    'succeeded',
    'timedOut',
    'hoverTimedOut',
    'semanticTokensRequested',
    'semanticTokensSucceeded',
    'semanticTokensTimedOut',
    'signatureHelpRequested',
    'signatureHelpSucceeded',
    'signatureHelpTimedOut',
    'inlayHintsRequested',
    'inlayHintsSucceeded',
    'inlayHintsTimedOut',
    'definitionRequested',
    'definitionSucceeded',
    'definitionTimedOut',
    'typeDefinitionRequested',
    'typeDefinitionSucceeded',
    'typeDefinitionTimedOut',
    'referencesRequested',
    'referencesSucceeded',
    'referencesTimedOut',
    'incompleteSymbols',
    'hoverTriggeredByIncomplete',
    'fallbackUsed',
    'skippedByBudget',
    'skippedByKind',
    'skippedByReturnSufficient',
    'skippedByAdaptiveDisable',
    'skippedByGlobalDisable'
  ];
  const merged = {};
  for (const field of fields) {
    merged[field] = runtimes.reduce(
      (sum, runtime) => sum + coerceFiniteNumber(runtime?.hoverMetrics?.[field], 0),
      0
    );
  }
  return merged;
};

export const mergeLspWorkspacePartitionResults = (results, workspaceModel) => {
  const items = Array.isArray(results) ? results.filter(Boolean) : [];
  if (!items.length) {
    return {
      byChunkUid: {},
      diagnosticsCount: 0,
      diagnosticsByChunkUid: {},
      checks: [],
      runtime: workspaceModel ? { workspaceModel } : null
    };
  }
  if (items.length === 1) {
    const only = items[0];
    return {
      byChunkUid: only.byChunkUid || {},
      diagnosticsCount: coerceFiniteNumber(only.diagnosticsCount, 0),
      diagnosticsByChunkUid: only.diagnosticsByChunkUid || {},
      checks: Array.isArray(only.checks) ? only.checks.slice() : [],
      runtime: only.runtime
        ? { ...only.runtime, ...(workspaceModel ? { workspaceModel } : {}) }
        : (workspaceModel ? { workspaceModel } : null)
    };
  }

  const byChunkUid = {};
  const diagnosticsByChunkUid = {};
  const checks = [];
  const runtimes = [];
  for (const entry of items) {
    Object.assign(byChunkUid, entry?.byChunkUid || {});
    Object.assign(diagnosticsByChunkUid, entry?.diagnosticsByChunkUid || {});
    if (Array.isArray(entry?.checks) && entry.checks.length) checks.push(...entry.checks);
    if (entry?.runtime && typeof entry.runtime === 'object') runtimes.push(entry.runtime);
  }
  const mergedRuntime = runtimes.length
    ? {
      capabilities: runtimes.reduce((acc, runtime) => {
        for (const [key, value] of Object.entries(runtime?.capabilities || {})) {
          acc[key] = acc[key] === true || value === true;
        }
        return acc;
      }, {}),
      requests: {
        requests: runtimes.reduce((sum, runtime) => sum + coerceFiniteNumber(runtime?.requests?.requests, 0), 0),
        succeeded: runtimes.reduce((sum, runtime) => sum + coerceFiniteNumber(runtime?.requests?.succeeded, 0), 0),
        failed: runtimes.reduce((sum, runtime) => sum + coerceFiniteNumber(runtime?.requests?.failed, 0), 0),
        timedOut: runtimes.reduce((sum, runtime) => sum + coerceFiniteNumber(runtime?.requests?.timedOut, 0), 0),
        latencyMs: {
          count: runtimes.reduce((sum, runtime) => sum + coerceFiniteNumber(runtime?.requests?.latencyMs?.count, 0), 0),
          p50: runtimes.reduce((max, runtime) => Math.max(max, coerceFiniteNumber(runtime?.requests?.latencyMs?.p50, 0)), 0),
          p95: runtimes.reduce((max, runtime) => Math.max(max, coerceFiniteNumber(runtime?.requests?.latencyMs?.p95, 0)), 0)
        }
      },
      lifecycle: {
        startsInWindow: runtimes.reduce((sum, runtime) => sum + coerceFiniteNumber(runtime?.lifecycle?.startsInWindow, 0), 0),
        crashesInWindow: runtimes.reduce((sum, runtime) => sum + coerceFiniteNumber(runtime?.lifecycle?.crashesInWindow, 0), 0),
        crashLoopTrips: runtimes.reduce((sum, runtime) => sum + coerceFiniteNumber(runtime?.lifecycle?.crashLoopTrips, 0), 0),
        crashLoopQuarantined: runtimes.some((runtime) => runtime?.lifecycle?.crashLoopQuarantined === true),
        fdPressureEvents: runtimes.reduce((sum, runtime) => sum + coerceFiniteNumber(runtime?.lifecycle?.fdPressureEvents, 0), 0),
        fdPressureBackoffActive: runtimes.some((runtime) => runtime?.lifecycle?.fdPressureBackoffActive === true)
      },
      guard: {
        breakerThreshold: runtimes.reduce((max, runtime) => Math.max(max, coerceFiniteNumber(runtime?.guard?.breakerThreshold, 0)), 0),
        consecutiveFailures: runtimes.reduce((max, runtime) => Math.max(max, coerceFiniteNumber(runtime?.guard?.consecutiveFailures, 0)), 0),
        tripCount: runtimes.reduce((sum, runtime) => sum + coerceFiniteNumber(runtime?.guard?.tripCount, 0), 0)
      },
      pooling: {
        enabled: runtimes.some((runtime) => runtime?.pooling?.enabled === true),
        reused: runtimes.some((runtime) => runtime?.pooling?.reused === true),
        sessionKey: runtimes.find((runtime) => runtime?.pooling?.sessionKey)?.pooling?.sessionKey || null,
        recycleCount: runtimes.reduce((sum, runtime) => sum + coerceFiniteNumber(runtime?.pooling?.recycleCount, 0), 0),
        ageMs: runtimes.reduce((max, runtime) => Math.max(max, coerceFiniteNumber(runtime?.pooling?.ageMs, 0)), 0)
      },
      hoverMetrics: mergeHoverMetrics(runtimes),
      workspaceModel
    }
    : (workspaceModel ? { workspaceModel } : null);

  return {
    byChunkUid,
    diagnosticsCount: items.reduce((sum, entry) => sum + coerceFiniteNumber(entry?.diagnosticsCount, 0), 0),
    diagnosticsByChunkUid,
    checks,
    runtime: mergedRuntime
  };
};
