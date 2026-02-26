import path from 'node:path';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { resolveToolingCommandProfile } from './command-resolver.js';
import { parseClikeSignature } from './signature-parse/clike.js';
import { hasWorkspaceMarker } from './workspace-model.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';

const CSHARP_EXTS = ['.cs'];

const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

export const createCsharpProvider = () => ({
  id: 'csharp-ls',
  version: '1.0.0',
  label: 'csharp-ls (dedicated)',
  priority: 83,
  languages: ['csharp'],
  kinds: ['types', 'diagnostics'],
  requires: { cmd: 'csharp-ls' },
  capabilities: {
    supportsVirtualDocuments: true,
    supportsSegmentRouting: true,
    supportsJavaScript: false,
    supportsTypeScript: false,
    supportsSymbolRef: false
  },
  getConfigHash(ctx) {
    return hashProviderConfig({ csharp: ctx?.toolingConfig?.csharp || {} });
  },
  async run(ctx, inputs) {
    const log = typeof ctx?.logger === 'function' ? ctx.logger : (() => {});
    const config = ctx?.toolingConfig?.csharp || {};
    const docs = Array.isArray(inputs?.documents)
      ? inputs.documents.filter((doc) => CSHARP_EXTS.includes(path.extname(doc.virtualPath).toLowerCase()))
      : [];
    const targets = Array.isArray(inputs?.targets)
      ? inputs.targets.filter((target) => docs.some((doc) => doc.virtualPath === target.virtualPath))
      : [];
    const duplicateChecks = buildDuplicateChunkUidChecks(targets, { label: 'csharp-ls' });
    if (!docs.length || !targets.length) {
      return {
        provider: { id: 'csharp-ls', version: '1.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }
    if (config.enabled !== true) {
      return {
        provider: { id: 'csharp-ls', version: '1.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }

    const checks = [...duplicateChecks];
    const requiresWorkspaceModel = config.requireWorkspaceModel !== false;
    if (requiresWorkspaceModel) {
      const markerFound = hasWorkspaceMarker(ctx?.repoRoot || process.cwd(), {
        extensionNames: ['.sln', '.csproj']
      });
      if (!markerFound) {
        checks.push({
          name: 'csharp_workspace_model_missing',
          status: 'warn',
          message: 'csharp-ls workspace model markers not found; skipping dedicated provider.'
        });
        return {
          provider: { id: 'csharp-ls', version: '1.0.0', configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, checks)
        };
      }
    }

    const requestedCmd = typeof config.cmd === 'string' && config.cmd.trim() ? config.cmd.trim() : 'csharp-ls';
    const requestedArgs = Array.isArray(config.args) ? config.args : [];
    const commandProfile = resolveToolingCommandProfile({
      providerId: 'csharp-ls',
      cmd: requestedCmd,
      args: requestedArgs,
      repoRoot: ctx?.repoRoot || process.cwd(),
      toolingConfig: ctx?.toolingConfig || {}
    });
    if (!commandProfile.probe.ok) {
      checks.push({
        name: 'csharp_command_unavailable',
        status: 'warn',
        message: `${requestedCmd} command not available for csharp-ls.`
      });
      return {
        provider: { id: 'csharp-ls', version: '1.0.0', configHash: this.getConfigHash(ctx) },
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
      cmd: commandProfile.resolved.cmd,
      args: commandProfile.resolved.args || requestedArgs,
      parseSignature: (detail, _lang, symbolName) => parseClikeSignature(detail, symbolName),
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
      provider: { id: 'csharp-ls', version: '1.0.0', configHash: this.getConfigHash(ctx) },
      byChunkUid: result.byChunkUid,
      diagnostics: result.runtime
        ? { ...(diagnostics || {}), runtime: result.runtime }
        : diagnostics
    };
  }
});
