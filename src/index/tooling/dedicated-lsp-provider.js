import path from 'node:path';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import {
  appendDiagnosticChecks,
  buildDuplicateChunkUidChecks,
  hashProviderConfig,
  normalizePreflightPolicy,
  normalizePreflightRuntimeRequirements,
  PREFLIGHT_POLICY
} from './provider-contract.js';
import { invalidateProbeCacheOnInitializeFailure } from './command-resolver.js';
import { resolveProviderRequestedCommand } from './provider-command-override.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';
import { isPlainObject, normalizeCommandArgs, filterTargetsForDocuments } from './provider-utils.js';
import { awaitToolingProviderPreflight } from './preflight-manager.js';
import {
  resolveCommandProfilePreflightResult,
  mergePreflightChecks,
  resolveRuntimeCommandFromPreflight
} from './preflight/command-profile-preflight.js';
import { resolveRuntimeRequirementsPreflight } from './preflight/runtime-requirements-preflight.js';
import { resolveWorkspaceModelPreflight } from './preflight/workspace-model-preflight.js';

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

const resolveRequestedCommand = (descriptor, config, toolingConfig) => {
  const defaultArgs = descriptor.command.resolveArgs
    ? descriptor.command.resolveArgs(config)
    : normalizeCommandArgs(config?.args);
  return resolveProviderRequestedCommand({
    providerId: descriptor.id,
    toolingConfig: toolingConfig || { [descriptor.configKey]: config },
    defaultCmd: descriptor.command.defaultCmd || descriptor.id,
    defaultArgs
  });
};

const resolveCommandProfilePreflight = ({ descriptor, ctx, config }) => {
  const requested = resolveRequestedCommand(descriptor, config, ctx?.toolingConfig);
  return resolveCommandProfilePreflightResult({
    providerId: descriptor.id,
    requestedCommand: requested,
    ctx,
    unavailableCheck: ({ requestedCommand: resolvedRequested }) => (
      buildCommandUnavailableCheck(descriptor, resolvedRequested.cmd)
    )
  });
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

const resolveWorkspaceMissingCheck = (descriptor) => {
  const check = descriptor.workspace?.missingCheck || {};
  const name = typeof check.name === 'string' && check.name.trim()
    ? check.name.trim()
    : `${descriptor.id}_workspace_model_missing`;
  const message = typeof check.message === 'string' && check.message.trim()
    ? check.message
    : `${descriptor.label} workspace markers not found; skipping dedicated provider.`;
  return { name, status: 'warn', message };
};

const resolveWaveToken = (inputs) => (
  typeof inputs?.toolingPreflightWaveToken === 'string'
    ? inputs.toolingPreflightWaveToken
    : null
);

const appendPreflightChecks = (checks, preflight) => {
  if (!Array.isArray(checks)) return;
  if (preflight?.check && typeof preflight.check === 'object') {
    checks.push(preflight.check);
  }
  if (Array.isArray(preflight?.checks)) {
    for (const check of preflight.checks) {
      if (check && typeof check === 'object') checks.push(check);
    }
  }
};

const shouldBlockProviderFromPreflight = (preflight) => {
  if (!preflight || typeof preflight !== 'object') return false;
  if (preflight.blockProvider === true || preflight.blockSourcekit === true) return true;
  return String(preflight.state || '').trim().toLowerCase() === 'blocked';
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
 *   preflightClass?: 'probe'|'workspace'|'dependency',
 *   preflightPolicy?: 'required'|'optional',
 *   preflightRuntimeRequirements?: Array<{id: string, cmd: string, args?: string[], label?: string}>,
 *   prepareCollect?: (input: {
 *     ctx: object,
 *     config: object,
 *     requested: { cmd: string, args: string[] },
 *     commandProfile: object
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
export const createDedicatedLspProvider = (descriptor) => {
  const runtimeRequirementDescriptors = normalizePreflightRuntimeRequirements(
    descriptor.preflightRuntimeRequirements
  );
  const provider = {
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
      let preflight = null;
      if (typeof this.preflight === 'function') {
        preflight = await awaitToolingProviderPreflight(ctx, {
          provider: this,
          inputs: {
            ...inputs,
            documents: docs,
            targets,
            config
          },
          waveToken: resolveWaveToken(inputs)
        });
        appendPreflightChecks(checks, preflight);
        if (shouldBlockProviderFromPreflight(preflight)) {
          return buildBaseResult(providerRef, checks);
        }
      }

      const requested = preflight?.requestedCommand && typeof preflight.requestedCommand === 'object'
        ? preflight.requestedCommand
        : resolveRequestedCommand(descriptor, config, ctx?.toolingConfig);
      const runtimeCommand = resolveRuntimeCommandFromPreflight({
        preflight,
        fallbackRequestedCommand: requested,
        missingProfileCheck: {
          name: `${descriptor.id}_preflight_command_profile_missing`,
          status: 'warn',
          message: `${descriptor.label} preflight did not provide a resolved command profile; skipping provider.`
        }
      });
      const commandProfile = runtimeCommand.commandProfile;
      const resolvedCmd = runtimeCommand.cmd;
      if (!resolvedCmd) {
        checks.push(...runtimeCommand.checks);
        return buildBaseResult(providerRef, checks);
      }
      if (runtimeCommand.probeKnown && runtimeCommand.probeOk !== true) {
        if (!checks.some((entry) => entry?.name === buildCommandUnavailableCheck(descriptor, requested.cmd).name)) {
          checks.push(buildCommandUnavailableCheck(descriptor, requested.cmd));
        }
      }

      let resolvedArgs = runtimeCommand.args;
      let collectOptions = {};
      if (typeof descriptor.prepareCollect === 'function') {
        const prepared = await descriptor.prepareCollect({
          ctx,
          config,
          preflight,
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
        cmd: resolvedCmd,
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
      invalidateProbeCacheOnInitializeFailure({
        checks: result?.checks,
        providerId: descriptor.id,
        command: resolvedCmd
      });

      return {
        provider: providerRef,
        byChunkUid: result.byChunkUid,
        diagnostics: appendRuntimeDiagnostics(result, [
          ...checks,
          ...(Array.isArray(result.checks) ? result.checks : [])
        ])
      };
    }
  };

  const hasWorkspacePreflight = Boolean(descriptor?.workspace && descriptor.workspace.markerOptions);
  const hasCustomPreflight = typeof descriptor.preflight === 'function';
  const hasRuntimeRequirementPreflight = runtimeRequirementDescriptors.length > 0;

  if (hasWorkspacePreflight || hasCustomPreflight || hasRuntimeRequirementPreflight) {
    provider.preflightPolicy = normalizePreflightPolicy(
      descriptor.preflightPolicy,
      hasWorkspacePreflight ? PREFLIGHT_POLICY.REQUIRED : PREFLIGHT_POLICY.OPTIONAL
    );
    provider.preflightRuntimeRequirements = runtimeRequirementDescriptors;
    provider.preflightClass = descriptor.preflightClass
      || (hasWorkspacePreflight ? 'workspace' : 'dependency');
    const preflightId = typeof descriptor?.preflightId === 'string' && descriptor.preflightId.trim()
      ? descriptor.preflightId.trim()
      : (hasWorkspacePreflight && !hasCustomPreflight
        ? `${descriptor.id}.workspace-model`
        : `${descriptor.id}.preflight`);
    provider.preflightId = preflightId;
    provider.getPreflightKey = (ctx, inputs) => {
      if (typeof descriptor.getPreflightKey !== 'function') return '';
      const config = resolveProviderConfig(ctx, descriptor.configKey);
      const value = descriptor.getPreflightKey({
        ctx,
        config,
        inputs
      });
      return String(value || '');
    };
    provider.preflight = async (ctx, inputs = {}) => {
      const config = resolveProviderConfig(ctx, descriptor.configKey);
      if (config.enabled !== true) {
        return {
          state: 'skipped',
          blockProvider: false,
          check: null
        };
      }
      if (hasWorkspacePreflight && config.requireWorkspaceModel !== false) {
        const missingCheck = resolveWorkspaceMissingCheck(descriptor);
        const workspacePreflight = resolveWorkspaceModelPreflight({
          repoRoot: ctx?.repoRoot || process.cwd(),
          markerOptions: descriptor.workspace.markerOptions || {},
          missingCheck,
          fallbackName: missingCheck.name,
          fallbackMessage: missingCheck.message,
          policy: 'block'
        });
        if (workspacePreflight.state !== 'ready') {
          return workspacePreflight;
        }
      }
      const commandPreflight = resolveCommandProfilePreflight({
        descriptor,
        ctx,
        config
      });
      const customPreflight = hasCustomPreflight
        ? await descriptor.preflight({
          ctx,
          config,
          inputs,
          log: getLogger(ctx),
          abortSignal: inputs?.abortSignal || ctx?.abortSignal || null,
          requestedCommand: commandPreflight.requestedCommand,
          commandProfile: commandPreflight.commandProfile
        })
        : { state: 'ready', blockProvider: false, check: null };
      if (shouldBlockProviderFromPreflight(customPreflight)) {
        return {
          ...customPreflight,
          requestedCommand: commandPreflight.requestedCommand,
          commandProfile: commandPreflight.commandProfile,
          checks: mergePreflightChecks(customPreflight.check, customPreflight.checks)
        };
      }
      if (commandPreflight.state !== 'ready') {
        return {
          ...commandPreflight,
          blockProvider: false,
          checks: mergePreflightChecks(commandPreflight.checks, customPreflight.check, customPreflight.checks)
        };
      }
      const runtimeRequirementPreflight = resolveRuntimeRequirementsPreflight({
        ctx,
        providerId: descriptor.id,
        requirements: provider.preflightRuntimeRequirements
      });
      if (runtimeRequirementPreflight.state !== 'ready' && !hasCustomPreflight) {
        const checks = mergePreflightChecks(
          commandPreflight.checks,
          runtimeRequirementPreflight.check,
          runtimeRequirementPreflight.checks
        );
        return {
          state: runtimeRequirementPreflight.state || 'degraded',
          reasonCode: runtimeRequirementPreflight.reasonCode || null,
          message: runtimeRequirementPreflight.message || '',
          blockProvider: false,
          requestedCommand: commandPreflight.requestedCommand,
          commandProfile: commandPreflight.commandProfile,
          ...(checks.length ? { checks } : {})
        };
      }
      if (hasCustomPreflight) {
        const customReady = String(customPreflight?.state || '').trim().toLowerCase() === 'ready';
        const effectiveState = runtimeRequirementPreflight.state !== 'ready'
          && customReady
          ? runtimeRequirementPreflight.state
          : (customPreflight.state || 'ready');
        const effectiveReasonCode = runtimeRequirementPreflight.state !== 'ready'
          && customReady
          ? runtimeRequirementPreflight.reasonCode
          : customPreflight.reasonCode;
        const effectiveMessage = runtimeRequirementPreflight.state !== 'ready'
          && customReady
          ? runtimeRequirementPreflight.message
          : customPreflight.message;
        const checks = mergePreflightChecks(
          commandPreflight.checks,
          runtimeRequirementPreflight.check,
          runtimeRequirementPreflight.checks,
          customPreflight.check,
          customPreflight.checks
        );
        return {
          ...customPreflight,
          state: effectiveState,
          reasonCode: effectiveReasonCode,
          message: effectiveMessage,
          requestedCommand: commandPreflight.requestedCommand,
          commandProfile: commandPreflight.commandProfile,
          ...(checks.length ? { checks } : {})
        };
      }
      const checks = mergePreflightChecks(
        commandPreflight.checks,
        runtimeRequirementPreflight.check,
        runtimeRequirementPreflight.checks
      );
      return {
        state: runtimeRequirementPreflight.state || 'ready',
        reasonCode: runtimeRequirementPreflight.reasonCode || null,
        message: runtimeRequirementPreflight.message || '',
        blockProvider: false,
        check: null,
        requestedCommand: commandPreflight.requestedCommand,
        commandProfile: commandPreflight.commandProfile,
        ...(checks.length ? { checks } : {})
      };
    };
  }

  return provider;
};
