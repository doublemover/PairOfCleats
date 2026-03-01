import fsSync from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import { getXxhashBackend } from '../../shared/hash.js';
import { listToolingProviders } from './provider-registry.js';
import { normalizeProviderId } from './provider-contract.js';
import { resolveProviderCommandOverride } from './provider-command-override.js';
import { loadTypeScript } from './typescript/load.js';
import { getScmProviderAndRoot, resolveScmConfig } from '../scm/registry.js';
import { setScmRuntimeConfig } from '../scm/runtime.js';
import { isAbsolutePathNative } from '../../shared/files.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { hasWorkspaceMarker, resolveWorkspaceModelCheckForCommand } from './workspace-model.js';
import { listLspServerPresets } from './lsp-presets.js';
import { resolveCompileCommandsDir } from './compile-commands.js';
import {
  normalizeCommandToken,
  isProbeCommandDefinitelyMissing,
  probeLspInitializeHandshake,
  resolveToolingCommandProfile
} from './command-resolver.js';

const MIN_TYPESCRIPT_VERSION = '4.8.0';
const TOOLING_DOCTOR_REPORT_SCHEMA_VERSION = 2;
const TOOLING_DOCTOR_REPORT_FILENAME = 'tooling_doctor_report.json';

const DEDICATED_LSP_PROVIDER_IDS = new Set([
  'clangd',
  'csharp-ls',
  'dart',
  'elixir-ls',
  'haskell-language-server',
  'jdtls',
  'phpactor',
  'pyright',
  'solargraph',
  'sourcekit'
]);

const DEDICATED_LSP_COMMANDS = new Set([
  'clangd',
  'csharp-ls',
  'dart',
  'elixir-ls',
  'haskell-language-server',
  'jdtls',
  'phpactor',
  'pyright-langserver',
  'solargraph',
  'sourcekit-lsp'
]);

const PRESET_LSP_IDS = new Set(
  listLspServerPresets()
    .map((preset) => normalizeProviderId(preset?.id))
    .filter(Boolean)
);

const PRESET_LSP_COMMANDS = new Set(
  listLspServerPresets()
    .map((preset) => String(preset?.cmd || '').trim().toLowerCase())
    .filter(Boolean)
);

const shouldProbeLspHandshake = ({
  providerId,
  requestedCmd,
  resolvedCmd
}) => {
  const id = normalizeProviderId(providerId);
  if (!id) return false;
  if (id.startsWith('lsp-')) return true;
  if (DEDICATED_LSP_PROVIDER_IDS.has(id)) return true;
  if (PRESET_LSP_IDS.has(id)) return true;
  const requestedToken = normalizeCommandToken(requestedCmd);
  const resolvedToken = normalizeCommandToken(resolvedCmd);
  if (DEDICATED_LSP_COMMANDS.has(requestedToken) || DEDICATED_LSP_COMMANDS.has(resolvedToken)) {
    return true;
  }
  if (PRESET_LSP_COMMANDS.has(requestedToken) || PRESET_LSP_COMMANDS.has(resolvedToken)) {
    return true;
  }
  return false;
};

const summarizeStatus = (errors, warnings) => {
  if (errors > 0) return 'error';
  if (warnings > 0) return 'warn';
  return 'ok';
};

const resolveRuntimeRequirementsForCommand = (commandName) => {
  const command = String(commandName || '').trim().toLowerCase();
  if (!command) return [];
  if (command === 'jdtls') {
    return [{
      id: 'java',
      cmd: 'java',
      args: ['--version'],
      label: 'Java runtime'
    }];
  }
  if (command === 'csharp-ls' || command === 'omnisharp') {
    return [{
      id: 'dotnet',
      cmd: 'dotnet',
      args: ['--version'],
      label: '.NET runtime'
    }];
  }
  if (command === 'elixir-ls' || command === 'elixir-ls-language-server') {
    return [{
      id: 'elixir',
      cmd: 'elixir',
      args: ['--version'],
      label: 'Elixir runtime'
    }, {
      id: 'erl',
      cmd: 'erl',
      args: ['-version'],
      label: 'Erlang runtime'
    }];
  }
  if (command === 'haskell-language-server') {
    return [{
      id: 'ghc',
      cmd: 'ghc',
      args: ['--version'],
      label: 'GHC compiler'
    }];
  }
  if (command === 'phpactor') {
    return [{
      id: 'php',
      cmd: 'php',
      args: ['--version'],
      label: 'PHP runtime'
    }];
  }
  if (command === 'solargraph') {
    return [{
      id: 'ruby',
      cmd: 'ruby',
      args: ['--version'],
      label: 'Ruby runtime'
    }, {
      id: 'gem',
      cmd: 'gem',
      args: ['--version'],
      label: 'RubyGems'
    }];
  }
  if (command === 'dart') {
    return [{
      id: 'dart-sdk',
      cmd: 'dart',
      args: ['--version'],
      label: 'Dart SDK'
    }];
  }
  return [];
};

const writeReport = async (reportPath, report) => {
  await atomicWriteJson(reportPath, report, {
    spaces: 2,
    newline: false
  });
};

export const runToolingDoctor = async (ctx, providerIds = null, options = {}) => {
  const repoRoot = ctx?.repoRoot || process.cwd();
  const buildRoot = ctx?.buildRoot || repoRoot;
  const toolingConfig = ctx?.toolingConfig || {};
  const strict = ctx?.strict !== false;
  const log = typeof options?.log === 'function' ? options.log : (() => {});
  const resolveCommandProfile = typeof options?.resolveCommandProfile === 'function'
    ? options.resolveCommandProfile
    : resolveToolingCommandProfile;
  const scmConfig = ctx?.scmConfig || resolveScmConfig({
    indexingConfig: ctx?.indexingConfig || {},
    analysisPolicy: ctx?.analysisPolicy || null
  });
  setScmRuntimeConfig(scmConfig);

  const report = {
    schemaVersion: TOOLING_DOCTOR_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repoRoot,
    buildRoot,
    reportFile: TOOLING_DOCTOR_REPORT_FILENAME,
    config: {
      enabledTools: [],
      disabledTools: []
    },
    xxhash: {
      backend: 'none',
      module: 'none',
      ok: false
    },
    identity: {
      chunkUid: {
        required: true,
        available: false,
        backend: 'none',
        notes: []
      }
    },
    scm: null,
    providers: [],
    summary: {
      status: 'ok',
      warnings: 0,
      errors: 0
    }
  };

  const backend = await getXxhashBackend();
  report.identity.chunkUid.available = Boolean(backend);
  report.identity.chunkUid.backend = backend || 'none';
  report.xxhash.backend = backend || 'none';
  report.xxhash.module = backend === 'native'
    ? 'xxhash-native'
    : (backend === 'wasm' ? 'xxhash-wasm' : 'none');
  report.xxhash.ok = Boolean(backend);
  if (!backend) {
    report.identity.chunkUid.notes.push('xxhash backend not available; chunkUid cannot be computed.');
    report.summary.errors += 1;
  } else if (backend === 'wasm') {
    report.identity.chunkUid.notes.push('native backend unavailable; using wasm backend.');
  }

  const enabledTools = Array.isArray(toolingConfig.enabledTools) ? toolingConfig.enabledTools : [];
  const disabledTools = Array.isArray(toolingConfig.disabledTools) ? toolingConfig.disabledTools : [];
  report.config.enabledTools = enabledTools.slice();
  report.config.disabledTools = disabledTools.slice();
  const isProviderExplicitlyEnabled = (id) => (
    enabledTools.length > 0 && enabledTools.includes(normalizeProviderId(id))
  );
  let scmSelection = null;
  let scmProvenance = null;
  let scmError = null;
  try {
    scmSelection = getScmProviderAndRoot({
      provider: scmConfig?.provider || 'auto',
      startPath: repoRoot,
      log
    });
    scmProvenance = await scmSelection.providerImpl.getRepoProvenance({
      repoRoot: scmSelection.repoRoot
    });
  } catch (err) {
    scmError = err?.message || String(err);
  }
  if (!scmSelection) {
    scmSelection = { provider: 'none', repoRoot, detectedBy: 'none' };
  }
  const resolvedProvenance = scmProvenance && typeof scmProvenance === 'object'
    ? {
      ...scmProvenance,
      provider: scmProvenance.provider || scmSelection.provider,
      root: scmProvenance.root || scmSelection.repoRoot,
      detectedBy: scmProvenance.detectedBy ?? scmSelection.detectedBy
    }
    : {
      provider: scmSelection.provider,
      root: scmSelection.repoRoot,
      head: null,
      dirty: null,
      detectedBy: scmSelection.detectedBy
    };
  const annotateEnabled = scmConfig?.annotate?.enabled !== false
    && resolvedProvenance.provider !== 'none';
  report.scm = {
    provider: resolvedProvenance.provider,
    repoRoot: resolvedProvenance.root,
    detectedBy: resolvedProvenance.detectedBy || null,
    head: resolvedProvenance.head || null,
    dirty: resolvedProvenance.dirty ?? null,
    annotateEnabled,
    error: scmError
  };
  const getDisableReasons = (id) => {
    const normalized = normalizeProviderId(id);
    if (!normalized) return ['unknown-provider'];
    const reasons = [];
    if (disabledTools.includes(normalized)) reasons.push('disabled-by-config');
    if (enabledTools.length && !enabledTools.includes(normalized)) reasons.push('not-in-enabled-tools');
    return reasons;
  };

  const allProviders = listToolingProviders(toolingConfig);
  const providers = Array.isArray(providerIds) && providerIds.length
    ? providerIds
      .map((id) => allProviders.find((provider) => normalizeProviderId(provider?.id) === normalizeProviderId(id)))
      .filter(Boolean)
    : allProviders;

  for (const provider of providers) {
    const providerId = normalizeProviderId(provider?.id);
    if (!providerId) continue;
    const reasonsDisabled = getDisableReasons(providerId);
    const enabled = reasonsDisabled.length === 0;
    const providerReport = {
      id: providerId,
      version: provider?.version || null,
      enabled,
      available: true,
      reasonsDisabled,
      requires: provider?.requires || null,
      languages: Array.isArray(provider?.languages) ? provider.languages.slice() : [],
      capabilities: provider?.capabilities || {},
      status: 'ok',
      checks: []
    };
    let providerErrors = 0;
    let providerWarnings = 0;
    let providerAvailable = true;
    const addCheck = (check) => {
      providerReport.checks.push(check);
      if (check.status === 'error') {
        providerAvailable = false;
        providerErrors += 1;
        report.summary.errors += 1;
      } else if (check.status === 'warn') {
        providerWarnings += 1;
        report.summary.warnings += 1;
      }
    };
    const missingBinaryStatus = isProviderExplicitlyEnabled(providerId) ? 'error' : 'warn';

    if (!providerReport.enabled) {
      addCheck({
        name: 'enabled',
        status: 'warn',
        message: 'Provider disabled by tooling configuration.'
      });
    } else if (providerId === 'typescript') {
      const ts = await loadTypeScript(toolingConfig, repoRoot);
      if (!ts) {
        addCheck({
          name: 'typescript',
          status: 'error',
          message: 'TypeScript module not found.'
        });
      } else {
        const version = ts.version || 'unknown';
        if (semver.valid(version) && !semver.gte(version, MIN_TYPESCRIPT_VERSION)) {
          addCheck({
            name: 'typescript-version',
            status: 'warn',
            message: `TypeScript ${version} below minimum ${MIN_TYPESCRIPT_VERSION}.`
          });
        } else {
          addCheck({
            name: 'typescript-version',
            status: 'ok',
            message: `TypeScript ${version} detected.`
          });
        }
      }

      if (toolingConfig.typescript?.useTsconfig !== false && toolingConfig.typescript?.tsconfigPath) {
        const tsconfigPath = isAbsolutePathNative(toolingConfig.typescript.tsconfigPath)
          ? toolingConfig.typescript.tsconfigPath
          : path.join(repoRoot, toolingConfig.typescript.tsconfigPath);
        if (!fsSync.existsSync(tsconfigPath)) {
          addCheck({
            name: 'tsconfig',
            status: 'warn',
            message: `tsconfig not found at ${tsconfigPath}.`
          });
        } else {
          addCheck({
            name: 'tsconfig',
            status: 'ok',
            message: 'tsconfig resolved.'
          });
        }
      }

      const allowJs = toolingConfig.typescript?.allowJs !== false;
      const checkJs = toolingConfig.typescript?.checkJs !== false;
      const includeJsx = toolingConfig.typescript?.includeJsx !== false;
      if (!allowJs || !checkJs || !includeJsx) {
        addCheck({
          name: 'javascript-parity',
          status: 'warn',
          message: 'JavaScript parity disabled via tooling config.'
        });
      }
    } else if (providerId === 'clangd') {
      const clangdConfig = toolingConfig.clangd || {};
      if (clangdConfig.requireCompilationDatabase) {
        const compileCommandsDir = resolveCompileCommandsDir(repoRoot, clangdConfig);
        if (!compileCommandsDir) {
          addCheck({
            name: 'compile-commands',
            status: 'warn',
            message: 'compile_commands.json not found; clangd will be skipped.'
          });
        } else {
          addCheck({
            name: 'compile-commands',
            status: 'ok',
            message: `compile_commands.json found in ${compileCommandsDir}.`
          });
        }
      }
    }

    if (providerReport.enabled && providerId !== 'typescript') {
      let requestedCmd = provider?.requires?.cmd || null;
      let requestedArgs = Array.isArray(provider?.requires?.args)
        ? provider.requires.args.map((entry) => String(entry))
        : [];
      const override = resolveProviderCommandOverride({ providerId, toolingConfig });
      if (override.cmd) {
        requestedCmd = override.cmd;
      }
      if (Array.isArray(override.args)) {
        requestedArgs = override.args;
      }
      if (!requestedCmd && providerId === 'pyright') {
        requestedCmd = 'pyright-langserver';
      }
      if (!requestedCmd && providerId === 'clangd') {
        requestedCmd = 'clangd';
      }
      if (!requestedCmd && providerId === 'sourcekit') {
        requestedCmd = 'sourcekit-lsp';
      }
      if (providerId === 'pyright' && !Array.isArray(override.args) && !requestedArgs.length) {
        requestedArgs = ['--stdio'];
      }
      if (requestedCmd) {
        const commandProfile = resolveCommandProfile({
          providerId,
          cmd: requestedCmd,
          args: requestedArgs,
          repoRoot,
          toolingConfig
        });
        providerReport.command = commandProfile;
        const probeOk = commandProfile.probe?.ok === true;
        const commandDefinitelyMissing = !probeOk
          && isProbeCommandDefinitelyMissing(commandProfile.probe);
        if (!probeOk && commandDefinitelyMissing) {
          providerAvailable = false;
          addCheck({
            name: `${providerId}-command`,
            status: missingBinaryStatus,
            message: `${requestedCmd} binary not available.`
          });
        } else {
          if (!probeOk) {
            addCheck({
              name: `${providerId}-command`,
              status: 'warn',
              message: `${requestedCmd} command probe inconclusive; runtime handshake will still be attempted.`
            });
          }
          const commandToken = normalizeCommandToken(commandProfile.resolved?.cmd || requestedCmd);
          if (probeOk) {
            addCheck({
              name: `${providerId}-command`,
              status: 'ok',
              message: `resolved ${requestedCmd} -> ${commandProfile.resolved.cmd} (${commandProfile.resolved.mode})`
            });
          }
          const probeLsp = shouldProbeLspHandshake({
            providerId,
            requestedCmd,
            resolvedCmd: commandProfile.resolved?.cmd || ''
          });
          if (probeLsp && options?.probeHandshake !== false) {
            const handshake = await probeLspInitializeHandshake({
              providerId,
              cmd: commandProfile.resolved.cmd,
              args: commandProfile.resolved.args || [],
              cwd: repoRoot,
              timeoutMs: Number.isFinite(Number(options?.handshakeTimeoutMs))
                ? Math.max(750, Math.floor(Number(options.handshakeTimeoutMs)))
                : 4000
            });
            providerReport.handshake = handshake;
            if (!handshake.ok) {
              addCheck({
                name: `${providerId}-initialize`,
                status: 'warn',
                message: `initialize handshake failed: ${handshake.errorMessage || 'unknown error'}`
              });
            } else {
              addCheck({
                name: `${providerId}-initialize`,
                status: 'ok',
                message: `initialize handshake succeeded (${handshake.latencyMs}ms).`
              });
            }
          }
          const runtimeRequirements = resolveRuntimeRequirementsForCommand(commandToken);
          if (runtimeRequirements.length) {
            providerReport.runtimeRequirements = [];
            for (const requirement of runtimeRequirements) {
              const requirementProfile = resolveCommandProfile({
                providerId: `${providerId}-${requirement.id}`,
                cmd: requirement.cmd,
                args: requirement.args || ['--version'],
                repoRoot,
                toolingConfig
              });
              providerReport.runtimeRequirements.push({
                id: requirement.id,
                command: requirement.cmd,
                profile: requirementProfile
              });
              const requirementProbeOk = requirementProfile.probe?.ok === true;
              const requirementMissing = !requirementProbeOk
                && isProbeCommandDefinitelyMissing(requirementProfile.probe);
              if (!requirementProbeOk && requirementMissing) {
                addCheck({
                  name: `${providerId}-runtime-${requirement.id}`,
                  status: missingBinaryStatus,
                  message: `${requirement.label} not available for ${requestedCmd}.`
                });
              } else if (!requirementProbeOk) {
                addCheck({
                  name: `${providerId}-runtime-${requirement.id}`,
                  status: 'warn',
                  message: `${requirement.label} probe inconclusive for ${requestedCmd}.`
                });
              } else {
                addCheck({
                  name: `${providerId}-runtime-${requirement.id}`,
                  status: 'ok',
                  message: `${requirement.label} detected (${requirementProfile.resolved.cmd}).`
                });
              }
            }
          }
          const workspaceModelCheck = resolveWorkspaceModelCheckForCommand(commandToken);
          if (workspaceModelCheck) {
            const markerFound = hasWorkspaceMarker(repoRoot, workspaceModelCheck.markers);
            if (!markerFound) {
              addCheck({
                name: `${providerId}-${workspaceModelCheck.id}`,
                status: 'warn',
                message: `${workspaceModelCheck.label} markers not found near repo root; startup may fail or degrade.`
              });
            } else {
              addCheck({
                name: `${providerId}-${workspaceModelCheck.id}`,
                status: 'ok',
                message: `${workspaceModelCheck.label} markers detected.`
              });
            }
          }
        }
        if (normalizeCommandToken(commandProfile.resolved?.cmd || requestedCmd) === 'zls' && commandProfile.probe.ok) {
          const zigProfile = resolveCommandProfile({
            providerId: 'zig',
            cmd: 'zig',
            args: ['version'],
            repoRoot,
            toolingConfig
          });
          if (!zigProfile.probe.ok) {
            addCheck({
              name: 'zls-zig-compatibility',
              status: 'warn',
              message: 'zls detected but zig toolchain command not available.'
            });
          } else {
            addCheck({
              name: 'zls-zig-compatibility',
              status: 'ok',
              message: 'zls and zig commands detected.'
            });
          }
        }
      }
    }

    providerReport.status = summarizeStatus(providerErrors, providerWarnings);
    providerReport.available = providerAvailable;
    report.providers.push(providerReport);
  }

  report.summary.status = summarizeStatus(report.summary.errors, report.summary.warnings);
  report.providers.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const reportPath = path.join(buildRoot, TOOLING_DOCTOR_REPORT_FILENAME);
  await writeReport(reportPath, report);
  report.reportPath = reportPath;
  if (report.summary.status === 'error') {
    log(`[tooling] doctor: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s).`);
  } else if (report.summary.status === 'warn') {
    log(`[tooling] doctor: ${report.summary.warnings} warning(s).`);
  } else {
    log('[tooling] doctor: ok.');
  }

  if (strict && !report.identity.chunkUid.available) {
    throw new Error('Tooling doctor failed: xxhash backend unavailable for chunkUid.');
  }

  return report;
};
