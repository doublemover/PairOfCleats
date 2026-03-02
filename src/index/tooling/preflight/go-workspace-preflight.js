import fsSync from 'node:fs';
import path from 'node:path';
import { runWorkspaceCommandPreflight } from './workspace-command-preflight.js';

const DEFAULT_MODULE_ARGS = Object.freeze(['list', '-m']);
const DEFAULT_MODULE_TIMEOUT_MS = 8000;
const DEFAULT_WARMUP_ARGS = Object.freeze(['list', './...']);
const DEFAULT_WARMUP_TIMEOUT_MS = 20000;
const DEFAULT_WARMUP_MIN_GO_FILES = 120;
const DEFAULT_WARMUP_SCAN_BUDGET = 8000;
const DEFAULT_WARMUP_SCAN_MAX_DEPTH = 7;
const GO_ROOT_MARKER_NAMES = new Set(['go.mod', 'go.work']);

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

const shouldRunGoWorkspaceWarmupPreflight = (repoRoot, server) => {
  if (server?.goWorkspaceWarmup === false) return false;
  const scanOptions = resolveWarmupScanOptions(server);
  const goFileCount = countGoFilesForWarmup(repoRoot, scanOptions);
  return goFileCount >= scanOptions.minGoFiles;
};

const resolveGoWorkspaceWarmupPreflight = ({ ctx, server, repoRoot }) => {
  if (!shouldRunGoWorkspaceWarmupPreflight(repoRoot, server)) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }
  const warmupCommand = resolveWarmupCommand(server);
  return runWorkspaceCommandPreflight({
    ctx,
    cmd: warmupCommand.cmd,
    args: warmupCommand.args,
    timeoutMs: warmupCommand.timeoutMs,
    reasonPrefix: 'go_workspace_warmup_probe',
    label: 'go workspace warmup'
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

export const resolveGoWorkspaceModulePreflight = ({ ctx, server }) => {
  if (!isGoWorkspacePreflightServer(server)) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }
  const repoRoot = String(ctx?.repoRoot || process.cwd());
  const rootShape = resolveGoWorkspaceRootShapePreflight(repoRoot);
  if (rootShape.state !== 'ready') {
    return rootShape;
  }
  const goModPath = path.join(repoRoot, 'go.mod');
  const goWorkPath = path.join(repoRoot, 'go.work');
  if (!fsSync.existsSync(goModPath) && !fsSync.existsSync(goWorkPath)) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }

  const command = resolveModuleCommand(server);
  const modulePreflight = runWorkspaceCommandPreflight({
    ctx,
    cmd: command.cmd,
    args: command.args,
    timeoutMs: command.timeoutMs,
    reasonPrefix: 'go_workspace_module_probe',
    label: 'go workspace module'
  });
  if (modulePreflight.state !== 'ready') {
    return modulePreflight;
  }
  return resolveGoWorkspaceWarmupPreflight({
    ctx,
    server,
    repoRoot
  });
};
