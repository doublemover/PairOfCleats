import fsSync from 'node:fs';
import path from 'node:path';
import { execaSync } from 'execa';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { resolveToolingCommandProfile } from './command-resolver.js';
import { parsePythonSignature } from './signature-parse/python.js';
import { isAbsolutePathNative } from '../../shared/files.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';

export const PYTHON_EXTS = ['.py', '.pyi'];

const runProbeCommand = (cmd, args) => {
  return execaSync(cmd, args, {
    stdio: 'ignore',
    reject: false
  });
};
const isPyrightLangserverCmd = (cmd) => (
  String(path.basename(String(cmd || '')))
    .toLowerCase()
    .replace(/\.(cmd|exe|bat)$/, '') === 'pyright-langserver'
);
const canRunPyright = (cmd) => {
  if (!cmd) return false;
  if (isAbsolutePathNative(cmd) && !fsSync.existsSync(cmd)) return false;
  for (const args of [['--version'], ['--help']]) {
    try {
      const result = runProbeCommand(cmd, args);
      if (result.exitCode === 0) return true;
      if (isPyrightLangserverCmd(cmd)) return true;
    } catch {}
  }
  return false;
};

export const __canRunPyrightForTests = (cmd) => canRunPyright(cmd);

export const createPyrightProvider = () => ({
  id: 'pyright',
  version: '2.0.0',
  label: 'pyright',
  priority: 30,
  languages: ['python'],
  kinds: ['types', 'diagnostics'],
  requires: { cmd: 'pyright-langserver' },
  capabilities: {
    supportsVirtualDocuments: true,
    supportsSegmentRouting: true,
    supportsJavaScript: false,
    supportsTypeScript: false,
    supportsSymbolRef: false
  },
  getConfigHash(ctx) {
    return hashProviderConfig({ pyright: ctx?.toolingConfig?.pyright || {} });
  },
  async run(ctx, inputs) {
    const log = typeof ctx?.logger === 'function' ? ctx.logger : (() => {});
    const docs = Array.isArray(inputs?.documents)
      ? inputs.documents.filter((doc) => PYTHON_EXTS.includes(path.extname(doc.virtualPath).toLowerCase()))
      : [];
    const targets = Array.isArray(inputs?.targets)
      ? inputs.targets.filter((target) => docs.some((doc) => doc.virtualPath === target.virtualPath))
      : [];
    const duplicateChecks = buildDuplicateChunkUidChecks(targets, { label: 'pyright' });
    if (!docs.length || !targets.length) {
      return {
        provider: { id: 'pyright', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }
    const commandProfile = resolveToolingCommandProfile({
      providerId: 'pyright',
      cmd: 'pyright-langserver',
      args: ['--stdio'],
      repoRoot: ctx?.repoRoot || process.cwd(),
      toolingConfig: ctx?.toolingConfig || {}
    });
    const resolvedCmd = commandProfile.resolved.cmd;
    if (!canRunPyright(resolvedCmd)) {
      log('[index] pyright-langserver not detected; skipping tooling-based types.');
      return {
        provider: { id: 'pyright', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }
    const pyrightConfig = ctx?.toolingConfig?.pyright || {};
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
      cmd: resolvedCmd,
      args: commandProfile.resolved.args || ['--stdio'],
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
      [...duplicateChecks, ...(Array.isArray(result.checks) ? result.checks : [])]
    );
    return {
      provider: { id: 'pyright', version: '2.0.0', configHash: this.getConfigHash(ctx) },
      byChunkUid: result.byChunkUid,
      diagnostics: result.runtime
        ? { ...(diagnostics || {}), runtime: result.runtime }
        : diagnostics
    };
  }
});
