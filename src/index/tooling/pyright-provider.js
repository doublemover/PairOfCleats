import fsSync from 'node:fs';
import path from 'node:path';
import { execaSync } from 'execa';
import { isTestingEnv } from '../../shared/env.js';
import { resolveToolRoot } from '../../shared/dict-utils.js';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { findBinaryInDirs } from './binary-utils.js';
import { parsePythonSignature } from './signature-parse/python.js';
import { isAbsolutePathNative } from '../../shared/files.js';

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
const asFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

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

const resolveCommand = (cmd, rootDir, toolingConfig) => {
  if (!cmd) return cmd;
  if (isAbsolutePathNative(cmd) || cmd.includes(path.sep)) return cmd;
  const testing = isTestingEnv();
  if (testing) {
    const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const pathFound = findBinaryInDirs(cmd, pathEntries);
    if (pathFound) return pathFound;
  }
  const toolRoot = resolveToolRoot();
  const repoBin = path.join(rootDir, 'node_modules', '.bin');
  const toolBin = toolRoot ? path.join(toolRoot, 'node_modules', '.bin') : null;
  const toolingBin = toolingConfig?.dir
    ? path.join(toolingConfig.dir, 'node', 'node_modules', '.bin')
    : null;
  const found = findBinaryInDirs(cmd, [repoBin, toolBin, toolingBin].filter(Boolean));
  if (found) return found;
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const pathFound = findBinaryInDirs(cmd, pathEntries);
  return pathFound || cmd;
};

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
    const resolvedCmd = resolveCommand('pyright-langserver', ctx.repoRoot, ctx.toolingConfig);
    if (!canRunPyright(resolvedCmd)) {
      log('[index] pyright-langserver not detected; skipping tooling-based types.');
      return {
        provider: { id: 'pyright', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }
    const pyrightConfig = ctx?.toolingConfig?.pyright || {};
    const globalTimeoutMs = asFiniteNumber(ctx?.toolingConfig?.timeoutMs);
    const providerTimeoutMs = asFiniteNumber(pyrightConfig.timeoutMs);
    const timeoutMs = Math.max(30000, providerTimeoutMs ?? globalTimeoutMs ?? 45000);
    const retries = Number.isFinite(Number(pyrightConfig.maxRetries))
      ? Math.max(0, Math.floor(Number(pyrightConfig.maxRetries)))
      : (ctx?.toolingConfig?.maxRetries ?? 2);
    const breakerThreshold = Number.isFinite(Number(pyrightConfig.circuitBreakerThreshold))
      ? Math.max(1, Math.floor(Number(pyrightConfig.circuitBreakerThreshold)))
      : (ctx?.toolingConfig?.circuitBreakerThreshold ?? 5);
    const result = await collectLspTypes({
      rootDir: ctx.repoRoot,
      documents: docs,
      targets,
      abortSignal: ctx?.abortSignal || null,
      log,
      cmd: resolvedCmd,
      args: ['--stdio'],
      timeoutMs,
      retries,
      breakerThreshold,
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
