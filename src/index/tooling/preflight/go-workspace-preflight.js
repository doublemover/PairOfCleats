import fsSync from 'node:fs';
import path from 'node:path';
import {
  buildGoWorkspacePartitionKey,
  normalizeWorkspaceRootRel
} from '../go-workspace-partitioning.js';
import { runWorkspaceCommandPreflight } from './workspace-command-preflight.js';
import { findWorkspaceMarkersNearPaths } from '../workspace-model.js';

const DEFAULT_MODULE_ARGS = Object.freeze(['list', '-m']);
const DEFAULT_MODULE_TIMEOUT_MS = 8000;
const DEFAULT_WARMUP_ARGS = Object.freeze(['list', './...']);
const DEFAULT_WARMUP_TIMEOUT_MS = 20000;
const DEFAULT_WARMUP_MIN_GO_FILES = 120;
const DEFAULT_WARMUP_SCAN_BUDGET = 8000;
const DEFAULT_WARMUP_SCAN_MAX_DEPTH = 7;
const GO_ROOT_MARKER_NAMES = new Set(['go.mod', 'go.work']);
const GO_SOURCE_EXTS = new Set(['.go']);

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

const resolveModuleCommand = (server) => {
  const cmd = String(server?.goWorkspaceModuleCmd || 'go').trim() || 'go';
  const args = Array.isArray(server?.goWorkspaceModuleArgs) && server.goWorkspaceModuleArgs.length
    ? server.goWorkspaceModuleArgs.map((entry) => String(entry))
    : Array.from(DEFAULT_MODULE_ARGS);
  const timeoutRaw = Number(server?.goWorkspaceModuleTimeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(500, Math.floor(timeoutRaw))
    : DEFAULT_MODULE_TIMEOUT_MS;
  return { cmd, args, timeoutMs };
};

const resolveWarmupCommand = (server) => {
  const cmd = String(server?.goWorkspaceWarmupCmd || 'go').trim() || 'go';
  const args = Array.isArray(server?.goWorkspaceWarmupArgs) && server.goWorkspaceWarmupArgs.length
    ? server.goWorkspaceWarmupArgs.map((entry) => String(entry))
    : Array.from(DEFAULT_WARMUP_ARGS);
  const timeoutRaw = Number(server?.goWorkspaceWarmupTimeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(500, Math.floor(timeoutRaw))
    : DEFAULT_WARMUP_TIMEOUT_MS;
  return { cmd, args, timeoutMs };
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
  const warmupCommand = resolveWarmupCommand(server);
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
  const nestedMarkerDirs = [];
  for (const entry of rootEntries) {
    if (!entry?.isDirectory?.()) continue;
    try {
      const childEntries = fsSync.readdirSync(path.join(repoRoot, entry.name), { withFileTypes: true });
      const hasMarker = childEntries.some((child) => (
        child?.isFile?.() && GO_ROOT_MARKER_NAMES.has(String(child.name || '').toLowerCase())
      ));
      if (hasMarker) nestedMarkerDirs.push(String(entry.name || ''));
    } catch {
      // Ignore unreadable child directories for advisory root-shape classification.
    }
  }
  if (rootHasMarker || !nestedMarkerDirs.length) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
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
      checks: []
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
    checks: []
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

  if (selectedGoPaths.length > 0 && !partitions.length) {
    const rootShape = resolveGoWorkspaceRootShapePreflight(repoRoot);
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
      checks: rootShape.check ? [rootShape.check] : [],
      blockProvider: true
    };
  }

  if (!partitions.length) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }

  const command = resolveModuleCommand(server);
  const blockedPartitions = [];
  const readyPartitions = [];
  const checks = [];
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

  if (selectedWorkspace.unmatchedPaths.length || blockedPartitions.length) {
    const message = `gopls achieved only partial repo coverage: ready=${readyPartitions.length}, blocked=${blockedPartitions.length}, unmatched=${selectedWorkspace.unmatchedPaths.length}.`;
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
