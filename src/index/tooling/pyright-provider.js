import path from 'node:path';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { resolveToolingCommandProfile } from './command-resolver.js';
import { parsePythonSignature } from './signature-parse/python.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';
import { resolveProviderRequestedCommand } from './provider-command-override.js';
import { filterTargetsForDocuments } from './provider-utils.js';

export const PYTHON_EXTS = ['.py', '.pyi'];

export const __canRunPyrightForTests = (cmd) => (
  resolveToolingCommandProfile({
    providerId: 'pyright',
    cmd,
    args: [],
    repoRoot: process.cwd(),
    toolingConfig: {}
  })?.probe?.ok === true
);

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
    const pyright = ctx?.toolingConfig?.pyright || {};
    return hashProviderConfig({
      pyright: {
        ...pyright,
        command: typeof pyright?.command === 'string' ? pyright.command : null,
        args: Array.isArray(pyright?.args) ? pyright.args.map((entry) => String(entry)) : null
      }
    });
  },
  async run(ctx, inputs) {
    const log = typeof ctx?.logger === 'function' ? ctx.logger : (() => {});
    const docs = Array.isArray(inputs?.documents)
      ? inputs.documents.filter((doc) => PYTHON_EXTS.includes(path.extname(doc.virtualPath).toLowerCase()))
      : [];
    const targets = filterTargetsForDocuments(inputs?.targets, docs);
    const duplicateChecks = buildDuplicateChunkUidChecks(targets, { label: 'pyright' });
    const checks = [...duplicateChecks];
    if (!docs.length || !targets.length) {
      return {
        provider: { id: 'pyright', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks)
      };
    }
    const pyrightConfig = ctx?.toolingConfig?.pyright || {};
    const requestedCommand = resolveProviderRequestedCommand({
      providerId: 'pyright',
      toolingConfig: ctx?.toolingConfig || {},
      defaultCmd: 'pyright-langserver',
      defaultArgs: ['--stdio']
    });

    const commandProfile = resolveToolingCommandProfile({
      providerId: 'pyright',
      cmd: requestedCommand.cmd,
      args: requestedCommand.args,
      repoRoot: ctx?.repoRoot || process.cwd(),
      toolingConfig: ctx?.toolingConfig || {}
    });
    if (!commandProfile.probe.ok) {
      log('[index] pyright-langserver command probe failed; attempting stdio initialization.');
      checks.push({
        name: 'pyright_command_unavailable',
        status: 'warn',
        message: 'pyright-langserver command probe failed; attempting stdio initialization anyway.'
      });
    }
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
      providerId: 'pyright',
      cmd: commandProfile.resolved.cmd,
      args: commandProfile.resolved.args || requestedCommand.args,
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
      [...checks, ...(Array.isArray(result.checks) ? result.checks : [])]
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
