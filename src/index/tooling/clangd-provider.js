import fsSync from 'node:fs';
import path from 'node:path';
import { execaSync } from 'execa';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { isAbsolutePathNative, toPosix } from '../../shared/files.js';
import { atomicWriteJsonSync } from '../../shared/io/atomic-write.js';
import { resolveToolingCommandProfile } from './command-resolver.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';
import { filterTargetsForDocuments } from './provider-utils.js';

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
  const shellExe = process.env.ComSpec || 'cmd.exe';
  return execaSync(shellExe, ['/d', '/s', '/c', commandLine], {
    stdio: 'ignore',
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

const HEADER_FILE_EXTS = new Set([
  '.h',
  '.hh',
  '.hpp',
  '.hxx',
  '.inc',
  '.ipp',
  '.inl',
  '.tpp',
  '.cuh'
]);
const TRACKED_HEADER_PATHS_CACHE = new Map();
const TRACKED_HEADER_DISK_CACHE = new Map();
const TRACKED_HEADER_CACHE_FILE = 'clangd-tracked-headers-v1.json';

const normalizeRepoPosixPath = (value) => toPosix(String(value || ''))
  .replace(/^\.\/+/, '')
  .trim();

const headerExtForPath = (value) => {
  const ext = path.extname(String(value || '')).toLowerCase();
  return HEADER_FILE_EXTS.has(ext) ? ext : null;
};

/**
 * Build a lightweight cache fingerprint from the git index file metadata.
 * Any add/remove/rename reflected in the index should change size/mtime and
 * invalidate tracked-header cache entries for long-lived indexing processes.
 *
 * @param {string} repoRoot
 * @returns {string|null}
 */
const resolveTrackedHeaderCacheFingerprint = (repoRoot) => {
  const root = path.resolve(repoRoot || process.cwd());
  try {
    const result = execaSync('git', ['-C', root, 'rev-parse', '--git-path', 'index'], {
      reject: false,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });
    if (result.exitCode !== 0) return null;
    const rawPath = String(result.stdout || '').trim();
    if (!rawPath) return null;
    const indexPath = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(root, rawPath);
    const stat = fsSync.statSync(indexPath);
    return `${indexPath}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
};

const resolveTrackedHeaderDiskCachePath = (cacheDir) => {
  if (!cacheDir || typeof cacheDir !== 'string') return null;
  return path.join(cacheDir, 'clangd', TRACKED_HEADER_CACHE_FILE);
};

const loadTrackedHeaderDiskCache = (cachePath) => {
  if (!cachePath) return null;
  if (TRACKED_HEADER_DISK_CACHE.has(cachePath)) {
    return TRACKED_HEADER_DISK_CACHE.get(cachePath);
  }
  try {
    const raw = fsSync.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    const repos = parsed?.repos && typeof parsed.repos === 'object' ? parsed.repos : {};
    TRACKED_HEADER_DISK_CACHE.set(cachePath, repos);
    return repos;
  } catch {
    const empty = {};
    TRACKED_HEADER_DISK_CACHE.set(cachePath, empty);
    return empty;
  }
};

const persistTrackedHeaderDiskCache = (cachePath, repos) => {
  if (!cachePath || !repos || typeof repos !== 'object') return;
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    repos
  };
  try {
    atomicWriteJsonSync(cachePath, payload, {
      spaces: 0,
      newline: false,
      durable: false
    });
  } catch {}
};

export const extractIncludeHeadersFromDocuments = (documents) => {
  const headers = new Set();
  const docs = Array.isArray(documents) ? documents : [];
  const includeRe = /^\s*#\s*include\s*(?:<([^>]+)>|"([^"]+)")/gm;
  for (const doc of docs) {
    const text = String(doc?.text || '');
    if (!text) continue;
    includeRe.lastIndex = 0;
    let match;
    while ((match = includeRe.exec(text)) !== null) {
      const raw = (match[1] || match[2] || '').trim();
      if (!raw) continue;
      headers.add(normalizeRepoPosixPath(raw));
    }
  }
  return Array.from(headers);
};

export const inferIncludeRootsFromHeaderPaths = ({
  repoRoot,
  includeHeaders,
  headerPaths,
  maxRoots = 16
}) => {
  const root = path.resolve(repoRoot || process.cwd());
  const headers = Array.isArray(includeHeaders) ? includeHeaders : [];
  const tracked = Array.isArray(headerPaths) ? headerPaths : [];
  if (!headers.length || !tracked.length) return [];

  const trackedPosix = tracked
    .map((entry) => normalizeRepoPosixPath(entry))
    .filter((entry) => Boolean(entry) && headerExtForPath(entry));
  const trackedSet = new Set(trackedPosix);
  const trackedByBaseName = new Map();
  for (const trackedHeader of trackedPosix) {
    const baseName = path.posix.basename(trackedHeader);
    if (!baseName) continue;
    if (!trackedByBaseName.has(baseName)) trackedByBaseName.set(baseName, []);
    trackedByBaseName.get(baseName).push(trackedHeader);
  }
  const roots = [];
  const seen = new Set();
  const addRoot = (candidate) => {
    if (!candidate) return;
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    roots.push(normalized);
  };

  for (const includeRaw of headers) {
    const includeHeader = normalizeRepoPosixPath(includeRaw);
    if (!includeHeader) continue;
    const includeParts = includeHeader.split('/').filter(Boolean);
    const includeBase = includeParts[includeParts.length - 1] || includeHeader;

    if (trackedSet.has(includeHeader)) {
      addRoot(root);
      continue;
    }

    const candidates = trackedByBaseName.get(includeBase) || [];
    for (const trackedHeader of candidates) {
      if (!trackedHeader.endsWith(includeHeader)) continue;
      const prefixLen = trackedHeader.length - includeHeader.length;
      const prefixRaw = prefixLen > 0 ? trackedHeader.slice(0, prefixLen).replace(/\/+$/, '') : '';
      const prefixPath = prefixRaw ? path.join(root, prefixRaw) : root;
      addRoot(prefixPath);
    }

    if (includeParts.length === 1) {
      for (const trackedHeader of candidates) {
        if (!trackedHeader.endsWith(`/${includeBase}`) && trackedHeader !== includeBase) continue;
        const parent = path.dirname(trackedHeader);
        const parentPath = parent && parent !== '.'
          ? path.join(root, parent)
          : root;
        addRoot(parentPath);
      }
    }
  }

  const limited = roots
    .filter((entry) => fsSync.existsSync(entry))
    .slice(0, Math.max(0, Math.floor(Number(maxRoots) || 0)));
  return limited;
};

/**
 * Return repository-tracked header paths with cache invalidation tied to git index state.
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
export const listTrackedHeaderPaths = (repoRoot, { cacheDir = null } = {}) => {
  const cacheKey = path.resolve(repoRoot || process.cwd());
  const fingerprint = resolveTrackedHeaderCacheFingerprint(cacheKey);
  const diskCachePath = resolveTrackedHeaderDiskCachePath(cacheDir);
  if (fingerprint) {
    const cached = TRACKED_HEADER_PATHS_CACHE.get(cacheKey) || null;
    if (cached && cached.fingerprint === fingerprint) {
      return cached.paths;
    }
    const diskRepos = loadTrackedHeaderDiskCache(diskCachePath);
    const diskEntry = diskRepos && typeof diskRepos[cacheKey] === 'object'
      ? diskRepos[cacheKey]
      : null;
    if (diskEntry
      && diskEntry.fingerprint === fingerprint
      && Array.isArray(diskEntry.paths)) {
      TRACKED_HEADER_PATHS_CACHE.set(cacheKey, {
        fingerprint,
        paths: diskEntry.paths
      });
      return diskEntry.paths;
    }
  }
  const pathSpecs = Array.from(HEADER_FILE_EXTS).map((ext) => `*${ext}`);
  try {
    const result = execaSync('git', ['-C', cacheKey, 'ls-files', '-z', '--', ...pathSpecs], {
      reject: false,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    });
    if (result.exitCode !== 0) {
      return [];
    }
    const trackedPaths = String(result.stdout || '')
      .split('\0')
      .map((entry) => normalizeRepoPosixPath(entry))
      .filter((entry) => Boolean(entry) && headerExtForPath(entry));
    if (fingerprint) {
      TRACKED_HEADER_PATHS_CACHE.set(cacheKey, { fingerprint, paths: trackedPaths });
      const diskRepos = loadTrackedHeaderDiskCache(diskCachePath) || {};
      diskRepos[cacheKey] = {
        fingerprint,
        paths: trackedPaths,
        updatedAt: Date.now()
      };
      persistTrackedHeaderDiskCache(diskCachePath, diskRepos);
    }
    return trackedPaths;
  } catch {
    return [];
  }
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

export const createClangdStderrFilter = () => {
  let suppressedIncludeCleaner = 0;
  const includeCleanerPattern = /\bIncludeCleaner:\s+Failed to get an entry for resolved path '' from include (?:<([^>]+)>|"([^"]+)")\s*:\s*no such file or directory\b/i;
  const missingHeaders = new Map();
  return {
    filter: (line) => {
      const match = includeCleanerPattern.exec(String(line || ''));
      if (match) {
        suppressedIncludeCleaner += 1;
        const includePath = (match[1] || match[2] || '').trim();
        if (includePath) {
          missingHeaders.set(includePath, (missingHeaders.get(includePath) || 0) + 1);
        }
        return null;
      }
      return line;
    },
    flush: (log) => {
      if (!suppressedIncludeCleaner) return;
      const headerSummary = Array.from(missingHeaders.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([name, count]) => `${name}${count > 1 ? ` (${count})` : ''}`)
        .join(', ');
      log(
        `[tooling] clangd suppressed ${suppressedIncludeCleaner} IncludeCleaner stderr line(s); ` +
        `missing include roots should be configured via compile_commands.json.${headerSummary ? ` top missing headers: ${headerSummary}.` : ''}`
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
    let targets = filterTargetsForDocuments(inputs?.targets, docs);
    const clangdConfig = ctx?.toolingConfig?.clangd || {};
    const compileCommandsDir = resolveCompileCommandsDir(ctx.repoRoot, clangdConfig);
    let selectedDocs = docs;
    if (!compileCommandsDir) {
      const maxDocsWithoutCompileCommands = Number.isFinite(Number(clangdConfig.maxDocsWithoutCompileCommands))
        ? Math.max(1, Math.floor(Number(clangdConfig.maxDocsWithoutCompileCommands)))
        : 256;
      if (selectedDocs.length > maxDocsWithoutCompileCommands) {
        const rankedDocs = selectedDocs
          .slice()
          .sort((a, b) => {
            const aHeader = headerExtForPath(a?.virtualPath) ? 1 : 0;
            const bHeader = headerExtForPath(b?.virtualPath) ? 1 : 0;
            if (aHeader !== bHeader) return aHeader - bHeader;
            return String(a?.virtualPath || '').localeCompare(String(b?.virtualPath || ''));
          });
        selectedDocs = rankedDocs.slice(0, maxDocsWithoutCompileCommands);
        const selectedPaths = new Set(selectedDocs.map((doc) => String(doc?.virtualPath || '')));
        targets = targets.filter((target) => selectedPaths.has(String(target?.virtualPath || '')));
        log(
          `[tooling] clangd limiting documentSymbol scope to ${selectedDocs.length}/${docs.length} files ` +
          '(no compile_commands.json).'
        );
      }
    }
    const duplicateChecks = buildDuplicateChunkUidChecks(targets, { label: 'clangd' });
    if (!selectedDocs.length || !targets.length) {
      return {
        provider: { id: 'clangd', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }
    if (!compileCommandsDir && clangdConfig.requireCompilationDatabase === true) {
      log('[index] clangd requires compile_commands.json; skipping tooling-based types.');
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
    const commandProfile = resolveToolingCommandProfile({
      providerId: 'clangd',
      cmd: 'clangd',
      args: clangdArgs,
      repoRoot: ctx?.repoRoot || process.cwd(),
      toolingConfig: ctx?.toolingConfig || {}
    });
    const resolvedCmd = commandProfile.resolved.cmd;
    if (!canRunClangd(resolvedCmd)) {
      log('[index] clangd not detected; skipping tooling-based types.');
      return {
        provider: { id: 'clangd', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, duplicateChecks)
      };
    }
    const configuredFallbackFlags = Array.isArray(clangdConfig.fallbackFlags)
      ? clangdConfig.fallbackFlags
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
      : [];
    let inferredIncludeRoots = [];
    if (!compileCommandsDir && clangdConfig.autoInferIncludeRoots !== false) {
      const maxDocsForIncludeInference = Number.isFinite(Number(clangdConfig.maxDocsForIncludeInference))
        ? Math.max(1, Math.floor(Number(clangdConfig.maxDocsForIncludeInference)))
        : 384;
      if (selectedDocs.length <= maxDocsForIncludeInference) {
        const includeHeaders = extractIncludeHeadersFromDocuments(selectedDocs);
        if (includeHeaders.length) {
          const trackedHeaders = listTrackedHeaderPaths(ctx.repoRoot, { cacheDir: ctx?.cache?.dir || null });
          inferredIncludeRoots = inferIncludeRootsFromHeaderPaths({
            repoRoot: ctx.repoRoot,
            includeHeaders,
            headerPaths: trackedHeaders,
            maxRoots: Number.isFinite(Number(clangdConfig.maxInferredIncludeRoots))
              ? Math.max(0, Math.floor(Number(clangdConfig.maxInferredIncludeRoots)))
              : 16
          });
        }
      } else {
        log(
          `[tooling] clangd skipped include-root inference for ${selectedDocs.length} files ` +
          `(limit ${maxDocsForIncludeInference}).`
        );
      }
    }
    const inferredFallbackFlags = [];
    for (const includeRoot of inferredIncludeRoots) {
      inferredFallbackFlags.push('-I', includeRoot);
    }
    const fallbackFlags = [...configuredFallbackFlags, ...inferredFallbackFlags];
    const initializationOptions = fallbackFlags.length
      ? { fallbackFlags }
      : null;
    if (inferredIncludeRoots.length) {
      log(
        `[tooling] clangd inferred ${inferredIncludeRoots.length} include root(s): ` +
        `${inferredIncludeRoots.slice(0, 5).join(', ')}${inferredIncludeRoots.length > 5 ? ' ...' : ''}`
      );
    }
    const runtimeConfig = resolveLspRuntimeConfig({
      providerConfig: clangdConfig,
      globalConfigs: [ctx?.toolingConfig || null],
      defaults: {
        timeoutMs: 45000,
        retries: 1,
        breakerThreshold: 8
      }
    });
    const timeoutMs = Number(runtimeConfig.timeoutMs);
    const configuredDocSymbolTimeout = asFiniteNumber(clangdConfig.documentSymbolTimeoutMs);
    const documentSymbolTimeoutMs = Math.max(
      timeoutMs,
      Math.floor(configuredDocSymbolTimeout ?? timeoutMs)
    );
    const hoverEnabled = clangdConfig.hoverEnabled === false
      ? false
      : (compileCommandsDir ? true : clangdConfig.disableHoverWithoutCompileCommands === false);
    const signatureHelpEnabled = clangdConfig.signatureHelpEnabled === false
      || clangdConfig.signatureHelp === false
      ? false
      : runtimeConfig.signatureHelpEnabled !== false;
    const signatureHelpTimeoutMs = asFiniteNumber(clangdConfig.signatureHelpTimeoutMs)
      ?? asFiniteNumber(runtimeConfig.signatureHelpTimeoutMs);
    const hoverMaxPerFile = Number.isFinite(Number(clangdConfig.hoverMaxPerFile))
      ? Math.max(0, Math.floor(Number(clangdConfig.hoverMaxPerFile)))
      : (compileCommandsDir ? null : 8);
    if (!compileCommandsDir && hoverEnabled === false && clangdConfig.hoverEnabled !== false) {
      log('[tooling] clangd hover disabled without compile_commands.json (set tooling.clangd.disableHoverWithoutCompileCommands=false to override).');
    }
    const clangdStderr = createClangdStderrFilter();
    let result;
    try {
      result = await collectLspTypes({
        ...runtimeConfig,
        rootDir: ctx.repoRoot,
        documents: selectedDocs,
        targets,
        abortSignal: ctx?.abortSignal || null,
        log,
        providerId: 'clangd',
        cmd: resolvedCmd,
        args: commandProfile.resolved.args || clangdArgs,
        documentSymbolTimeoutMs,
        documentSymbolConcurrency: clangdConfig.documentSymbolConcurrency,
        hoverEnabled,
        signatureHelpEnabled,
        ...(Number.isFinite(signatureHelpTimeoutMs) ? { signatureHelpTimeoutMs } : {}),
        hoverMaxPerFile,
        hoverConcurrency: clangdConfig.hoverConcurrency,
        cacheRoot: ctx?.cache?.dir || null,
        stderrFilter: clangdStderr.filter,
        parseSignature,
        strict: ctx?.strict !== false,
        vfsRoot: ctx?.buildRoot || ctx.repoRoot,
        vfsTokenMode: ctx?.toolingConfig?.vfs?.tokenMode,
        vfsIoBatching: ctx?.toolingConfig?.vfs?.ioBatching,
        vfsColdStartCache: ctx?.toolingConfig?.vfs?.coldStartCache,
        indexDir: ctx?.buildRoot || null,
        initializationOptions
      });
    } finally {
      clangdStderr.flush(log);
    }
    const diagnostics = appendDiagnosticChecks(
      result.diagnosticsCount ? { diagnosticsCount: result.diagnosticsCount } : null,
      [...duplicateChecks, ...(Array.isArray(result.checks) ? result.checks : [])]
    );
    return {
      provider: { id: 'clangd', version: '2.0.0', configHash: this.getConfigHash(ctx) },
      byChunkUid: result.byChunkUid,
      diagnostics: result.runtime
        ? { ...(diagnostics || {}), runtime: result.runtime }
        : diagnostics
    };
  }
});
