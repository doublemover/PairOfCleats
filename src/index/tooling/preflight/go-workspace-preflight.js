import fsSync from 'node:fs';
import path from 'node:path';
import {
  buildGoWorkspacePartitionKey,
  normalizeWorkspaceRootRel
} from '../go-workspace-partitioning.js';
import { resolveToolingCommandProfile } from '../command-resolver.js';
import { runWorkspaceCommandPreflight } from './workspace-command-preflight.js';
import { findWorkspaceMarkersNearPaths } from '../workspace-model.js';

const DEFAULT_MODULE_ARGS = Object.freeze(['list', '-m']);
const DEFAULT_MODULE_TIMEOUT_MS = 8000;
const DEFAULT_WARMUP_ARGS = Object.freeze(['list', './...']);
const DEFAULT_WARMUP_TIMEOUT_MS = 20000;
const DEFAULT_WARMUP_MIN_GO_FILES = 120;
const DEFAULT_WARMUP_SCAN_BUDGET = 8000;
const DEFAULT_WARMUP_SCAN_MAX_DEPTH = 7;
const DEFAULT_NEGATIVE_CACHE_TTL_MS = 15_000;
const GO_ROOT_MARKER_NAMES = new Set(['go.mod', 'go.work']);
const GO_SOURCE_EXTS = new Set(['.go']);
const GO_WORKSPACE_SCAN_MAX_DEPTH = 6;
const GO_WORKSPACE_SCAN_MAX_MATCHES = 24;

const normalizeGoLanguages = (server) => {
  if (!Array.isArray(server?.languages)) return [];
  return server.languages
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
};

const isGoWorkspacePreflightServer = (server) => {
  const id = String(server?.id || '').trim().toLowerCase();
  const cmd = path.basename(String(server?.cmd || '').trim().toLowerCase() || '');
  const languages = normalizeGoLanguages(server);
  return id === 'gopls' || cmd === 'gopls' || languages.includes('go');
};

const resolveManagedGoCommand = ({
  ctx,
  server,
  requestedCmd,
  requestedArgs,
  probeSuffix
}) => {
  const profile = resolveToolingCommandProfile({
    providerId: `${String(server?.id || 'gopls').trim() || 'gopls'}-${String(probeSuffix || 'go-workspace')}`,
    cmd: String(requestedCmd || 'go').trim() || 'go',
    args: Array.isArray(requestedArgs) ? requestedArgs.map((entry) => String(entry)) : [],
    repoRoot: String(ctx?.repoRoot || process.cwd()),
    toolingConfig: ctx?.toolingConfig || {}
  });
  return String(profile?.resolved?.cmd || requestedCmd || 'go').trim() || 'go';
};

const resolveModuleCommand = (ctx, server) => {
  const requestedCmd = String(server?.goWorkspaceModuleCmd || 'go').trim() || 'go';
  const args = Array.isArray(server?.goWorkspaceModuleArgs) && server.goWorkspaceModuleArgs.length
    ? server.goWorkspaceModuleArgs.map((entry) => String(entry))
    : Array.from(DEFAULT_MODULE_ARGS);
  const timeoutRaw = Number(server?.goWorkspaceModuleTimeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(500, Math.floor(timeoutRaw))
    : DEFAULT_MODULE_TIMEOUT_MS;
  return {
    cmd: resolveManagedGoCommand({
      ctx,
      server,
      requestedCmd,
      requestedArgs: args,
      probeSuffix: 'go-workspace-module'
    }),
    args,
    timeoutMs
  };
};

const resolveWarmupCommand = (ctx, server) => {
  const requestedCmd = String(server?.goWorkspaceWarmupCmd || 'go').trim() || 'go';
  const args = Array.isArray(server?.goWorkspaceWarmupArgs) && server.goWorkspaceWarmupArgs.length
    ? server.goWorkspaceWarmupArgs.map((entry) => String(entry))
    : Array.from(DEFAULT_WARMUP_ARGS);
  const timeoutRaw = Number(server?.goWorkspaceWarmupTimeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(500, Math.floor(timeoutRaw))
    : DEFAULT_WARMUP_TIMEOUT_MS;
  return {
    cmd: resolveManagedGoCommand({
      ctx,
      server,
      requestedCmd,
      requestedArgs: args,
      probeSuffix: 'go-workspace-warmup'
    }),
    args,
    timeoutMs
  };
};

const resolveWarmupScanOptions = (server) => {
  const minGoFilesRaw = Number(server?.goWorkspaceWarmupMinGoFiles);
  const scanBudgetRaw = Number(server?.goWorkspaceWarmupScanBudget);
  const scanMaxDepthRaw = Number(server?.goWorkspaceWarmupScanMaxDepth);
  const minGoFiles = Number.isFinite(minGoFilesRaw)
    ? Math.max(1, Math.floor(minGoFilesRaw))
    : DEFAULT_WARMUP_MIN_GO_FILES;
  const scanBudget = Number.isFinite(scanBudgetRaw)
    ? Math.max(100, Math.floor(scanBudgetRaw))
    : DEFAULT_WARMUP_SCAN_BUDGET;
  const scanMaxDepth = Number.isFinite(scanMaxDepthRaw)
    ? Math.max(1, Math.floor(scanMaxDepthRaw))
    : DEFAULT_WARMUP_SCAN_MAX_DEPTH;
  return {
    minGoFiles,
    scanBudget,
    scanMaxDepth
  };
};

const resolveGoWorkspaceNegativeCacheTtlMs = (server) => {
  const ttlValue = server?.goWorkspaceNegativeCacheTtlMs;
  if (ttlValue == null || ttlValue === '') return DEFAULT_NEGATIVE_CACHE_TTL_MS;
  const ttlRaw = Number(ttlValue);
  if (!Number.isFinite(ttlRaw)) return DEFAULT_NEGATIVE_CACHE_TTL_MS;
  return Math.max(0, Math.floor(ttlRaw));
};

const countSelectedGoDocuments = (documents) => {
  if (!Array.isArray(documents)) return 0;
  let count = 0;
  for (const doc of documents) {
    const languageId = String(doc?.languageId || '').trim().toLowerCase();
    if (languageId === 'go') {
      count += 1;
      continue;
    }
    const ext = path.extname(String(doc?.virtualPath || '')).toLowerCase();
    if (GO_SOURCE_EXTS.has(ext)) count += 1;
  }
  return count;
};

const selectGoDocumentPaths = (documents) => (
  Array.isArray(documents)
    ? documents
      .filter((doc) => {
        const languageId = String(doc?.languageId || '').trim().toLowerCase();
        if (languageId === 'go') return true;
        const ext = path.extname(String(doc?.virtualPath || doc?.path || '')).toLowerCase();
        return GO_SOURCE_EXTS.has(ext);
      })
      .map((doc) => doc?.virtualPath || doc?.path || '')
      .filter(Boolean)
    : []
);

const classifyGoPathScope = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.includes('/vendor/')) return 'vendor';
  if (
    normalized.includes('/gen/')
    || normalized.includes('/generated/')
    || normalized.endsWith('.pb.go')
    || normalized.endsWith('.generated.go')
  ) {
    return 'generated';
  }
  return 'module';
};

const normalizeSelectedGoPath = (value) => (
  String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/#.*$/u, '')
    .replace(/^\.poc-vfs\//u, '')
    .replace(/^file:\/+/u, '')
    .replace(/^\/+([a-z]:\/)/iu, '$1')
);

const splitNormalizedPathSegments = (value) => (
  normalizeSelectedGoPath(value)
    .split('/')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
);

const countSharedPathPrefixSegments = (leftValue, rightValue) => {
  const left = splitNormalizedPathSegments(leftValue);
  const right = splitNormalizedPathSegments(rightValue);
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) {
    count += 1;
  }
  return count;
};

const selectNearestNestedGoWorkspaceRoot = (selectedPath, nestedRoots) => {
  const candidates = Array.isArray(nestedRoots) ? nestedRoots : [];
  if (!candidates.length) return null;
  const containing = candidates.filter((entry) => (
    selectedPath === entry.rootRel || selectedPath.startsWith(`${entry.rootRel}/`)
  ));
  if (containing.length > 0) return containing[0] || null;
  const scored = candidates
    .map((entry) => ({
      entry,
      score: countSharedPathPrefixSegments(selectedPath, entry.rootRel)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftDepth = splitNormalizedPathSegments(left.entry.rootRel).length;
      const rightDepth = splitNormalizedPathSegments(right.entry.rootRel).length;
      if (rightDepth !== leftDepth) return rightDepth - leftDepth;
      return String(left.entry.rootRel || '').localeCompare(String(right.entry.rootRel || ''));
    });
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    const firstDepth = splitNormalizedPathSegments(scored[0].entry.rootRel).length;
    const secondDepth = splitNormalizedPathSegments(scored[1].entry.rootRel).length;
    if (firstDepth === secondDepth) return null;
  }
  return scored[0].entry || null;
};

const scanNestedGoMarkerRoots = (
  repoRoot,
  {
    maxDepth = GO_WORKSPACE_SCAN_MAX_DEPTH,
    maxMatches = GO_WORKSPACE_SCAN_MAX_MATCHES
  } = {}
) => {
  const root = String(repoRoot || '').trim();
  if (!root) return [];
  const matches = [];
  const queue = [{ dir: root, rootRel: '.', depth: 0 }];
  while (queue.length > 0 && matches.length < maxMatches) {
    const next = queue.shift();
    if (!next) break;
    let entries = [];
    try {
      entries = fsSync.readdirSync(next.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const markerEntry = entries.find((entry) => (
      entry?.isFile?.() && GO_ROOT_MARKER_NAMES.has(String(entry.name || '').toLowerCase())
    ));
    if (markerEntry && next.rootRel !== '.') {
      matches.push({
        rootRel: next.rootRel,
        rootDir: next.dir,
        markerName: String(markerEntry.name || '').trim() || 'go.mod'
      });
      continue;
    }
    if (next.depth >= maxDepth) continue;
    for (const entry of entries) {
      if (!entry?.isDirectory?.()) continue;
      const entryName = String(entry.name || '').trim();
      const lowerName = entryName.toLowerCase();
      if (!entryName || entryName.startsWith('.')) continue;
      if (lowerName === 'node_modules' || lowerName === 'vendor' || lowerName === '.git') continue;
      queue.push({
        dir: path.join(next.dir, entryName),
        rootRel: normalizeWorkspaceRootRel(
          next.rootRel === '.'
            ? entryName
            : path.posix.join(next.rootRel, entryName)
        ),
        depth: next.depth + 1
      });
    }
  }
  return matches.sort((left, right) => left.rootRel.localeCompare(right.rootRel));
};

const buildFallbackGoWorkspacePartitions = (repoRoot, selectedGoPaths, nestedRoots) => {
  const normalizedRoots = Array.isArray(nestedRoots) ? nestedRoots : [];
  if (!normalizedRoots.length) {
    return {
      partitions: [],
      usedFallback: false,
      narrowedRootRels: []
    };
  }
  const partitionByRoot = new Map();
  for (const selectedPathRaw of Array.isArray(selectedGoPaths) ? selectedGoPaths : []) {
    const selectedPath = normalizeSelectedGoPath(selectedPathRaw);
    if (!selectedPath) continue;
    const match = selectNearestNestedGoWorkspaceRoot(selectedPath, normalizedRoots)
      || (normalizedRoots.length === 1 ? normalizedRoots[0] : null);
    if (!match) continue;
    const scope = classifyGoPathScope(selectedPath);
    const partition = partitionByRoot.get(match.rootRel) || {
      rootRel: match.rootRel,
      rootDir: match.rootDir,
      markerName: match.markerName,
      workspaceKey: buildGoWorkspacePartitionKey({
        repoRoot,
        rootRel: match.rootRel,
        markerName: match.markerName,
        scope
      }),
      scope,
      selectedPaths: []
    };
    partition.selectedPaths.push(String(selectedPathRaw));
    partitionByRoot.set(match.rootRel, partition);
  }
  return {
    partitions: Array.from(partitionByRoot.values())
      .sort((left, right) => String(left.rootRel || '.').localeCompare(String(right.rootRel || '.'))),
    usedFallback: partitionByRoot.size > 0,
    narrowedRootRels: Array.from(partitionByRoot.keys()).sort((left, right) => left.localeCompare(right))
  };
};

const buildSelectedGoWorkspacePartitions = (repoRoot, selectedGoPaths) => {
  const partitionByRoot = new Map();
  const unmatchedPaths = [];
  for (const selectedPath of Array.isArray(selectedGoPaths) ? selectedGoPaths : []) {
    const matches = findWorkspaceMarkersNearPaths(repoRoot, [selectedPath], { exactNames: ['go.mod', 'go.work'] });
    const match = matches.length > 0 ? matches[0] : null;
    if (!match) {
      unmatchedPaths.push(String(selectedPath));
      continue;
    }
    const rootRel = normalizeWorkspaceRootRel(match.markerDirRel || '.');
    const scope = classifyGoPathScope(selectedPath);
    const workspaceKey = buildGoWorkspacePartitionKey({
      repoRoot,
      rootRel,
      markerName: match.markerName || 'go.mod',
      scope
    });
    const partition = partitionByRoot.get(rootRel) || {
      rootRel,
      rootDir: String(match.markerDirAbs || repoRoot),
      markerName: String(match.markerName || '').trim() || 'go.mod',
      workspaceKey,
      scope,
      selectedPaths: []
    };
    partition.selectedPaths.push(String(selectedPath));
    partitionByRoot.set(rootRel, partition);
  }
  return {
    partitions: Array.from(partitionByRoot.values())
      .sort((left, right) => String(left.rootRel || '.').localeCompare(String(right.rootRel || '.'))),
    unmatchedPaths
  };
};

const formatPartitionList = (partitions) => (
  (Array.isArray(partitions) ? partitions : [])
    .map((entry) => String(entry?.rootRel || '.'))
    .filter(Boolean)
    .slice(0, 4)
    .join(', ')
);

const toPartitionScopedCheck = (check, partition) => {
  if (!check || typeof check !== 'object') return null;
  const rootRel = String(partition?.rootRel || '.').trim() || '.';
  const message = String(check.message || '').trim();
  return {
    ...check,
    message: message ? `${message} [partition=${rootRel}]` : `[partition=${rootRel}]`
  };
};

const countGoFilesForWarmup = (repoRoot, options) => {
  const minGoFiles = Number(options?.minGoFiles) || DEFAULT_WARMUP_MIN_GO_FILES;
  const scanBudget = Number(options?.scanBudget) || DEFAULT_WARMUP_SCAN_BUDGET;
  const scanMaxDepth = Number(options?.scanMaxDepth) || DEFAULT_WARMUP_SCAN_MAX_DEPTH;
  const queue = [{ dir: repoRoot, depth: 0 }];
  let scannedEntries = 0;
  let goFiles = 0;
  while (queue.length > 0 && scannedEntries < scanBudget && goFiles < minGoFiles) {
    const next = queue.shift();
    if (!next) break;
    let entries = [];
    try {
      entries = fsSync.readdirSync(next.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      scannedEntries += 1;
      if (scannedEntries >= scanBudget || goFiles >= minGoFiles) break;
      const entryName = String(entry?.name || '');
      const lowerName = entryName.toLowerCase();
      if (entry?.isFile?.() && lowerName.endsWith('.go')) {
        goFiles += 1;
        continue;
      }
      if (!entry?.isDirectory?.()) continue;
      if (entryName.startsWith('.')) continue;
      if (lowerName === 'node_modules' || lowerName === 'vendor') continue;
      if ((next.depth + 1) > scanMaxDepth) continue;
      queue.push({
        dir: path.join(next.dir, entryName),
        depth: next.depth + 1
      });
    }
  }
  return goFiles;
};

const shouldRunGoWorkspaceWarmupPreflight = (repoRoot, server, documents = null) => {
  if (server?.goWorkspaceWarmup === false) return false;
  const scanOptions = resolveWarmupScanOptions(server);
  const selectedGoDocuments = countSelectedGoDocuments(documents);
  if (selectedGoDocuments > 0) {
    return selectedGoDocuments >= scanOptions.minGoFiles;
  }
  const goFileCount = countGoFilesForWarmup(repoRoot, scanOptions);
  return goFileCount >= scanOptions.minGoFiles;
};

const resolveGoWorkspaceWarmupPreflight = async ({
  ctx,
  server,
  repoRoot,
  abortSignal = null,
  documents = null,
  watchedFiles = []
}) => {
  if (!shouldRunGoWorkspaceWarmupPreflight(repoRoot, server, documents)) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }
  const warmupCommand = resolveWarmupCommand(ctx, server);
  const negativeCacheTtlMs = resolveGoWorkspaceNegativeCacheTtlMs(server);
  return await runWorkspaceCommandPreflight({
    ctx,
    cwd: repoRoot,
    cmd: warmupCommand.cmd,
    args: warmupCommand.args,
    timeoutMs: warmupCommand.timeoutMs,
    abortSignal,
    reasonPrefix: 'go_workspace_warmup_probe',
    label: 'go workspace warmup',
    log: typeof ctx?.logger === 'function' ? ctx.logger : () => {},
    successCache: {
      repoRoot,
      cacheRoot: ctx?.cache?.dir || null,
      namespace: 'go-workspace-warmup',
      watchedFiles,
      extra: {
        command: warmupCommand.cmd,
        args: warmupCommand.args,
        minGoFiles: resolveWarmupScanOptions(server).minGoFiles
      }
    },
    cacheMaxAgeMsByState: {
      degraded: negativeCacheTtlMs
    }
  });
};

const resolveGoWorkspaceRootShapePreflight = (repoRoot) => {
  let rootEntries = [];
  try {
    rootEntries = fsSync.readdirSync(repoRoot, { withFileTypes: true });
  } catch {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }
  const rootHasMarker = rootEntries.some((entry) => (
    entry?.isFile?.() && GO_ROOT_MARKER_NAMES.has(String(entry.name || '').toLowerCase())
  ));
  if (rootHasMarker) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }
  const nestedMarkerRoots = scanNestedGoMarkerRoots(repoRoot);
  const nestedMarkerDirs = nestedMarkerRoots.map((entry) => entry.rootRel);
  if (rootHasMarker || !nestedMarkerDirs.length) {
    return {
      state: 'ready',
      reasonCode: null,
      message: '',
      check: null,
      checks: [],
      nestedMarkerDirs,
      nestedMarkerRoots
    };
  }
  if (nestedMarkerDirs.length === 1) {
    const message = `go workspace marker found only in nested directory "${nestedMarkerDirs[0]}"; module root may need explicit narrowing.`;
    return {
      state: 'degraded',
      reasonCode: 'go_workspace_module_root_nested',
      message,
      check: {
        name: 'go_workspace_module_root_nested',
        status: 'warn',
        message
      },
      checks: [],
      nestedMarkerDirs,
      nestedMarkerRoots
    };
  }
  const sample = nestedMarkerDirs.slice(0, 4).join(', ');
  const suffix = nestedMarkerDirs.length > 4 ? ` (+${nestedMarkerDirs.length - 4} more)` : '';
  const message = `go workspace markers found in multiple nested directories (${sample}${suffix}); module root is ambiguous.`;
  return {
    state: 'degraded',
    reasonCode: 'go_workspace_module_root_ambiguous',
    message,
    check: {
      name: 'go_workspace_module_root_ambiguous',
      status: 'warn',
      message
    },
    checks: [],
    nestedMarkerDirs,
    nestedMarkerRoots
  };
};

export const resolveGoWorkspaceModulePreflight = async ({
  ctx,
  server,
  abortSignal = null,
  documents = null
}) => {
  if (!isGoWorkspacePreflightServer(server)) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }
  const selectedGoDocuments = countSelectedGoDocuments(documents);
  if (Array.isArray(documents) && documents.length > 0 && selectedGoDocuments <= 0) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }
  const repoRoot = String(ctx?.repoRoot || process.cwd());
  const selectedGoPaths = selectGoDocumentPaths(documents);
  const goModPath = path.join(repoRoot, 'go.mod');
  const goWorkPath = path.join(repoRoot, 'go.work');
  const repoHasWorkspaceMarker = fsSync.existsSync(goModPath) || fsSync.existsSync(goWorkPath);
  const selectedWorkspace = buildSelectedGoWorkspacePartitions(repoRoot, selectedGoPaths);
  const rootShape = resolveGoWorkspaceRootShapePreflight(repoRoot);
  const extraChecks = [];
  let unmatchedSelectedGoPaths = Array.isArray(selectedWorkspace.unmatchedPaths)
    ? selectedWorkspace.unmatchedPaths.slice()
    : [];
  let partitions = selectedWorkspace.partitions;
  if (!partitions.length && repoHasWorkspaceMarker) {
    partitions = [{
      rootRel: '.',
      rootDir: repoRoot,
      markerName: fsSync.existsSync(goWorkPath) ? 'go.work' : 'go.mod',
      workspaceKey: buildGoWorkspacePartitionKey({
        repoRoot,
        rootRel: '.',
        markerName: fsSync.existsSync(goWorkPath) ? 'go.work' : 'go.mod',
        scope: 'module'
      }),
      scope: 'module',
      selectedPaths: selectedGoPaths.slice()
    }];
  }
  if (!partitions.length && selectedGoPaths.length > 0 && !repoHasWorkspaceMarker) {
    const fallbackPartitions = buildFallbackGoWorkspacePartitions(
      repoRoot,
      selectedGoPaths,
      rootShape.nestedMarkerRoots || []
    );
    if (fallbackPartitions.usedFallback) {
      partitions = fallbackPartitions.partitions;
      unmatchedSelectedGoPaths = [];
      const narrowedList = fallbackPartitions.narrowedRootRels.slice(0, 4).join(', ');
      const suffix = fallbackPartitions.narrowedRootRels.length > 4
        ? ` (+${fallbackPartitions.narrowedRootRels.length - 4} more)`
        : '';
      extraChecks.push({
        name: 'go_workspace_root_scan_narrowed',
        status: 'warn',
        message: `gopls narrowed selected Go documents to nested workspace roots (${narrowedList}${suffix || ''}) instead of treating the repo root as a blocked workspace.`
      });
    }
  }

  if (selectedGoPaths.length > 0 && !partitions.length) {
    const hasNestedRoots = Array.isArray(rootShape.nestedMarkerRoots) && rootShape.nestedMarkerRoots.length > 0;
    if (!repoHasWorkspaceMarker && !hasNestedRoots) {
      const message = 'gopls found Go documents, but no go.mod/go.work roots were found anywhere in the repo; failing open without Go workspace coverage.';
      return {
        state: 'degraded',
        reasonCode: 'go_workspace_missing_root_fail_open',
        message,
        check: {
          name: 'go_workspace_missing_root_fail_open',
          status: 'warn',
          message
        },
        checks: [
          {
            name: 'gopls_workspace_model_missing',
            status: 'warn',
            message: 'gopls workspace markers (go.mod/go.work) were not found for the selected Go documents.'
          },
          ...(rootShape.check ? [rootShape.check] : []),
          ...extraChecks
        ]
      };
    }
    const reasonCode = repoHasWorkspaceMarker
      ? 'go_workspace_blocked_incompatible_partition'
      : (rootShape.reasonCode === 'go_workspace_module_root_ambiguous'
        || rootShape.reasonCode === 'go_workspace_module_root_nested'
        ? 'go_workspace_blocked_workspace_shape'
        : 'go_workspace_blocked_missing_root');
    const message = reasonCode === 'go_workspace_blocked_missing_root'
      ? 'gopls workspace markers (go.mod/go.work) not found near selected Go documents.'
      : (reasonCode === 'go_workspace_blocked_incompatible_partition'
        ? 'selected Go documents do not resolve to a compatible gopls workspace partition.'
        : 'gopls workspace shape is present but cannot be narrowed to a compatible partition for the selected documents.');
    return {
      state: 'blocked',
      reasonCode,
      message,
      check: {
        name: reasonCode,
        status: 'warn',
        message
      },
      checks: [
        ...(rootShape.check ? [rootShape.check] : []),
        ...extraChecks
      ],
      blockProvider: true
    };
  }

  if (!partitions.length) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }

  const command = resolveModuleCommand(ctx, server);
  const negativeCacheTtlMs = resolveGoWorkspaceNegativeCacheTtlMs(server);
  const blockedPartitions = [];
  const readyPartitions = [];
  const checks = extraChecks.slice();
  let cachedPartitionCount = 0;
  for (const partition of partitions) {
    const workspaceRoot = partition.rootDir;
    const workspaceGoModPath = path.join(workspaceRoot, 'go.mod');
    const workspaceGoWorkPath = path.join(workspaceRoot, 'go.work');
    const workspaceGoSumPath = path.join(workspaceRoot, 'go.sum');
    const watchedFiles = [workspaceGoModPath, workspaceGoWorkPath, workspaceGoSumPath];
    const modulePreflight = await runWorkspaceCommandPreflight({
      ctx,
      cwd: workspaceRoot,
      cmd: command.cmd,
      args: command.args,
      timeoutMs: command.timeoutMs,
      abortSignal,
      reasonPrefix: 'go_workspace_module_probe',
      label: 'go workspace module',
      log: typeof ctx?.logger === 'function' ? ctx.logger : () => {},
      successCache: {
        repoRoot: workspaceRoot,
        cacheRoot: ctx?.cache?.dir || null,
        namespace: 'go-workspace-module',
        watchedFiles,
        extra: {
          command: command.cmd,
          args: command.args,
          workspaceRoot: partition.rootRel,
          workspaceKey: partition.workspaceKey
        }
      },
      cacheMaxAgeMsByState: {
        degraded: negativeCacheTtlMs
      }
    });
    const partitionResult = modulePreflight.state === 'ready'
      ? await resolveGoWorkspaceWarmupPreflight({
        ctx,
        server,
        repoRoot: workspaceRoot,
        abortSignal,
        documents,
        watchedFiles
      })
      : modulePreflight;
    if (partitionResult.cached === true) cachedPartitionCount += 1;
    if (partitionResult.check) {
      checks.push(toPartitionScopedCheck(partitionResult.check, partition));
    }
    if (Array.isArray(partitionResult.checks)) {
      for (const check of partitionResult.checks) {
        const scoped = toPartitionScopedCheck(check, partition);
        if (scoped) checks.push(scoped);
      }
    }
    if (partitionResult.state === 'ready') {
      readyPartitions.push(partition);
    } else {
      blockedPartitions.push({
        partition,
        result: partitionResult
      });
    }
  }

  const blockedWorkspaceKeys = blockedPartitions.map((entry) => entry.partition.workspaceKey);
  const blockedWorkspaceRoots = blockedPartitions.map((entry) => entry.partition.rootRel);
  const cached = partitions.length > 0 && cachedPartitionCount === partitions.length;

  if (!readyPartitions.length && blockedPartitions.length) {
    const blockedMessage = `gopls blocked all selected workspace partitions (${formatPartitionList(blockedPartitions.map((entry) => entry.partition)) || 'none'}).`;
    const reasonCode = 'go_workspace_blocked_workspace_shape';
    return {
      state: 'blocked',
      reasonCode,
      message: blockedMessage,
      check: {
        name: reasonCode,
        status: 'warn',
        message: blockedMessage
      },
      checks,
      blockProvider: true,
      cached,
      blockedWorkspaceKeys,
      blockedWorkspaceRoots
    };
  }

  if (unmatchedSelectedGoPaths.length || blockedPartitions.length) {
    const message = `gopls achieved only partial repo coverage: ready=${readyPartitions.length}, blocked=${blockedPartitions.length}, unmatched=${unmatchedSelectedGoPaths.length}.`;
    return {
      state: 'degraded',
      reasonCode: 'go_workspace_partial_repo_coverage',
      message,
      check: {
        name: 'go_workspace_partial_repo_coverage',
        status: 'warn',
        message
      },
      checks,
      cached,
      blockedWorkspaceKeys,
      blockedWorkspaceRoots
    };
  }

  if (partitions.length > 1) {
    const sample = formatPartitionList(partitions);
    const suffix = partitions.length > 4 ? ` (+${partitions.length - 4} more)` : '';
    const message = `go workspace markers found in multiple selected module roots (${sample}${suffix}); runtime will partition gopls sessions per module root.`;
    return {
      state: 'ready',
      reasonCode: 'go_workspace_module_root_partitioned',
      message,
      check: {
        name: 'go_workspace_module_root_partitioned',
        status: 'info',
        message
      },
      checks,
      cached
    };
  }

  return {
    state: 'ready',
    reasonCode: null,
    message: '',
    check: null,
    checks,
    cached
  };
};
