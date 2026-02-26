import path from 'node:path';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { resolveToolingCommandProfile } from './command-resolver.js';
import { parseClikeSignature } from './signature-parse/clike.js';
import { hasWorkspaceMarker } from './workspace-model.js';

const PHP_EXTS = ['.php', '.phtml'];

const asFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

const normalizeArgs = (value) => (
  Array.isArray(value)
    ? value.map((entry) => String(entry)).filter((entry) => entry.length > 0)
    : []
);

const ensureLanguageServerArg = (args) => {
  const normalized = normalizeArgs(args);
  const hasModeArg = normalized.some((entry) => entry.toLowerCase() === 'language-server');
  return hasModeArg ? normalized : ['language-server', ...normalized];
};

export const createPhpactorProvider = () => ({
  id: 'phpactor',
  version: '1.0.0',
  label: 'phpactor (dedicated)',
  priority: 86,
  languages: ['php'],
  kinds: ['types', 'diagnostics'],
  requires: { cmd: 'phpactor', args: ['language-server'] },
  capabilities: {
    supportsVirtualDocuments: true,
    supportsSegmentRouting: true,
    supportsJavaScript: false,
    supportsTypeScript: false,
    supportsSymbolRef: false
  },
  getConfigHash(ctx) {
    return hashProviderConfig({ phpactor: ctx?.toolingConfig?.phpactor || {} });
  },
  async run(ctx, inputs) {
    const log = typeof ctx?.logger === 'function' ? ctx.logger : (() => {});
    const config = ctx?.toolingConfig?.phpactor || {};
    const docs = Array.isArray(inputs?.documents)
      ? inputs.documents.filter((doc) => PHP_EXTS.includes(path.extname(doc.virtualPath).toLowerCase()))
      : [];
    const targets = Array.isArray(inputs?.targets)
      ? inputs.targets.filter((target) => docs.some((doc) => doc.virtualPath === target.virtualPath))
      : [];
    const duplicateChecks = buildDuplicateChunkUidChecks(targets, { label: 'phpactor' });
    if (!docs.length || !targets.length) {
      return {
        provider: { id: 'phpactor', version: '1.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }
    if (config.enabled !== true) {
      return {
        provider: { id: 'phpactor', version: '1.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }

    const checks = [...duplicateChecks];
    const requiresWorkspaceModel = config.requireWorkspaceModel !== false;
    if (requiresWorkspaceModel) {
      const markerFound = hasWorkspaceMarker(ctx?.repoRoot || process.cwd(), {
        exactNames: ['composer.json']
      });
      if (!markerFound) {
        checks.push({
          name: 'phpactor_workspace_model_missing',
          status: 'warn',
          message: 'phpactor workspace markers not found; skipping dedicated provider.'
        });
        return {
          provider: { id: 'phpactor', version: '1.0.0', configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, checks)
        };
      }
    }

    const requestedCmd = typeof config.cmd === 'string' && config.cmd.trim() ? config.cmd.trim() : 'phpactor';
    const requestedArgs = ensureLanguageServerArg(config.args);
    const commandProfile = resolveToolingCommandProfile({
      providerId: 'phpactor',
      cmd: requestedCmd,
      args: requestedArgs,
      repoRoot: ctx?.repoRoot || process.cwd(),
      toolingConfig: ctx?.toolingConfig || {}
    });
    if (!commandProfile.probe.ok) {
      checks.push({
        name: 'phpactor_command_unavailable',
        status: 'warn',
        message: `${requestedCmd} command not available for phpactor.`
      });
      return {
        provider: { id: 'phpactor', version: '1.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks)
      };
    }

    const globalTimeoutMs = asFiniteNumber(ctx?.toolingConfig?.timeoutMs);
    const providerTimeoutMs = asFiniteNumber(config.timeoutMs);
    const timeoutMs = Math.max(30000, Math.floor(providerTimeoutMs ?? globalTimeoutMs ?? 60000));
    const retries = Number.isFinite(Number(config.maxRetries))
      ? Math.max(0, Math.floor(Number(config.maxRetries)))
      : (ctx?.toolingConfig?.maxRetries ?? 1);
    const breakerThreshold = Number.isFinite(Number(config.circuitBreakerThreshold))
      ? Math.max(1, Math.floor(Number(config.circuitBreakerThreshold)))
      : (ctx?.toolingConfig?.circuitBreakerThreshold ?? 4);
    const initializationOptions = isPlainObject(config.initializationOptions)
      ? config.initializationOptions
      : null;

    const result = await collectLspTypes({
      rootDir: ctx.repoRoot,
      documents: docs,
      targets,
      abortSignal: ctx?.abortSignal || null,
      log,
      cmd: commandProfile.resolved.cmd,
      args: ensureLanguageServerArg(commandProfile.resolved.args || requestedArgs),
      timeoutMs,
      retries,
      breakerThreshold,
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
      provider: { id: 'phpactor', version: '1.0.0', configHash: this.getConfigHash(ctx) },
      byChunkUid: result.byChunkUid,
      diagnostics: result.runtime
        ? { ...(diagnostics || {}), runtime: result.runtime }
        : diagnostics
    };
  }
});
