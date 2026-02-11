import fsSync from 'node:fs';
import path from 'node:path';
import { execaSync } from 'execa';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { isAbsolutePathNative } from '../../shared/files.js';

const CLANGD_BASE_EXTS = ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh'];
const CLANGD_OBJC_EXTS = ['.m', '.mm'];
export const CLIKE_EXTS = process.platform === 'darwin'
  ? [...CLANGD_BASE_EXTS, ...CLANGD_OBJC_EXTS]
  : CLANGD_BASE_EXTS;

const shouldUseShell = (cmd) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);

const quoteWindowsCmdArg = (value) => {
  const text = String(value ?? '');
  if (!text) return '""';
  if (!/[\s"&|<>^();]/u.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
};

const runProbeCommand = (cmd, args) => {
  if (!shouldUseShell(cmd)) {
    return execaSync(cmd, args, {
      stdio: 'ignore',
      reject: false
    });
  }
  const commandLine = [cmd, ...(Array.isArray(args) ? args : [])]
    .map(quoteWindowsCmdArg)
    .join(' ');
  return execaSync(commandLine, {
    stdio: 'ignore',
    shell: true,
    reject: false
  });
};

const asFiniteNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const canRunClangd = (cmd) => {
  try {
    const result = runProbeCommand(cmd, ['--version']);
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

const resolveCompileCommandsDir = (rootDir, clangdConfig) => {
  const candidates = [];
  if (clangdConfig?.compileCommandsDir) {
    const value = clangdConfig.compileCommandsDir;
    candidates.push(isAbsolutePathNative(value) ? value : path.join(rootDir, value));
  } else {
    candidates.push(rootDir);
    candidates.push(path.join(rootDir, 'build'));
    candidates.push(path.join(rootDir, 'out'));
    candidates.push(path.join(rootDir, 'cmake-build-debug'));
    candidates.push(path.join(rootDir, 'cmake-build-release'));
  }
  for (const dir of candidates) {
    const candidate = path.join(dir, 'compile_commands.json');
    if (fsSync.existsSync(candidate)) return dir;
  }
  return null;
};

const parseObjcSignature = (detail) => {
  if (!detail || !detail.includes(':')) return null;
  const signature = detail.trim();
  const returnMatch = signature.match(/\(([^)]+)\)\s*[^:]+/);
  const returnType = returnMatch ? returnMatch[1].trim() : null;
  const paramTypes = {};
  const paramNames = [];
  const paramRe = /:\s*\(([^)]+)\)\s*([A-Za-z_][\w]*)/g;
  let match;
  while ((match = paramRe.exec(signature)) !== null) {
    const type = match[1]?.trim();
    const name = match[2]?.trim();
    if (!type || !name) continue;
    paramNames.push(name);
    paramTypes[name] = type;
  }
  if (!returnType && !paramNames.length) return null;
  return { signature, returnType, paramTypes, paramNames };
};

const parseClikeSignature = (detail, symbolName) => {
  if (!detail || typeof detail !== 'string') return null;
  const open = detail.indexOf('(');
  const close = detail.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) return null;
  const signature = detail.trim();
  const before = detail.slice(0, open).trim();
  const paramsText = detail.slice(open + 1, close).trim();
  let returnType = null;
  if (before) {
    let idx = -1;
    if (symbolName) {
      idx = before.lastIndexOf(symbolName);
      if (idx === -1) idx = before.lastIndexOf(`::${symbolName}`);
      if (idx !== -1 && before[idx] === ':' && before[idx - 1] === ':') idx -= 1;
    }
    returnType = idx > 0 ? before.slice(0, idx).trim() : before;
    returnType = returnType.replace(/\b(static|inline|constexpr|virtual|extern|friend)\b/g, '').trim();
  }
  const paramTypes = {};
  const paramNames = [];
  const parts = paramsText.split(',');
  for (const part of parts) {
    const cleaned = part.trim();
    if (!cleaned || cleaned === 'void' || cleaned === '...') continue;
    const noDefault = cleaned.split('=').shift().trim();
    const nameMatch = noDefault.match(/([A-Za-z_][\w]*)\s*(?:\[[^\]]*\])?$/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const type = noDefault.slice(0, nameMatch.index).trim();
    if (!name || !type) continue;
    paramNames.push(name);
    paramTypes[name] = type;
  }
  return { signature, returnType, paramTypes, paramNames };
};

const parseSignature = (detail, languageId, symbolName) => {
  if (!detail || typeof detail !== 'string') return null;
  const trimmed = detail.trim();
  if (!trimmed) return null;
  if (languageId === 'objective-c' || languageId === 'objective-cpp') {
    const objc = parseObjcSignature(trimmed);
    if (objc) return objc;
  }
  return parseClikeSignature(trimmed, symbolName);
};

const createClangdStderrFilter = () => {
  let suppressedIncludeCleaner = 0;
  const includeCleanerPattern = /\bIncludeCleaner:\s+Failed to get an entry for resolved path '' from include <[^>]+>\s*:\s*no such file or directory\b/i;
  return {
    filter: (line) => {
      if (includeCleanerPattern.test(String(line || ''))) {
        suppressedIncludeCleaner += 1;
        return null;
      }
      return line;
    },
    flush: (log) => {
      if (!suppressedIncludeCleaner) return;
      log(
        `[tooling] clangd suppressed ${suppressedIncludeCleaner} IncludeCleaner stderr line(s); ` +
        'missing include roots should be configured via compile_commands.json.'
      );
    }
  };
};

export const createClangdProvider = () => ({
  id: 'clangd',
  version: '2.0.0',
  label: 'clangd',
  priority: 20,
  languages: ['clike', 'c', 'cpp', 'objective-c', 'objective-cpp'],
  kinds: ['types'],
  requires: { cmd: 'clangd' },
  capabilities: {
    supportsVirtualDocuments: true,
    supportsSegmentRouting: true,
    supportsJavaScript: false,
    supportsTypeScript: false,
    supportsSymbolRef: false
  },
  getConfigHash(ctx) {
    return hashProviderConfig({ clangd: ctx?.toolingConfig?.clangd || {} });
  },
  async run(ctx, inputs) {
    const log = typeof ctx?.logger === 'function' ? ctx.logger : (() => {});
    const docs = Array.isArray(inputs?.documents)
      ? inputs.documents.filter((doc) => CLIKE_EXTS.includes(path.extname(doc.virtualPath).toLowerCase()))
      : [];
    const targets = Array.isArray(inputs?.targets)
      ? inputs.targets.filter((target) => docs.some((doc) => doc.virtualPath === target.virtualPath))
      : [];
    const duplicateChecks = buildDuplicateChunkUidChecks(targets, { label: 'clangd' });
    if (!docs.length || !targets.length) {
      return {
        provider: { id: 'clangd', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }
    const clangdConfig = ctx?.toolingConfig?.clangd || {};
    const compileCommandsDir = resolveCompileCommandsDir(ctx.repoRoot, clangdConfig);
    if (!compileCommandsDir && clangdConfig.requireCompilationDatabase === true) {
      log('[index] clangd requires compile_commands.json; skipping tooling-based types.');
      return {
        provider: { id: 'clangd', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }
    const resolvedCmd = resolveCommand('clangd');
    if (!canRunClangd(resolvedCmd)) {
      log('[index] clangd not detected; skipping tooling-based types.');
      return {
        provider: { id: 'clangd', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }
    const clangdArgs = [];
    // clangd is very chatty at info-level (e.g. missing compilation DB).
    // Keep stdout/stderr noise down during indexing runs.
    clangdArgs.push('--log=error');
    clangdArgs.push('--background-index=false');
    if (compileCommandsDir) clangdArgs.push(`--compile-commands-dir=${compileCommandsDir}`);
    const globalTimeoutMs = asFiniteNumber(ctx?.toolingConfig?.timeoutMs);
    const providerTimeoutMs = asFiniteNumber(clangdConfig.timeoutMs);
    const timeoutMs = Math.max(30000, Math.floor(providerTimeoutMs ?? globalTimeoutMs ?? 45000));
    const retries = Number.isFinite(Number(clangdConfig.maxRetries))
      ? Math.max(0, Math.floor(Number(clangdConfig.maxRetries)))
      : (ctx?.toolingConfig?.maxRetries ?? 1);
    const breakerThreshold = Number.isFinite(Number(clangdConfig.circuitBreakerThreshold))
      ? Math.max(1, Math.floor(Number(clangdConfig.circuitBreakerThreshold)))
      : (ctx?.toolingConfig?.circuitBreakerThreshold ?? 8);
    const configuredDocSymbolTimeout = asFiniteNumber(clangdConfig.documentSymbolTimeoutMs);
    const documentSymbolTimeoutMs = Math.max(
      timeoutMs,
      Math.floor(configuredDocSymbolTimeout ?? timeoutMs)
    );
    const clangdStderr = createClangdStderrFilter();
    let result;
    try {
      result = await collectLspTypes({
        rootDir: ctx.repoRoot,
        documents: docs,
        targets,
        log,
        cmd: resolvedCmd,
        args: clangdArgs,
        timeoutMs,
        retries,
        breakerThreshold,
        documentSymbolTimeoutMs,
        stderrFilter: clangdStderr.filter,
        parseSignature,
        strict: ctx?.strict !== false,
        vfsRoot: ctx?.buildRoot || ctx.repoRoot,
        vfsTokenMode: ctx?.toolingConfig?.vfs?.tokenMode,
        vfsIoBatching: ctx?.toolingConfig?.vfs?.ioBatching,
        vfsColdStartCache: ctx?.toolingConfig?.vfs?.coldStartCache,
        indexDir: ctx?.buildRoot || null
      });
    } finally {
      clangdStderr.flush(log);
    }
    return {
      provider: { id: 'clangd', version: '2.0.0', configHash: this.getConfigHash(ctx) },
      byChunkUid: result.byChunkUid,
      diagnostics: appendDiagnosticChecks(
        result.diagnosticsCount ? { diagnosticsCount: result.diagnosticsCount } : null,
        [...duplicateChecks, ...(Array.isArray(result.checks) ? result.checks : [])]
      )
    };
  }
});
