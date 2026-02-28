import path from 'node:path';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { invalidateToolingCommandProbeCache, resolveToolingCommandProfile } from './command-resolver.js';
import { hasWorkspaceMarker } from './workspace-model.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';
import { isPlainObject, normalizeCommandArgs, filterTargetsForDocuments } from './provider-utils.js';

const DEFAULT_RUNTIME_OPTIONS = {
  timeoutMs: 60000,
  retries: 1,
  breakerThreshold: 4
};

const getLogger = (ctx) => (typeof ctx?.logger === 'function' ? ctx.logger : (() => {}));

const toExtensionSet = (extensions) => new Set(
  (Array.isArray(extensions) ? extensions : [])
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
);

const filterProviderDocuments = (documents, extensionSet) => {
  if (!Array.isArray(documents) || !documents.length || !extensionSet.size) return [];
  return documents.filter((doc) => extensionSet.has(path.extname(String(doc?.virtualPath || '')).toLowerCase()));
};

const buildProviderRef = (descriptor, configHash) => ({
  id: descriptor.id,
  version: descriptor.version,
  configHash
});

const buildBaseResult = (providerRef, checks) => ({
  provider: providerRef,
  byChunkUid: {},
  diagnostics: appendDiagnosticChecks(null, checks)
});

const resolveProviderConfig = (ctx, configKey) => (
  (ctx?.toolingConfig && typeof ctx.toolingConfig === 'object' ? ctx.toolingConfig[configKey] : null)
  || {}
);

const resolveProviderConfigHash = (ctx, configKey) => (
  hashProviderConfig({ [configKey]: resolveProviderConfig(ctx, configKey) })
);

const appendRuntimeDiagnostics = (result, checks) => {
  const diagnostics = appendDiagnosticChecks(
    result?.diagnosticsCount
      ? {
        diagnosticsCount: result.diagnosticsCount,
        diagnosticsByChunkUid: result.diagnosticsByChunkUid
      }
      : null,
    checks
  );
  return result?.runtime
    ? { ...(diagnostics || {}), runtime: result.runtime }
    : diagnostics;
};

const resolveRequestedCommand = (descriptor, config) => {
  const configured = typeof config?.cmd === 'string' ? config.cmd.trim() : '';
  const fallback = String(descriptor.command.defaultCmd || descriptor.id).trim();
  const cmd = configured || fallback;
  const requestedArgs = descriptor.command.resolveArgs
    ? descriptor.command.resolveArgs(config)
    : normalizeCommandArgs(config?.args);
  return { cmd, args: requestedArgs };
};

const buildCommandUnavailableCheck = (descriptor, requestedCmd) => {
  const check = descriptor.command.commandUnavailableCheck || {};
  const name = typeof check.name === 'string' && check.name.trim()
    ? check.name.trim()
    : `${descriptor.id}_command_unavailable`;
  const message = typeof check.message === 'function'
    ? check.message(requestedCmd)
    : (typeof check.message === 'string' && check.message.trim()
      ? check.message
      : `${requestedCmd} command probe failed for ${descriptor.label}; attempting stdio initialization anyway.`);
  return { name, status: 'warn', message };
};

const maybeBuildWorkspaceMissingCheck = (descriptor) => {
  const check = descriptor.workspace?.missingCheck || {};
  const name = typeof check.name === 'string' && check.name.trim()
    ? check.name.trim()
    : `${descriptor.id}_workspace_model_missing`;
  const message = typeof check.message === 'string' && check.message.trim()
    ? check.message
    : `${descriptor.label} workspace markers not found; skipping dedicated provider.`;
  return { name, status: 'warn', message };
};

/**
 * Build a dedicated single-server provider with shared lifecycle/diagnostic behavior.
 *
 * This wrapper is intentionally consistent: all dedicated providers follow the same
 * document filtering, workspace gating, probe-warning + stdio-attempt behavior,
 * runtime config merge, and fail-open diagnostics shape.
 *
 * @param {{
 *   id: string,
 *   label: string,
 *   priority: number,
 *   languages: string[],
 *   configKey: string,
 *   docExtensions: string[],
 *   parseSignature: (detail: unknown, languageId: string, symbolName: string) => unknown,
 *   version?: string,
 *   requires?: { cmd?: string, args?: string[] },
 *   capabilities?: object,
 *   kinds?: string[],
 *   duplicateLabel?: string,
 *   command: {
 *     defaultCmd: string,
 *     resolveArgs?: (config: object) => string[],
 *     commandUnavailableCheck?: { name?: string, message?: string | ((cmd: string) => string) }
 *   },
 *   workspace?: {
 *     markerOptions: object,
 *     missingCheck?: { name?: string, message?: string }
 *   } | null,
 *   runtimeDefaults?: { timeoutMs?: number, retries?: number, breakerThreshold?: number },
 *   prepareCollect?: (input: {
 *     ctx: object,
 *     config: object,
 *     requested: { cmd: string, args: string[] },
 *     commandProfile: ReturnType<typeof resolveToolingCommandProfile>
 *   }) => Promise<{
 *     args?: string[],
 *     checks?: Array<{name: string, status: string, message: string}>,
 *     collectOptions?: Record<string, unknown>
 *   } | null> | {
 *     args?: string[],
 *     checks?: Array<{name: string, status: string, message: string}>,
 *     collectOptions?: Record<string, unknown>
 *   } | null
 * }} descriptor
 * @returns {import('./provider-registry.js').ToolingProvider}
 */
export const createDedicatedLspProvider = (descriptor) => ({
  id: descriptor.id,
  version: descriptor.version || '1.0.0',
  label: descriptor.label,
  priority: descriptor.priority,
  languages: descriptor.languages,
  kinds: Array.isArray(descriptor.kinds) && descriptor.kinds.length
    ? descriptor.kinds
    : ['types', 'diagnostics'],
  requires: descriptor.requires || { cmd: descriptor.command.defaultCmd },
  capabilities: descriptor.capabilities || {
    supportsVirtualDocuments: true,
    supportsSegmentRouting: true,
    supportsJavaScript: false,
    supportsTypeScript: false,
    supportsSymbolRef: false
  },
  getConfigHash(ctx) {
    return resolveProviderConfigHash(ctx, descriptor.configKey);
  },
  async run(ctx, inputs) {
    const configHash = resolveProviderConfigHash(ctx, descriptor.configKey);
    const providerRef = buildProviderRef(this, configHash);
    const config = resolveProviderConfig(ctx, descriptor.configKey);
    const docs = filterProviderDocuments(inputs?.documents, toExtensionSet(descriptor.docExtensions));
    const targets = filterTargetsForDocuments(inputs?.targets, docs);
    const duplicateChecks = buildDuplicateChunkUidChecks(targets, {
      label: descriptor.duplicateLabel || descriptor.id
    });
    if (!docs.length || !targets.length || config.enabled !== true) {
      return buildBaseResult(providerRef, duplicateChecks);
    }

    const checks = [...duplicateChecks];
    if (descriptor.workspace && config.requireWorkspaceModel !== false) {
      const markerFound = hasWorkspaceMarker(ctx?.repoRoot || process.cwd(), descriptor.workspace.markerOptions || {});
      if (!markerFound) {
        checks.push(maybeBuildWorkspaceMissingCheck(descriptor));
        return buildBaseResult(providerRef, checks);
      }
    }

    const requested = resolveRequestedCommand(descriptor, config);
    const commandProfile = resolveToolingCommandProfile({
      providerId: descriptor.id,
      cmd: requested.cmd,
      args: requested.args,
      repoRoot: ctx?.repoRoot || process.cwd(),
      toolingConfig: ctx?.toolingConfig || {}
    });
    if (!commandProfile.probe.ok) {
      checks.push(buildCommandUnavailableCheck(descriptor, requested.cmd));
    }

    let resolvedArgs = commandProfile.resolved.args || requested.args;
    let collectOptions = {};
    if (typeof descriptor.prepareCollect === 'function') {
      const prepared = await descriptor.prepareCollect({
        ctx,
        config,
        requested,
        commandProfile
      });
      if (Array.isArray(prepared?.args)) resolvedArgs = prepared.args;
      if (Array.isArray(prepared?.checks) && prepared.checks.length) checks.push(...prepared.checks);
      if (prepared?.collectOptions && typeof prepared.collectOptions === 'object') {
        collectOptions = { ...prepared.collectOptions };
      }
    }

    const runtimeConfig = resolveLspRuntimeConfig({
      providerConfig: config,
      globalConfigs: [ctx?.toolingConfig || null],
      defaults: {
        ...DEFAULT_RUNTIME_OPTIONS,
        ...(descriptor.runtimeDefaults || {})
      }
    });
    const initializationOptions = isPlainObject(config.initializationOptions)
      ? config.initializationOptions
      : null;

    const result = await collectLspTypes({
      ...runtimeConfig,
      rootDir: ctx.repoRoot,
      documents: docs,
      targets,
      abortSignal: ctx?.abortSignal || null,
      log: getLogger(ctx),
      providerId: descriptor.id,
      cmd: commandProfile.resolved.cmd,
      args: resolvedArgs,
      parseSignature: descriptor.parseSignature,
      strict: ctx?.strict !== false,
      vfsRoot: ctx?.buildRoot || ctx.repoRoot,
      vfsTokenMode: ctx?.toolingConfig?.vfs?.tokenMode,
      vfsIoBatching: ctx?.toolingConfig?.vfs?.ioBatching,
      vfsColdStartCache: ctx?.toolingConfig?.vfs?.coldStartCache,
      indexDir: ctx?.buildRoot || null,
      cacheRoot: ctx?.cache?.dir || null,
      initializationOptions,
      captureDiagnostics: true,
      ...collectOptions
    });
    if (Array.isArray(result?.checks) && result.checks.some((check) => check?.name === 'tooling_initialize_failed')) {
      invalidateToolingCommandProbeCache({
        providerId: descriptor.id,
        command: commandProfile.resolved.cmd,
        successOnly: true
      });
    }

    return {
      provider: providerRef,
      byChunkUid: result.byChunkUid,
      diagnostics: appendRuntimeDiagnostics(result, [
        ...checks,
        ...(Array.isArray(result.checks) ? result.checks : [])
      ])
    };
  }
});
