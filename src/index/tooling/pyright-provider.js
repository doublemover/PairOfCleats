import path from 'node:path';
import fsSync from 'node:fs';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { readJsonFileSafe } from '../../shared/files.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { invalidateProbeCacheOnInitializeFailure, resolveToolingCommandProfile } from './command-resolver.js';
import { parsePythonSignature } from './signature-parse/python.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';
import { resolveProviderRequestedCommand } from './provider-command-override.js';
import { filterTargetsForDocuments } from './provider-utils.js';
import { awaitToolingProviderPreflight } from './preflight-manager.js';
import {
  mergePreflightChecks,
  resolveCommandProfilePreflightResult,
  resolveRuntimeCommandFromPreflight
} from './preflight/command-profile-preflight.js';

export const PYTHON_EXTS = ['.py', '.pyi'];
const PYRIGHT_CONFIG_MAX_BYTES = 2 * 1024 * 1024;
const PYRIGHT_WORKSPACE_SCAN_OUTLIER_ENTRY_THRESHOLD = 3000;
const PYRIGHT_WORKSPACE_SCAN_OUTLIER_DURATION_MS = 250;
const PYRIGHT_WORKSPACE_MARKERS = new Set([
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt'
]);

const resolveWorkspaceScanOutlierThresholds = (toolingConfig) => {
  const pyrightConfig = toolingConfig?.pyright && typeof toolingConfig.pyright === 'object'
    ? toolingConfig.pyright
    : {};
  const entryThresholdRaw = Number(pyrightConfig.workspaceScanOutlierEntryThreshold);
  const durationThresholdRaw = Number(pyrightConfig.workspaceScanOutlierDurationMs);
  return {
    entryThreshold: Number.isFinite(entryThresholdRaw)
      ? Math.max(1, Math.floor(entryThresholdRaw))
      : PYRIGHT_WORKSPACE_SCAN_OUTLIER_ENTRY_THRESHOLD,
    durationMs: Number.isFinite(durationThresholdRaw)
      ? Math.max(10, Math.floor(durationThresholdRaw))
      : PYRIGHT_WORKSPACE_SCAN_OUTLIER_DURATION_MS
  };
};

const resolveWorkspaceScanOutlierCheck = ({
  scannedEntries,
  scannedDirs,
  elapsedMs,
  thresholds
}) => {
  if (!Number.isFinite(scannedEntries) || !Number.isFinite(scannedDirs) || !Number.isFinite(elapsedMs)) {
    return null;
  }
  if (scannedEntries < thresholds.entryThreshold && elapsedMs < thresholds.durationMs) {
    return null;
  }
  const message = `pyright workspace scan outlier (entries=${scannedEntries}, dirs=${scannedDirs}, duration=${elapsedMs}ms; thresholds entries>=${thresholds.entryThreshold} or duration>=${thresholds.durationMs}ms).`;
  return {
    name: 'pyright_workspace_scan_outlier',
    status: 'warn',
    message
  };
};

export const __canRunPyrightForTests = (cmd) => (
  resolveToolingCommandProfile({
    providerId: 'pyright',
    cmd,
    args: [],
    repoRoot: process.cwd(),
    toolingConfig: {}
  })?.probe?.ok === true
);

const resolvePyrightWorkspaceConfigPreflight = async ({ ctx }) => {
  const configPath = path.join(String(ctx?.repoRoot || process.cwd()), 'pyrightconfig.json');
  let readError = null;
  const parsed = await readJsonFileSafe(configPath, {
    fallback: null,
    maxBytes: PYRIGHT_CONFIG_MAX_BYTES,
    onError: (info) => {
      readError = info;
    }
  });
  const code = String(readError?.error?.code || '').trim().toUpperCase();
  if (!readError) {
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { state: 'ready', reasonCode: null, message: '', checks: [] };
    }
    const message = 'pyright workspace config (pyrightconfig.json) must be a JSON object.';
    return {
      state: 'degraded',
      reasonCode: 'pyright_workspace_config_invalid',
      message,
      checks: [{
        name: 'pyright_workspace_config_invalid',
        status: 'warn',
        message
      }]
    };
  }
  if (code === 'ENOENT') {
    return { state: 'ready', reasonCode: null, message: '', checks: [] };
  }
  if (code === 'ERR_JSON_FILE_TOO_LARGE') {
    const message = `pyright workspace config exceeds ${PYRIGHT_CONFIG_MAX_BYTES} bytes.`;
    return {
      state: 'degraded',
      reasonCode: 'pyright_workspace_config_too_large',
      message,
      checks: [{
        name: 'pyright_workspace_config_too_large',
        status: 'warn',
        message
      }]
    };
  }
  if (String(readError?.phase || '').toLowerCase() === 'parse') {
    const message = `pyright workspace config is invalid JSON: ${readError?.error?.message || 'parse failed'}`;
    return {
      state: 'degraded',
      reasonCode: 'pyright_workspace_config_invalid',
      message,
      checks: [{
        name: 'pyright_workspace_config_invalid',
        status: 'warn',
        message
      }]
    };
  }
  const message = `pyright workspace config is unreadable: ${readError?.error?.message || 'read failed'}`;
  return {
    state: 'degraded',
    reasonCode: 'pyright_workspace_config_unreadable',
    message,
    checks: [{
      name: 'pyright_workspace_config_unreadable',
      status: 'warn',
      message
    }]
  };
};

const resolvePyrightWorkspaceRootPreflight = ({ ctx }) => {
  const repoRoot = String(ctx?.repoRoot || process.cwd());
  const thresholds = resolveWorkspaceScanOutlierThresholds(ctx?.toolingConfig || {});
  const startedAt = Date.now();
  let rootEntries = [];
  try {
    rootEntries = fsSync.readdirSync(repoRoot, { withFileTypes: true });
  } catch {
    return { state: 'ready', reasonCode: null, message: '', checks: [] };
  }
  let scannedEntries = rootEntries.length;
  let scannedDirs = 0;
  const workspaceRoots = [];
  const rootHasMarker = rootEntries.some((entry) => (
    entry?.isFile?.() && PYRIGHT_WORKSPACE_MARKERS.has(String(entry.name || '').toLowerCase())
  ));
  if (rootHasMarker) workspaceRoots.push('.');
  for (const entry of rootEntries) {
    if (!entry?.isDirectory?.()) continue;
    scannedDirs += 1;
    try {
      const childEntries = fsSync.readdirSync(path.join(repoRoot, entry.name), { withFileTypes: true });
      scannedEntries += childEntries.length;
      const hasMarker = childEntries.some((child) => (
        child?.isFile?.() && PYRIGHT_WORKSPACE_MARKERS.has(String(child.name || '').toLowerCase())
      ));
      if (hasMarker) workspaceRoots.push(String(entry.name || ''));
    } catch {
      // Ignore unreadable child directories for this advisory-only classification.
    }
  }
  const elapsedMs = Date.now() - startedAt;
  const checks = [];
  const outlierCheck = resolveWorkspaceScanOutlierCheck({
    scannedEntries,
    scannedDirs,
    elapsedMs,
    thresholds
  });
  if (outlierCheck) checks.push(outlierCheck);
  if (workspaceRoots.length > 1) {
    const sample = workspaceRoots.slice(0, 4).join(', ');
    const suffix = workspaceRoots.length > 4 ? ` (+${workspaceRoots.length - 4} more)` : '';
    const message = `pyright workspace appears to be monorepo/multi-root (${sample}${suffix}); diagnostics may vary unless workspace root is narrowed.`;
    checks.push({
      name: 'pyright_workspace_mono_root',
      status: 'warn',
      message
    });
    return {
      state: 'degraded',
      reasonCode: 'pyright_workspace_mono_root',
      message,
      checks
    };
  }
  if (outlierCheck) {
    return {
      state: 'degraded',
      reasonCode: 'pyright_workspace_scan_outlier',
      message: outlierCheck.message,
      checks
    };
  }
  return { state: 'ready', reasonCode: null, message: '', checks: [] };
};

export const createPyrightProvider = () => ({
  id: 'pyright',
  preflightId: 'pyright.command-profile',
  preflightClass: 'probe',
  version: '2.0.0',
  label: 'pyright',
  priority: 30,
  languages: ['python'],
  kinds: ['types', 'diagnostics'],
  requires: { cmd: 'pyright-langserver' },
  preflightPolicy: 'optional',
  preflightRuntimeRequirements: [],
  capabilities: {
    supportsVirtualDocuments: true,
    supportsSegmentRouting: true,
    supportsJavaScript: false,
    supportsTypeScript: false,
    supportsSymbolRef: false
  },
  getConfigHash(ctx) {
    const pyright = ctx?.toolingConfig?.pyright || {};
    return hashProviderConfig({
      pyright: {
        ...pyright,
        command: typeof pyright?.command === 'string' ? pyright.command : null,
        args: Array.isArray(pyright?.args) ? pyright.args.map((entry) => String(entry)) : null
      }
    });
  },
  async preflight(ctx) {
    const requestedCommand = resolveProviderRequestedCommand({
      providerId: 'pyright',
      toolingConfig: ctx?.toolingConfig || {},
      defaultCmd: 'pyright-langserver',
      defaultArgs: ['--stdio']
    });
    const commandPreflight = resolveCommandProfilePreflightResult({
      providerId: 'pyright',
      requestedCommand,
      ctx,
      unavailableCheck: {
        name: 'pyright_command_unavailable',
        status: 'warn',
        message: 'pyright-langserver command probe failed; attempting stdio initialization anyway.'
      }
    });
    if (commandPreflight.state !== 'ready') {
      return commandPreflight;
    }
    const workspaceConfigPreflight = await resolvePyrightWorkspaceConfigPreflight({ ctx });
    const workspaceRootPreflight = resolvePyrightWorkspaceRootPreflight({ ctx });
    const checks = mergePreflightChecks(
      commandPreflight?.check,
      commandPreflight?.checks,
      workspaceConfigPreflight?.checks,
      workspaceRootPreflight?.checks
    );
    if (workspaceConfigPreflight.state !== 'ready') {
      return {
        ...commandPreflight,
        state: workspaceConfigPreflight.state || 'degraded',
        reasonCode: workspaceConfigPreflight.reasonCode || null,
        message: workspaceConfigPreflight.message || '',
        ...(checks.length ? { checks } : {})
      };
    }
    if (workspaceRootPreflight.state !== 'ready') {
      return {
        ...commandPreflight,
        state: workspaceRootPreflight.state || 'degraded',
        reasonCode: workspaceRootPreflight.reasonCode || null,
        message: workspaceRootPreflight.message || '',
        ...(checks.length ? { checks } : {})
      };
    }
    return {
      ...commandPreflight,
      ...(checks.length ? { checks } : {})
    };
  },
  async run(ctx, inputs) {
    const log = typeof ctx?.logger === 'function' ? ctx.logger : (() => {});
    const docs = Array.isArray(inputs?.documents)
      ? inputs.documents.filter((doc) => PYTHON_EXTS.includes(path.extname(doc.virtualPath).toLowerCase()))
      : [];
    const targets = filterTargetsForDocuments(inputs?.targets, docs);
    const duplicateChecks = buildDuplicateChunkUidChecks(targets, { label: 'pyright' });
    const checks = [...duplicateChecks];
    if (!docs.length || !targets.length) {
      return {
        provider: { id: 'pyright', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks)
      };
    }
    const pyrightConfig = ctx?.toolingConfig?.pyright || {};
    const preflight = await awaitToolingProviderPreflight(ctx, {
      provider: this,
      inputs: {
        ...inputs,
        documents: docs,
        targets,
        log
      },
      waveToken: typeof inputs?.toolingPreflightWaveToken === 'string'
        ? inputs.toolingPreflightWaveToken
        : null
    });
    if (preflight?.check && typeof preflight.check === 'object') checks.push(preflight.check);
    if (Array.isArray(preflight?.checks)) {
      for (const check of preflight.checks) {
        if (check && typeof check === 'object') checks.push(check);
      }
    }
    const requestedCommand = resolveProviderRequestedCommand({
      providerId: 'pyright',
      toolingConfig: ctx?.toolingConfig || {},
      defaultCmd: 'pyright-langserver',
      defaultArgs: ['--stdio']
    });

    const runtimeCommand = resolveRuntimeCommandFromPreflight({
      preflight,
      fallbackRequestedCommand: requestedCommand,
      missingProfileCheck: {
        name: 'pyright_preflight_command_profile_missing',
        status: 'warn',
        message: 'pyright preflight did not provide a resolved command profile; skipping provider.'
      }
    });
    const resolvedCmd = runtimeCommand.cmd;
    const resolvedArgs = runtimeCommand.args;
    if (!resolvedCmd) {
      checks.push(...runtimeCommand.checks);
      return {
        provider: { id: 'pyright', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks)
      };
    }
    if (runtimeCommand.probeKnown && runtimeCommand.probeOk !== true) {
      log('[index] pyright-langserver command probe failed; attempting stdio initialization.');
      if (!checks.some((entry) => entry?.name === 'pyright_command_unavailable')) {
        checks.push({
          name: 'pyright_command_unavailable',
          status: 'warn',
          message: 'pyright-langserver command probe failed; attempting stdio initialization anyway.'
        });
      }
    }
    const runtimeConfig = resolveLspRuntimeConfig({
      providerConfig: pyrightConfig,
      globalConfigs: [ctx?.toolingConfig || null],
      defaults: {
        timeoutMs: 45000,
        retries: 2,
        breakerThreshold: 5
      }
    });
    const result = await collectLspTypes({
      ...runtimeConfig,
      rootDir: ctx.repoRoot,
      documents: docs,
      targets,
      abortSignal: ctx?.abortSignal || null,
      log,
      providerId: 'pyright',
      adaptiveDegradedHint: preflight?.state === 'degraded',
      adaptiveReasonHint: preflight?.reasonCode || null,
      cmd: resolvedCmd,
      args: resolvedArgs,
      parseSignature: (detail) => parsePythonSignature(detail),
      strict: ctx?.strict !== false,
      vfsRoot: ctx?.buildRoot || ctx.repoRoot,
      vfsTokenMode: ctx?.toolingConfig?.vfs?.tokenMode,
      vfsIoBatching: ctx?.toolingConfig?.vfs?.ioBatching,
      vfsColdStartCache: ctx?.toolingConfig?.vfs?.coldStartCache,
      indexDir: ctx?.buildRoot || null,
      captureDiagnostics: true
    });
    const diagnostics = appendDiagnosticChecks(
      result.diagnosticsCount
        ? { diagnosticsCount: result.diagnosticsCount, diagnosticsByChunkUid: result.diagnosticsByChunkUid }
        : null,
      [...checks, ...(Array.isArray(result.checks) ? result.checks : [])]
    );
    invalidateProbeCacheOnInitializeFailure({
      checks: result?.checks,
      providerId: 'pyright',
      command: resolvedCmd
    });
    return {
      provider: { id: 'pyright', version: '2.0.0', configHash: this.getConfigHash(ctx) },
      byChunkUid: result.byChunkUid,
      diagnostics: result.runtime
        ? { ...(diagnostics || {}), runtime: result.runtime }
        : diagnostics
    };
  }
});
