import { awaitToolingProviderPreflight } from '../preflight-manager.js';
import {
  mergePreflightChecks,
  resolveCommandProfilePreflightResult,
  resolveRuntimeCommandFromPreflight
} from '../preflight/command-profile-preflight.js';
import { resolveRuntimeRequirementsPreflight } from '../preflight/runtime-requirements-preflight.js';
import {
  appendDiagnosticChecks
} from '../provider-contract.js';
import {
  buildConfiguredProviderConfigHash,
  collectAutoPresetServers,
  normalizeServerConfig,
  normalizeServerId
} from './normalize.js';
import {
  resolveLuaWorkspaceConfigPreflight,
  resolveLuaWorkspaceLibraryPreflight,
  resolveRustProcMacroSuppressionPolicyPreflight,
  resolveYamlSchemaModePreflight,
  resolveZigWorkspaceRootPreflight
} from './preflight-language.js';
import { collectConfiguredOutput } from './runtime.js';
import {
  prepareConfiguredProviderInputs,
  resolveConfiguredWorkspacePreflight
} from './workspace.js';

const buildCommandUnavailableCheck = (providerId, requestedCmd) => ({
  name: 'lsp_command_unavailable',
  status: 'warn',
  message: `${requestedCmd} command probe failed for ${providerId}; attempting stdio initialization anyway.`
});

export const createConfiguredLspProvider = (server) => {
  const providerId = normalizeServerId(server.providerId, `lsp-${server.id}`);
  const runCommandProfilePreflight = (ctx) => {
    return resolveCommandProfilePreflightResult({
      providerId: server.id || providerId,
      requestedCommand: {
        cmd: server.cmd,
        args: server.args || []
      },
      ctx,
      unavailableCheck: {
        ...buildCommandUnavailableCheck(providerId, server.cmd)
      }
    });
  };

  const provider = {
    id: providerId,
    label: server.label || `LSP ${server.id}`,
    version: server.version || '1.0.0',
    priority: Number.isFinite(server.priority) ? server.priority : 80,
    languages: server.languages || [],
    kinds: Array.isArray(server.kinds) && server.kinds.length
      ? server.kinds.slice()
      : ['types', 'diagnostics'],
    capabilities: {
      supportsVirtualDocuments: true,
      supportsSegmentRouting: true,
      supportsJavaScript: true,
      supportsTypeScript: true,
      supportsSymbolRef: false
    },
    requires: {
      cmd: server.cmd
    },
    getConfigHash(ctx) {
      return buildConfiguredProviderConfigHash({ server, ctx });
    },
    async run(ctx, inputs) {
      const log = typeof ctx?.logger === 'function' ? ctx.logger : (() => {});
      const preChecks = [];
      let requestedCommand = {
        cmd: server.cmd,
        args: server.args || []
      };
      if (ctx?.toolingConfig?.lsp?.enabled === false) {
        return {
          provider: { id: providerId, version: this.version, configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, preChecks)
        };
      }
      const preparedInputs = prepareConfiguredProviderInputs({
        providerId,
        inputs
      });
      if (!preparedInputs.documents.length || !preparedInputs.targets.length) {
        return {
          provider: { id: providerId, version: this.version, configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, preChecks)
        };
      }
      let commandProfile = null;
      let preflightState = 'ready';
      let preflightReasonCode = null;
      let blockedWorkspaceKeys = [];
      let blockedWorkspaceRoots = [];
      if (typeof this.preflight === 'function') {
        const preflight = await awaitToolingProviderPreflight(ctx, {
          provider: this,
          inputs: {
            ...inputs,
            documents: preparedInputs.documents,
            targets: preparedInputs.targets,
            log
          },
          waveToken: typeof inputs?.toolingPreflightWaveToken === 'string'
            ? inputs.toolingPreflightWaveToken
            : null
        });
        if (preflight?.check && typeof preflight.check === 'object') {
          preChecks.push(preflight.check);
        }
        if (Array.isArray(preflight?.checks)) {
          for (const check of preflight.checks) {
            if (check && typeof check === 'object') preChecks.push(check);
          }
        }
        if (preflight?.blockProvider === true || preflight?.blockSourcekit === true) {
          return {
            provider: { id: providerId, version: this.version, configHash: this.getConfigHash(ctx) },
            byChunkUid: {},
            diagnostics: appendDiagnosticChecks(null, preChecks)
          };
        }
        if (preflight?.requestedCommand && typeof preflight.requestedCommand === 'object') {
          requestedCommand = preflight.requestedCommand;
        }
        if (preflight?.commandProfile && typeof preflight.commandProfile === 'object') {
          commandProfile = preflight.commandProfile;
        }
        preflightState = String(preflight?.state || 'ready');
        preflightReasonCode = preflight?.reasonCode || null;
        blockedWorkspaceKeys = Array.isArray(preflight?.blockedWorkspaceKeys) ? preflight.blockedWorkspaceKeys : [];
        blockedWorkspaceRoots = Array.isArray(preflight?.blockedWorkspaceRoots) ? preflight.blockedWorkspaceRoots : [];
      }
      const runtimeCommand = resolveRuntimeCommandFromPreflight({
        preflight: {
          requestedCommand,
          commandProfile
        },
        fallbackRequestedCommand: requestedCommand,
        missingProfileCheck: {
          name: 'lsp_preflight_command_profile_missing',
          status: 'warn',
          message: `configured LSP preflight did not provide a resolved command for ${providerId}; skipping provider.`
        }
      });
      if (!runtimeCommand.cmd) {
        preChecks.push({
          ...runtimeCommand.checks[0]
        });
        return {
          provider: { id: providerId, version: this.version, configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, preChecks)
        };
      }
      if (runtimeCommand.probeKnown && runtimeCommand.probeOk !== true) {
        if (!preChecks.some((entry) => entry?.name === 'lsp_command_unavailable')) {
          preChecks.push(buildCommandUnavailableCheck(providerId, server.cmd));
        }
        log('[index] configured LSP command probe failed; attempting stdio initialization.');
      }
      return await collectConfiguredOutput({
        server,
        providerId,
        ctx,
        provider: this,
        docs: preparedInputs.documents,
        targets: preparedInputs.targets,
        requestedKinds: inputs?.kinds,
        log,
        preChecks,
        commandProfile: runtimeCommand.commandProfile,
        requestedCommand: runtimeCommand.requestedCommand,
        preflightState,
        preflightReasonCode,
        blockedWorkspaceKeys,
        blockedWorkspaceRoots
      });
    },
    preparePreflightInputs(_ctx, inputs) {
      return prepareConfiguredProviderInputs({ providerId, inputs });
    }
  };
  provider.preflightId = server.workspaceMarkerOptions && server.requireWorkspaceModel !== false
    ? `${providerId}.workspace-model`
    : `${providerId}.command-profile`;
  provider.preflightPolicy = server.preflightPolicy;
  provider.preflightRuntimeRequirements = server.preflightRuntimeRequirements;
  provider.preflightTimeoutMs = Number.isFinite(server.preflightTimeoutMs)
    ? Math.max(500, Math.floor(server.preflightTimeoutMs))
    : null;
  provider.preflightClass = server.preflightClass
    || (server.workspaceMarkerOptions && server.requireWorkspaceModel !== false ? 'workspace' : 'probe');
  provider.preflight = async (ctx, inputs = {}) => {
    const commandPreflight = runCommandProfilePreflight(ctx);
    const luaLibraryPreflight = resolveLuaWorkspaceLibraryPreflight({
      server,
      repoRoot: ctx?.repoRoot || process.cwd()
    });
    const yamlSchemaModePreflight = resolveYamlSchemaModePreflight({ server });
    const runtimeRequirementPreflight = resolveRuntimeRequirementsPreflight({
      ctx,
      providerId,
      requirements: server.preflightRuntimeRequirements
    });
    const zigWorkspaceRootPreflight = resolveZigWorkspaceRootPreflight({
      server,
      repoRoot: ctx?.repoRoot || process.cwd()
    });
    const rustSuppressionPolicyPreflight = resolveRustProcMacroSuppressionPolicyPreflight({
      server
    });
    if (commandPreflight.state !== 'ready') {
      const checks = mergePreflightChecks(
        commandPreflight?.checks,
        luaLibraryPreflight?.check,
        luaLibraryPreflight?.checks,
        yamlSchemaModePreflight?.check,
        yamlSchemaModePreflight?.checks,
        runtimeRequirementPreflight?.check,
        runtimeRequirementPreflight?.checks,
        rustSuppressionPolicyPreflight?.check,
        rustSuppressionPolicyPreflight?.checks,
        zigWorkspaceRootPreflight?.check,
        zigWorkspaceRootPreflight?.checks
      );
      return {
        ...commandPreflight,
        ...(checks.length ? { checks } : {})
      };
    }
    const luaWorkspaceConfigPreflight = await resolveLuaWorkspaceConfigPreflight({
      server,
      repoRoot: ctx?.repoRoot || process.cwd()
    });
    return resolveConfiguredWorkspacePreflight({
      ctx,
      server,
      providerId,
      inputs,
      commandPreflight,
      languagePreflights: {
        luaLibraryPreflight,
        luaWorkspaceConfigPreflight,
        yamlSchemaModePreflight,
        runtimeRequirementPreflight,
        rustSuppressionPolicyPreflight,
        zigWorkspaceRootPreflight
      }
    });
  };
  return provider;
};

export const createConfiguredLspProviders = (toolingConfig) => {
  const lsp = toolingConfig?.lsp || null;
  if (!lsp || lsp.enabled === false) return [];
  const servers = Array.isArray(lsp.servers) ? lsp.servers : [];
  const providers = [];
  const normalizedServers = [];
  const configuredServerIds = new Set();
  for (let i = 0; i < servers.length; i += 1) {
    const normalized = normalizeServerConfig(servers[i], i);
    if (!normalized) continue;
    configuredServerIds.add(normalized.id);
    normalizedServers.push(normalized);
  }
  const autoServers = collectAutoPresetServers(toolingConfig, configuredServerIds);
  for (let i = 0; i < autoServers.length; i += 1) {
    const normalized = normalizeServerConfig(autoServers[i], servers.length + i);
    if (!normalized) continue;
    normalizedServers.push(normalized);
  }
  for (const server of normalizedServers) {
    providers.push(createConfiguredLspProvider(server));
  }
  return providers;
};
