import crypto from 'node:crypto';
import fsSync from 'node:fs';
import path from 'node:path';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig } from './provider-contract.js';
import { toPosix } from '../../shared/files.js';
import { atomicWriteJsonSync } from '../../shared/io/atomic-write.js';
import { runSyncCommandWithTimeout, toSyncCommandExitCode } from '../../shared/subprocess/sync-command.js';
import { invalidateProbeCacheOnInitializeFailure, resolveToolingCommandProfile } from './command-resolver.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';
import { resolveProviderRequestedCommand } from './provider-command-override.js';
import { filterTargetsForDocuments } from './provider-utils.js';
import { awaitToolingProviderPreflight } from './preflight-manager.js';
import { parseClikeSignature } from './signature-parse/clike.js';
import { resolveCompileCommandsDir } from './compile-commands.js';

const CLANGD_BASE_EXTS = ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh'];
const CLANGD_OBJC_EXTS = ['.m', '.mm'];
export const CLIKE_EXTS = process.platform === 'darwin'
  ? [...CLANGD_BASE_EXTS, ...CLANGD_OBJC_EXTS]
  : CLANGD_BASE_EXTS;

const asFiniteNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
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
const TRACKED_HEADER_CACHE_MAX_ENTRIES = 64;
const TRACKED_HEADER_CACHE_FILE_PREFIX = 'clangd-tracked-headers-v1';
const CLANGD_GIT_PROBE_TIMEOUT_MS = 5000;

const setBoundedCacheEntry = (map, key, value, maxEntries = TRACKED_HEADER_CACHE_MAX_ENTRIES) => {
  if (!map || typeof map.set !== 'function') return;
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest == null) break;
    map.delete(oldest);
  }
};

const runGitSync = (args, { cwd = null, maxBuffer = 32 * 1024 * 1024 } = {}) => runSyncCommandWithTimeout(
  'git',
  Array.isArray(args) ? args : [],
  {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeoutMs: CLANGD_GIT_PROBE_TIMEOUT_MS,
    maxBuffer
  }
);

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
    const result = runGitSync(['rev-parse', '--git-path', 'index'], {
      cwd: root,
      maxBuffer: 1024 * 1024
    });
    if (toSyncCommandExitCode(result) !== 0) return null;
    const rawPath = String(result?.stdout || '').trim();
    if (!rawPath) return null;
    const indexPath = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(root, rawPath);
    const stat = fsSync.statSync(indexPath);
    try {
      const digest = crypto
        .createHash('sha1')
        .update(fsSync.readFileSync(indexPath))
        .digest('hex');
      return `${indexPath}:${digest}`;
    } catch {
      return `${indexPath}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    }
  } catch {
    return null;
  }
};

const resolveTrackedHeaderDiskCachePath = (cacheDir, repoRoot) => {
  if (!cacheDir || typeof cacheDir !== 'string') return null;
  const rootHash = crypto
    .createHash('sha1')
    .update(path.resolve(String(repoRoot || process.cwd())).toLowerCase())
    .digest('hex');
  return path.join(cacheDir, 'clangd', `${TRACKED_HEADER_CACHE_FILE_PREFIX}-${rootHash}.json`);
};

const loadTrackedHeaderDiskCache = (cachePath) => {
  if (!cachePath) return null;
  if (TRACKED_HEADER_DISK_CACHE.has(cachePath)) {
    return TRACKED_HEADER_DISK_CACHE.get(cachePath);
  }
  try {
    const raw = fsSync.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    const entry = (
      parsed
      && typeof parsed === 'object'
      && Number(parsed.version) === 1
      && typeof parsed.fingerprint === 'string'
      && Array.isArray(parsed.paths)
    )
      ? {
        fingerprint: parsed.fingerprint,
        paths: parsed.paths
      }
      : null;
    setBoundedCacheEntry(TRACKED_HEADER_DISK_CACHE, cachePath, entry);
    return entry;
  } catch {
    setBoundedCacheEntry(TRACKED_HEADER_DISK_CACHE, cachePath, null);
    return null;
  }
};

const persistTrackedHeaderDiskCache = (cachePath, entry) => {
  if (!cachePath || !entry || typeof entry !== 'object') return;
  const payload = {
    version: 1,
    updatedAt: Date.now(),
    fingerprint: String(entry.fingerprint || ''),
    paths: Array.isArray(entry.paths) ? entry.paths : []
  };
  try {
    atomicWriteJsonSync(cachePath, payload, {
      spaces: 0,
      newline: false,
      durable: false
    });
    setBoundedCacheEntry(TRACKED_HEADER_DISK_CACHE, cachePath, {
      fingerprint: payload.fingerprint,
      paths: payload.paths
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
  const diskCachePath = resolveTrackedHeaderDiskCachePath(cacheDir, cacheKey);
  if (fingerprint) {
    const cached = TRACKED_HEADER_PATHS_CACHE.get(cacheKey) || null;
    if (cached && cached.fingerprint === fingerprint) {
      return cached.paths;
    }
    const diskEntry = loadTrackedHeaderDiskCache(diskCachePath);
    if (diskEntry
      && diskEntry.fingerprint === fingerprint
      && Array.isArray(diskEntry.paths)) {
      setBoundedCacheEntry(TRACKED_HEADER_PATHS_CACHE, cacheKey, {
        fingerprint,
        paths: diskEntry.paths
      });
      return diskEntry.paths;
    }
  }
  const pathSpecs = Array.from(HEADER_FILE_EXTS).map((ext) => `*${ext}`);
  try {
    const result = runGitSync(['ls-files', '-z', '--', ...pathSpecs], {
      cwd: cacheKey,
      maxBuffer: 32 * 1024 * 1024
    });
    if (toSyncCommandExitCode(result) !== 0) {
      return [];
    }
    const trackedPaths = String(result?.stdout || '')
      .split('\0')
      .map((entry) => normalizeRepoPosixPath(entry))
      .filter((entry) => Boolean(entry) && headerExtForPath(entry));
    if (fingerprint) {
      setBoundedCacheEntry(TRACKED_HEADER_PATHS_CACHE, cacheKey, { fingerprint, paths: trackedPaths });
      persistTrackedHeaderDiskCache(diskCachePath, {
        fingerprint,
        paths: trackedPaths,
        updatedAt: Date.now()
      });
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

const resolveClangdDocumentsAndTargets = (inputs) => {
  const docs = Array.isArray(inputs?.documents)
    ? inputs.documents.filter((doc) => CLIKE_EXTS.includes(path.extname(doc.virtualPath).toLowerCase()))
    : [];
  const targets = filterTargetsForDocuments(inputs?.targets, docs);
  return { docs, targets };
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
  preflightId: 'clangd.workspace-model',
  preflightClass: 'workspace',
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
  async preflight(ctx, inputs = {}) {
    const log = typeof inputs?.log === 'function'
      ? inputs.log
      : (typeof ctx?.logger === 'function' ? ctx.logger : (() => {}));
    const { docs, targets } = resolveClangdDocumentsAndTargets(inputs);
    if (!docs.length || !targets.length) {
      return {
        state: 'skipped',
        blockProvider: false,
        compileCommandsDir: null,
        check: null
      };
    }
    const clangdConfig = inputs?.clangdConfig || ctx?.toolingConfig?.clangd || {};
    const compileCommandsDir = resolveCompileCommandsDir(ctx.repoRoot, clangdConfig);
    if (!compileCommandsDir && clangdConfig.requireCompilationDatabase === true) {
      log('[index] clangd requires compile_commands.json; skipping tooling-based types.');
      return {
        state: 'blocked',
        reasonCode: 'clangd_compile_commands_missing',
        blockProvider: true,
        compileCommandsDir: null,
        check: {
          name: 'clangd_compile_commands_missing',
          status: 'warn',
          message: 'clangd requires compile_commands.json; skipping tooling-based types.'
        }
      };
    }
    return {
      state: 'ready',
      blockProvider: false,
      compileCommandsDir: compileCommandsDir || null,
      check: null
    };
  },
  async run(ctx, inputs) {
    const log = typeof ctx?.logger === 'function' ? ctx.logger : (() => {});
    const { docs, targets: resolvedTargets } = resolveClangdDocumentsAndTargets(inputs);
    let targets = resolvedTargets;
    const clangdConfig = ctx?.toolingConfig?.clangd || {};
    const duplicateChecks = buildDuplicateChunkUidChecks(targets, { label: 'clangd' });
    const preflightChecks = [];
    const preflight = await awaitToolingProviderPreflight(ctx, {
      provider: this,
      inputs: {
        ...inputs,
        documents: docs,
        targets,
        clangdConfig,
        log
      },
      waveToken: typeof inputs?.toolingPreflightWaveToken === 'string'
        ? inputs.toolingPreflightWaveToken
        : null
    });
    if (preflight?.check && typeof preflight.check === 'object') {
      preflightChecks.push(preflight.check);
    }
    if (preflight?.blockProvider === true || preflight?.blockSourcekit === true) {
      return {
        provider: { id: 'clangd', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, [...duplicateChecks, ...preflightChecks])
      };
    }
    const compileCommandsDir = preflight?.compileCommandsDir || resolveCompileCommandsDir(ctx.repoRoot, clangdConfig);
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
    const checks = [...duplicateChecks, ...preflightChecks];
    if (!selectedDocs.length || !targets.length) {
      return {
        provider: { id: 'clangd', version: '2.0.0', configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks)
      };
    }
    const clangdArgs = [];
    // clangd is very chatty at info-level (e.g. missing compilation DB).
    // Keep stdout/stderr noise down during indexing runs.
    clangdArgs.push('--log=error');
    clangdArgs.push('--background-index=false');
    if (compileCommandsDir) clangdArgs.push(`--compile-commands-dir=${compileCommandsDir}`);
    const requestedCommand = resolveProviderRequestedCommand({
      providerId: 'clangd',
      toolingConfig: ctx?.toolingConfig || {},
      defaultCmd: 'clangd',
      defaultArgs: clangdArgs
    });
    const commandProfile = resolveToolingCommandProfile({
      providerId: 'clangd',
      cmd: requestedCommand.cmd,
      args: requestedCommand.args,
      repoRoot: ctx?.repoRoot || process.cwd(),
      toolingConfig: ctx?.toolingConfig || {}
    });
    if (!commandProfile.probe.ok) {
      log('[index] clangd command probe failed; attempting stdio initialization.');
      checks.push({
        name: 'clangd_command_unavailable',
        status: 'warn',
        message: 'clangd command probe failed; attempting stdio initialization anyway.'
      });
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
        cmd: commandProfile.resolved.cmd,
        args: commandProfile.resolved.args || requestedCommand.args,
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
      [...checks, ...(Array.isArray(result.checks) ? result.checks : [])]
    );
    invalidateProbeCacheOnInitializeFailure({
      checks: result?.checks,
      providerId: 'clangd',
      command: commandProfile.resolved.cmd
    });
    return {
      provider: { id: 'clangd', version: '2.0.0', configHash: this.getConfigHash(ctx) },
      byChunkUid: result.byChunkUid,
      diagnostics: result.runtime
        ? { ...(diagnostics || {}), runtime: result.runtime }
        : diagnostics
    };
  }
});

