import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { resolveToolingCommandProfile } from './command-resolver.js';
import { parseClikeSignature } from './signature-parse/clike.js';
import { isAbsolutePathNative } from '../../shared/files.js';
import { hasWorkspaceMarker } from './workspace-model.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';

const JAVA_EXTS = ['.java'];

const resolveWorkspaceDataDir = (ctx, config) => {
  const configured = typeof config?.workspaceDataDir === 'string'
    ? config.workspaceDataDir.trim()
    : '';
  if (configured) {
    return isAbsolutePathNative(configured)
      ? configured
      : path.resolve(ctx?.repoRoot || process.cwd(), configured);
  }
  const baseRoot = ctx?.cache?.dir || ctx?.buildRoot || ctx?.repoRoot || process.cwd();
  return path.join(baseRoot, 'tooling', 'lsp-workspaces', 'jdtls');
};

const ensureWorkspaceDataArg = (args, workspaceDataDir) => {
  const normalizedArgs = Array.isArray(args) ? args.map((entry) => String(entry)) : [];
  for (let i = 0; i < normalizedArgs.length; i += 1) {
    if (normalizedArgs[i] !== '-data') continue;
    if (normalizedArgs[i + 1]) return normalizedArgs;
  }
  return [...normalizedArgs, '-data', workspaceDataDir];
};

const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

export const createJdtlsProvider = () => ({
  id: 'jdtls',
  version: '1.0.0',
  label: 'jdtls (dedicated)',
  priority: 82,
  languages: ['java'],
  kinds: ['types', 'diagnostics'],
  requires: { cmd: 'jdtls' },
  capabilities: {
    supportsVirtualDocuments: true,
    supportsSegmentRouting: true,
    supportsJavaScript: false,
    supportsTypeScript: false,
    supportsSymbolRef: false
  },
  getConfigHash(ctx) {
    return hashProviderConfig({ jdtls: ctx?.toolingConfig?.jdtls || {} });
  },
  async run(ctx, inputs) {
    const log = typeof ctx?.logger === 'function' ? ctx.logger : (() => {});
    const config = ctx?.toolingConfig?.jdtls || {};
    const docs = Array.isArray(inputs?.documents)
      ? inputs.documents.filter((doc) => JAVA_EXTS.includes(path.extname(doc.virtualPath).toLowerCase()))
      : [];
    const targets = Array.isArray(inputs?.targets)
      ? inputs.targets.filter((target) => docs.some((doc) => doc.virtualPath === target.virtualPath))
      : [];
    const duplicateChecks = buildDuplicateChunkUidChecks(targets, { label: 'jdtls' });
    if (!docs.length || !targets.length) {
      return {
        provider: { id: 'jdtls', version: '1.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }
    if (config.enabled !== true) {
      return {
        provider: { id: 'jdtls', version: '1.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }

    const checks = [...duplicateChecks];
    const requiresWorkspaceModel = config.requireWorkspaceModel !== false;
    if (requiresWorkspaceModel) {
      const markerFound = hasWorkspaceMarker(ctx?.repoRoot || process.cwd(), {
        exactNames: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']
      });
      if (!markerFound) {
        checks.push({
          name: 'jdtls_workspace_model_missing',
          status: 'warn',
          message: 'jdtls workspace model markers not found; skipping dedicated provider.'
        });
        return {
          provider: { id: 'jdtls', version: '1.0.0', configHash: this.getConfigHash(ctx) },
          byChunkUid: {},
          diagnostics: appendDiagnosticChecks(null, checks)
        };
      }
    }

    const requestedCmd = typeof config.cmd === 'string' && config.cmd.trim() ? config.cmd.trim() : 'jdtls';
    const requestedArgs = Array.isArray(config.args) ? config.args : [];
    const commandProfile = resolveToolingCommandProfile({
      providerId: 'jdtls',
      cmd: requestedCmd,
      args: requestedArgs,
      repoRoot: ctx?.repoRoot || process.cwd(),
      toolingConfig: ctx?.toolingConfig || {}
    });
    if (!commandProfile.probe.ok) {
      checks.push({
        name: 'jdtls_command_unavailable',
        status: 'warn',
        message: `${requestedCmd} command not available for jdtls.`
      });
      return {
        provider: { id: 'jdtls', version: '1.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks)
      };
    }

    const workspaceDataDir = resolveWorkspaceDataDir(ctx, config);
    try {
      await fsPromises.mkdir(workspaceDataDir, { recursive: true });
    } catch {}
    const resolvedArgs = ensureWorkspaceDataArg(commandProfile.resolved.args || requestedArgs, workspaceDataDir);

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
      args: resolvedArgs,
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
      provider: { id: 'jdtls', version: '1.0.0', configHash: this.getConfigHash(ctx) },
      byChunkUid: result.byChunkUid,
      diagnostics: result.runtime
        ? { ...(diagnostics || {}), runtime: result.runtime }
        : diagnostics
    };
  }
});
