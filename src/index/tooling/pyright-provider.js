import fsSync from 'node:fs';
import path from 'node:path';
import { execaSync } from 'execa';
import { isTestingEnv } from '../../shared/env.js';
import { resolveToolRoot } from '../../shared/dict-utils.js';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { parsePythonSignature } from './signature-parse/python.js';
import { isAbsolutePathNative } from '../../shared/files.js';

export const PYTHON_EXTS = ['.py', '.pyi'];

const candidateNames = (name) => {
  if (process.platform === 'win32') {
    return [`${name}.cmd`, `${name}.exe`, name];
  }
  return [name];
};

const findBinaryInDirs = (name, dirs) => {
  const candidates = candidateNames(name);
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (fsSync.existsSync(full)) return full;
    }
  }
  return null;
};

const shouldUseShell = (cmd) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);

const canRunPyright = (cmd) => {
  if (!cmd) return false;
  if (fsSync.existsSync(cmd)) return true;
  for (const args of [['--version'], ['--help']]) {
    try {
      const result = execaSync(cmd, args, {
        stdio: 'ignore',
        shell: shouldUseShell(cmd),
        reject: false
      });
      if (typeof result.exitCode === 'number') return true;
    } catch {}
  }
  return false;
};

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
    const result = await collectLspTypes({
      rootDir: ctx.repoRoot,
      documents: docs,
      targets,
      log,
      cmd: resolvedCmd,
      args: ['--stdio'],
      timeoutMs: ctx?.toolingConfig?.timeoutMs || 15000,
      retries: ctx?.toolingConfig?.maxRetries ?? 2,
      breakerThreshold: ctx?.toolingConfig?.circuitBreakerThreshold ?? 3,
      parseSignature: (detail) => parsePythonSignature(detail),
      strict: ctx?.strict !== false,
      vfsRoot: ctx?.buildRoot || ctx.repoRoot,
      vfsTokenMode: ctx?.toolingConfig?.vfs?.tokenMode,
      vfsIoBatching: ctx?.toolingConfig?.vfs?.ioBatching,
      captureDiagnostics: true
    });
    return {
      provider: { id: 'pyright', version: '2.0.0', configHash: this.getConfigHash(ctx) },
      byChunkUid: result.byChunkUid,
      diagnostics: appendDiagnosticChecks(
        result.diagnosticsCount
          ? { diagnosticsCount: result.diagnosticsCount, diagnosticsByChunkUid: result.diagnosticsByChunkUid }
          : null,
        duplicateChecks
      )
    };
  }
});
