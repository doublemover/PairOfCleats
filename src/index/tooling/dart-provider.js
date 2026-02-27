import path from 'node:path';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { resolveToolingCommandProfile } from './command-resolver.js';
import { parseClikeSignature } from './signature-parse/clike.js';
import { hasWorkspaceMarker } from './workspace-model.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';
import { ensureCommandArgToken, isPlainObject, normalizeCommandArgs, filterTargetsForDocuments } from './provider-utils.js';

const DART_EXTS = ['.dart'];

const ensureLanguageServerArgs = (args) => {
  const withLanguageServer = ensureCommandArgToken(args, 'language-server', { position: 'prepend' });
  return ensureCommandArgToken(withLanguageServer, '--protocol=lsp');
};

export const createDartProvider = () => ({
  id: 'dart',
  version: '1.0.0',
  label: 'dart language-server (dedicated)',
  priority: 88,
  languages: ['dart'],
  kinds: ['types', 'diagnostics'],
  requires: { cmd: 'dart', args: ['language-server', '--protocol=lsp'] },
  capabilities: {
    supportsVirtualDocuments: true,
    supportsSegmentRouting: true,
    supportsJavaScript: false,
    supportsTypeScript: false,
    supportsSymbolRef: false
  },
  getConfigHash(ctx) {
    return hashProviderConfig({ dart: ctx?.toolingConfig?.dart || {} });
  },
  async run(ctx, inputs) {
    const log = typeof ctx?.logger === 'function' ? ctx.logger : (() => {});
    const config = ctx?.toolingConfig?.dart || {};
    const docs = Array.isArray(inputs?.documents)
      ? inputs.documents.filter((doc) => DART_EXTS.includes(path.extname(doc.virtualPath).toLowerCase()))
      : [];
    const targets = filterTargetsForDocuments(inputs?.targets, docs);
    const duplicateChecks = buildDuplicateChunkUidChecks(targets, { label: 'dart' });
    if (!docs.length || !targets.length) {
      return {
        provider: { id: 'dart', version: '1.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }
    if (config.enabled !== true) {
      return {
        provider: { id: 'dart', version: '1.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }

    const checks = [...duplicateChecks];
    const requiresWorkspaceModel = config.requireWorkspaceModel !== false;
    if (requiresWorkspaceModel) {
      const markerFound = hasWorkspaceMarker(ctx?.repoRoot || process.cwd(), {
        exactNames: ['pubspec.yaml']
      });
      if (!markerFound) {
        checks.push({
          name: 'dart_workspace_model_missing',
          status: 'warn',
          message: 'dart workspace markers not found; skipping dedicated provider.'
        });
        return {
          provider: { id: 'dart', version: '1.0.0', configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, checks)
        };
      }
    }

    const requestedCmd = typeof config.cmd === 'string' && config.cmd.trim() ? config.cmd.trim() : 'dart';
    const requestedArgs = ensureLanguageServerArgs(normalizeCommandArgs(config.args));
    const commandProfile = resolveToolingCommandProfile({
      providerId: 'dart',
      cmd: requestedCmd,
      args: requestedArgs,
      repoRoot: ctx?.repoRoot || process.cwd(),
      toolingConfig: ctx?.toolingConfig || {}
    });
    if (!commandProfile.probe.ok) {
      checks.push({
        name: 'dart_command_unavailable',
        status: 'warn',
        message: `${requestedCmd} command not available for dart language-server.`
      });
      return {
        provider: { id: 'dart', version: '1.0.0', configHash: this.getConfigHash(ctx) },
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
      providerId: 'dart',
      cmd: commandProfile.resolved.cmd,
      args: ensureLanguageServerArgs(commandProfile.resolved.args || requestedArgs),
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
      provider: { id: 'dart', version: '1.0.0', configHash: this.getConfigHash(ctx) },
      byChunkUid: result.byChunkUid,
      diagnostics: result.runtime
        ? { ...(diagnostics || {}), runtime: result.runtime }
        : diagnostics
    };
  }
});
