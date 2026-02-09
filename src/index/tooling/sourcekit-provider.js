import fsSync from 'node:fs';
import path from 'node:path';
import { execaSync } from 'execa';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { parseSwiftSignature } from './signature-parse/swift.js';

export const SWIFT_EXTS = ['.swift'];

const shouldUseShell = (cmd) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);
const asFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const canRunSourcekit = (cmd) => {
  try {
    const result = execaSync(cmd, ['--help'], {
      stdio: 'ignore',
      shell: shouldUseShell(cmd),
      reject: false
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
};

const resolveCommand = (cmd) => {
  if (process.platform !== 'win32') return cmd;
  const lowered = String(cmd || '').toLowerCase();
  if (lowered.endsWith('.exe') || lowered.endsWith('.cmd') || lowered.endsWith('.bat')) return cmd;
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const ext of ['.exe', '.cmd', '.bat']) {
    for (const dir of pathEntries) {
      const candidate = path.join(dir, `${cmd}${ext}`);
      if (fsSync.existsSync(candidate)) return candidate;
    }
  }
  return cmd;
};

export const createSourcekitProvider = () => ({
  id: 'sourcekit',
  version: '2.0.0',
  label: 'sourcekit-lsp',
  priority: 40,
  languages: ['swift'],
  kinds: ['types'],
  requires: { cmd: 'sourcekit-lsp' },
  capabilities: {
    supportsVirtualDocuments: true,
    supportsSegmentRouting: true,
    supportsJavaScript: false,
    supportsTypeScript: false,
    supportsSymbolRef: false
  },
  getConfigHash(ctx) {
    return hashProviderConfig({ sourcekit: ctx?.toolingConfig?.sourcekit || {} });
  },
  async run(ctx, inputs) {
    const log = typeof ctx?.logger === 'function' ? ctx.logger : (() => {});
    const sourcekitConfig = ctx?.toolingConfig?.sourcekit || {};
    const docs = Array.isArray(inputs?.documents)
      ? inputs.documents.filter((doc) => SWIFT_EXTS.includes(path.extname(doc.virtualPath).toLowerCase()))
      : [];
    const targets = Array.isArray(inputs?.targets)
      ? inputs.targets.filter((target) => docs.some((doc) => doc.virtualPath === target.virtualPath))
      : [];
    const duplicateChecks = buildDuplicateChunkUidChecks(targets, { label: 'sourcekit' });
    if (!docs.length || !targets.length) {
      return {
        provider: { id: 'sourcekit', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }
    const resolvedCmd = resolveCommand('sourcekit-lsp');
    if (!canRunSourcekit(resolvedCmd)) {
      log('[index] sourcekit-lsp not detected; skipping tooling-based types.');
      return {
        provider: { id: 'sourcekit', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }
    const globalTimeoutMs = asFiniteNumber(ctx?.toolingConfig?.timeoutMs);
    const providerTimeoutMs = asFiniteNumber(sourcekitConfig.timeoutMs);
    const timeoutMs = Math.max(30000, providerTimeoutMs ?? globalTimeoutMs ?? 45000);
    const retries = Number.isFinite(Number(sourcekitConfig.maxRetries))
      ? Math.max(0, Math.floor(Number(sourcekitConfig.maxRetries)))
      : (ctx?.toolingConfig?.maxRetries ?? 2);
    const breakerThreshold = Number.isFinite(Number(sourcekitConfig.circuitBreakerThreshold))
      ? Math.max(1, Math.floor(Number(sourcekitConfig.circuitBreakerThreshold)))
      : (ctx?.toolingConfig?.circuitBreakerThreshold ?? 3);
    const hoverTimeoutMs = Math.max(
      15000,
      Math.floor(asFiniteNumber(sourcekitConfig.hoverTimeoutMs) ?? timeoutMs)
    );

    const result = await collectLspTypes({
      rootDir: ctx.repoRoot,
      documents: docs,
      targets,
      log,
      cmd: resolvedCmd,
      args: [],
      timeoutMs,
      retries,
      breakerThreshold,
      hoverTimeoutMs,
      hoverEnabled: sourcekitConfig.hover !== false,
      parseSignature: (detail) => parseSwiftSignature(detail),
      strict: ctx?.strict !== false,
      vfsRoot: ctx?.buildRoot || ctx.repoRoot,
      vfsTokenMode: ctx?.toolingConfig?.vfs?.tokenMode,
      vfsIoBatching: ctx?.toolingConfig?.vfs?.ioBatching,
      vfsColdStartCache: ctx?.toolingConfig?.vfs?.coldStartCache,
      indexDir: ctx?.buildRoot || null
    });
    return {
      provider: { id: 'sourcekit', version: '2.0.0', configHash: this.getConfigHash(ctx) },
      byChunkUid: result.byChunkUid,
      diagnostics: appendDiagnosticChecks(
        result.diagnosticsCount ? { diagnosticsCount: result.diagnosticsCount } : null,
        duplicateChecks
      )
    };
  }
});
