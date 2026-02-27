import path from 'node:path';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { resolveToolingCommandProfile } from './command-resolver.js';
import { parseElixirSignature } from './signature-parse/elixir.js';
import { hasWorkspaceMarker } from './workspace-model.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';

const ELIXIR_EXTS = ['.ex', '.exs'];

const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

const normalizeArgs = (value) => (
  Array.isArray(value)
    ? value.map((entry) => String(entry)).filter((entry) => entry.length > 0)
    : []
);

export const createElixirProvider = () => ({
  id: 'elixir-ls',
  version: '1.0.0',
  label: 'elixir-ls (dedicated)',
  priority: 85,
  languages: ['elixir'],
  kinds: ['types', 'diagnostics'],
  requires: { cmd: 'elixir-ls' },
  capabilities: {
    supportsVirtualDocuments: true,
    supportsSegmentRouting: true,
    supportsJavaScript: false,
    supportsTypeScript: false,
    supportsSymbolRef: false
  },
  getConfigHash(ctx) {
    return hashProviderConfig({ elixir: ctx?.toolingConfig?.elixir || {} });
  },
  async run(ctx, inputs) {
    const log = typeof ctx?.logger === 'function' ? ctx.logger : (() => {});
    const config = ctx?.toolingConfig?.elixir || {};
    const docs = Array.isArray(inputs?.documents)
      ? inputs.documents.filter((doc) => ELIXIR_EXTS.includes(path.extname(doc.virtualPath).toLowerCase()))
      : [];
    const targets = Array.isArray(inputs?.targets)
      ? inputs.targets.filter((target) => docs.some((doc) => doc.virtualPath === target.virtualPath))
      : [];
    const duplicateChecks = buildDuplicateChunkUidChecks(targets, { label: 'elixir-ls' });
    if (!docs.length || !targets.length) {
      return {
        provider: { id: 'elixir-ls', version: '1.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }
    if (config.enabled !== true) {
      return {
        provider: { id: 'elixir-ls', version: '1.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }

    const checks = [...duplicateChecks];
    const requiresWorkspaceModel = config.requireWorkspaceModel !== false;
    if (requiresWorkspaceModel) {
      const markerFound = hasWorkspaceMarker(ctx?.repoRoot || process.cwd(), {
        exactNames: ['mix.exs']
      });
      if (!markerFound) {
        checks.push({
          name: 'elixir_workspace_model_missing',
          status: 'warn',
          message: 'elixir workspace markers not found; skipping dedicated provider.'
        });
        return {
          provider: { id: 'elixir-ls', version: '1.0.0', configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, checks)
        };
      }
    }

    const requestedCmd = typeof config.cmd === 'string' && config.cmd.trim() ? config.cmd.trim() : 'elixir-ls';
    const requestedArgs = normalizeArgs(config.args);
    const commandProfile = resolveToolingCommandProfile({
      providerId: 'elixir-ls',
      cmd: requestedCmd,
      args: requestedArgs,
      repoRoot: ctx?.repoRoot || process.cwd(),
      toolingConfig: ctx?.toolingConfig || {}
    });
    if (!commandProfile.probe.ok) {
      checks.push({
        name: 'elixir_command_unavailable',
        status: 'warn',
        message: `${requestedCmd} command not available for elixir-ls.`
      });
      return {
        provider: { id: 'elixir-ls', version: '1.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks)
      };
    }

    const runtimeConfig = resolveLspRuntimeConfig({
      providerConfig: config,
      globalConfigs: [ctx?.toolingConfig || null],
      defaults: {
        timeoutMs: 60000,
        retries: 1,
        breakerThreshold: 4
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
      log,
      providerId: 'elixir-ls',
      cmd: commandProfile.resolved.cmd,
      args: commandProfile.resolved.args || requestedArgs,
      parseSignature: parseElixirSignature,
      strict: ctx?.strict !== false,
      vfsRoot: ctx?.buildRoot || ctx.repoRoot,
      vfsTokenMode: ctx?.toolingConfig?.vfs?.tokenMode,
      vfsIoBatching: ctx?.toolingConfig?.vfs?.ioBatching,
      vfsColdStartCache: ctx?.toolingConfig?.vfs?.coldStartCache,
      indexDir: ctx?.buildRoot || null,
      cacheRoot: ctx?.cache?.dir || null,
      initializationOptions,
      captureDiagnostics: true
    });

    const diagnostics = appendDiagnosticChecks(
      result.diagnosticsCount
        ? { diagnosticsCount: result.diagnosticsCount, diagnosticsByChunkUid: result.diagnosticsByChunkUid }
        : null,
      [...checks, ...(Array.isArray(result.checks) ? result.checks : [])]
    );
    return {
      provider: { id: 'elixir-ls', version: '1.0.0', configHash: this.getConfigHash(ctx) },
      byChunkUid: result.byChunkUid,
      diagnostics: result.runtime
        ? { ...(diagnostics || {}), runtime: result.runtime }
        : diagnostics
    };
  }
});
