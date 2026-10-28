import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import fsSync from 'node:fs';
import path from 'node:path';
import { throwIfAborted } from '../../shared/abort.js';
import { resolveRequestedAbortSignal } from './preflight/manager-state.js';
import { collectLspTypes } from '../../integrations/tooling/providers/lsp.js';
import { appendDiagnosticChecks, buildDuplicateChunkUidChecks, hashProviderConfig, resolveRequestCacheGeneration } from './provider-contract.js';
import { toPosix } from '../../shared/file-paths.js';
import { writeToolingCacheJsonSync } from './cache-storage.js';
import { runSyncCommandWithTimeout, toSyncCommandExitCode } from '../../shared/subprocess/sync-command.js';
import { invalidateProbeCacheOnInitializeFailure } from './command-resolver.js';
import { resolveLspRuntimeConfig } from './lsp-runtime-config.js';
import { resolveProviderRequestedCommand } from './provider-command-override.js';
import { filterTargetsForDocuments } from './provider-utils.js';
import { awaitToolingProviderPreflight } from './preflight-manager.js';
import {
  resolveCommandProfilePreflightResult,
  resolveRuntimeCommandFromPreflight
} from './preflight/command-profile-preflight.js';
import { parseClikeSignature } from './signature-parse/clike.js';
import { admitCompilationDatabase, revalidateCompilationDatabase } from './compile-commands.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import { classifyLspDocumentPathPolicy } from '../../integrations/tooling/providers/lsp/path-policy.js';

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
    writeToolingCacheJsonSync(cachePath, payload, {
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

const CLANGD_SELECTION_TIER_WEIGHT = Object.freeze({
  preferred: 0,
  secondary: 1,
  'low-value': 2,
  skipped: 3
});

const rankClangdWeakCompileContextDocs = (docs) => (
  (Array.isArray(docs) ? docs : [])
    .map((doc, index) => {
      const pathPolicy = classifyLspDocumentPathPolicy({
        providerId: 'clangd',
        virtualPath: doc?.virtualPath || ''
      });
      const tier = String(pathPolicy?.selectionTier || 'preferred');
      return {
        doc,
        index,
        pathPolicy,
        tier,
        tierWeight: CLANGD_SELECTION_TIER_WEIGHT[tier] ?? 3,
        headerPenalty: headerExtForPath(doc?.virtualPath) ? 1 : 0,
        textLength: String(doc?.text || '').length
      };
    })
    .sort((left, right) => (
      left.tierWeight - right.tierWeight
      || left.headerPenalty - right.headerPenalty
      || right.textLength - left.textLength
      || String(left.doc?.virtualPath || '').localeCompare(String(right.doc?.virtualPath || ''))
      || left.index - right.index
    ))
);

const reduceClangdWeakCompileContextScope = ({
  docs,
  targets,
  maxDocs
}) => {
  const ranked = rankClangdWeakCompileContextDocs(docs);
  const boundedMaxDocs = Math.max(1, Math.floor(Number(maxDocs) || 1));
  const selectedRanked = ranked.slice(0, boundedMaxDocs);
  const selectedDocs = selectedRanked.map((entry) => entry.doc);
  const selectedPaths = new Set(selectedDocs.map((doc) => String(doc?.virtualPath || '')));
  const selectedTargets = (Array.isArray(targets) ? targets : [])
    .filter((target) => selectedPaths.has(String(target?.virtualPath || '')));
  const droppedRanked = ranked.slice(boundedMaxDocs);
  const droppedByTier = {
    preferred: 0,
    secondary: 0,
    'low-value': 0,
    skipped: 0
  };
  let droppedHeaders = 0;
  for (const entry of droppedRanked) {
    droppedByTier[entry.tier] = Number(droppedByTier[entry.tier] || 0) + 1;
    if (entry.headerPenalty > 0) droppedHeaders += 1;
  }
  return {
    selectedDocs,
    selectedTargets,
    droppedDocs: droppedRanked.length,
    droppedHeaders,
    droppedByTier
  };
};

const buildClangdRequestedCommand = ({ ctx, clangdConfig, compileCommandsDir }) => {
  const clangdArgs = ['--log=error', '--background-index=false'];
  if (compileCommandsDir) clangdArgs.push(`--compile-commands-dir=${compileCommandsDir}`);
  const requested = resolveProviderRequestedCommand({
    providerId: 'clangd',
    toolingConfig: ctx?.toolingConfig || {},
    defaultCmd: 'clangd',
    defaultArgs: clangdArgs
  });
  if (compileCommandsDir && !requested.args.some(value => /^--?compile-commands-dir(?:=|$)/.test(value))) {
    return { ...requested, args: [...requested.args, `--compile-commands-dir=${compileCommandsDir}`] };
  }
  return requested;
};

const compilationContextCheck = admission => ({
  name: 'clangd_compilation_context',
  status: admission.counts.exact === admission.documents.length && admission.status === 'usable' ? 'ok' : 'warn',
  message: `clangd compilation database=${admission.status}; exact=${admission.counts.exact}/${admission.documents.length}, ambiguous=${admission.counts.ambiguous}, unknown=${admission.counts.unknown}.`,
  database: { status: admission.status, path: admission.selection.path, explicit: admission.explicit,
    sha256: admission.sha256, totalEntries: admission.totalEntries, usableEntries: admission.usableEntries,
    invalidEntries: admission.invalidEntries, sourcePathBudgetReached: admission.sourcePathBudgetReached },
  coverage: admission.counts,
  documents: admission.documents
});

const buildClangdCommandUnavailableCheck = ({ definitelyMissing = false } = {}) => ({
  name: 'clangd_command_unavailable',
  status: 'warn',
  message: definitelyMissing ? 'clangd command is unavailable; skipping tooling-based types.'
    : 'clangd command probe failed; attempting stdio initialization anyway.'
});

const resolveConfiguredFallbackFlags = (clangdConfig) => (
  Array.isArray(clangdConfig?.fallbackFlags)
    ? clangdConfig.fallbackFlags
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
    : []
);

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
  version: '3.0.0',
  profileContractVersion: 1,
  label: 'clangd',
  priority: 20,
  languages: ['clike', 'c', 'cpp', 'objective-c', 'objective-cpp'],
  kinds: ['types'],
  requires: { cmd: 'clangd' },
  preflightPolicy: 'optional',
  preflightRuntimeRequirements: [],
  capabilities: {
    supportsVirtualDocuments: true,
    supportsSegmentRouting: true,
    supportsJavaScript: false,
    supportsTypeScript: false,
    supportsSymbolRef: false
  },
  getConfigHash(ctx) {
    return hashProviderConfig({ clangd: ctx?.toolingConfig?.clangd || {}, compilationContextAdmission: 1 });
  },
  getPreflightKey(ctx, inputs) {
    return hashProviderConfig({ documents: resolveClangdDocumentsAndTargets(inputs).docs
      .map(doc => [doc.virtualPath, doc.containerPath || null, doc.docHash || null]) });
  },
  async preflight(ctx, inputs = {}) {
    const abortSignal = resolveRequestedAbortSignal(ctx, inputs);
    throwIfAborted(abortSignal);
    const log = typeof inputs?.log === 'function'
      ? inputs.log
      : (typeof ctx?.logger === 'function' ? ctx.logger : (() => {}));
    const { docs, targets } = resolveClangdDocumentsAndTargets(inputs);
    if (!docs.length || (!targets.length && !ctx.semanticLspSession?.hasTargetedWork)) {
      return {
        state: 'skipped',
        blockProvider: false,
        compileCommandsDir: null,
        check: null
      };
    }
    const clangdConfig = inputs?.clangdConfig || ctx?.toolingConfig?.clangd || {};
    const compilationDatabase = await admitCompilationDatabase({ rootDir: ctx.repoRoot, config: clangdConfig, documents: docs, signal: abortSignal });
    const compileCommandsDir = compilationDatabase.selection.dir;
    if (['invalid-selection', 'conflicting-selection', 'wrong-kind', 'unreadable', 'malformed', 'over-budget'].includes(compilationDatabase.status)) {
      return { state: 'blocked', reasonCode: 'clangd_compilation_database_unusable', blockProvider: true,
        compileCommandsDir: null, compilationDatabase, checks: [compilationContextCheck(compilationDatabase)] };
    }
    if (compilationDatabase.counts.exact === 0 && clangdConfig.requireCompilationDatabase === true) {
      log('[index] clangd requires usable exact compilation context for at least one selected document; skipping tooling-based types.');
      return {
        state: 'blocked',
        reasonCode: 'clangd_compile_commands_missing',
        blockProvider: true,
        compileCommandsDir,
        compilationDatabase,
        checks: [compilationContextCheck(compilationDatabase)],
        check: {
          name: 'clangd_compile_commands_missing',
          status: 'warn',
          message: `clangd requires usable exact compilation context for at least one selected document; database=${compilationDatabase.status}, exact=0/${docs.length}.`
        }
      };
    }
    const requestedCommand = buildClangdRequestedCommand({
      ctx,
      clangdConfig,
      compileCommandsDir
    });
    const commandPreflight = resolveCommandProfilePreflightResult({
      signal: abortSignal,
      providerId: 'clangd',
      requestedCommand,
      ctx,
      unavailableCheck: buildClangdCommandUnavailableCheck,
      blockWhenDefinitelyMissing: true
    });
    if (commandPreflight.state !== 'ready') {
      log(commandPreflight.blockProvider ? '[index] clangd command unavailable or invalid; skipping.'
        : '[index] clangd command probe failed; attempting stdio initialization.');
      return {
        state: commandPreflight.state,
        reasonCode: commandPreflight.reasonCode,
        message: commandPreflight.message,
        blockProvider: commandPreflight.blockProvider === true,
        compileCommandsDir: compileCommandsDir || null,
        compilationDatabase,
        requestedCommand: commandPreflight.requestedCommand,
        commandProfile: commandPreflight.commandProfile,
        ...(commandPreflight.check ? { check: commandPreflight.check } : {}),
        checks: [compilationContextCheck(compilationDatabase), ...(commandPreflight.checks || [])]
      };
    }
    const configuredFallbackFlags = resolveConfiguredFallbackFlags(clangdConfig);
    if (compilationDatabase.counts.exact === 0
      && clangdConfig.autoInferIncludeRoots === false
      && configuredFallbackFlags.length === 0) {
      const message = (
        'clangd has no exact compilation context and include-root inference is disabled; '
        + 'workspace model may be partial.'
      );
      return {
        state: 'degraded',
        reasonCode: 'clangd_compile_commands_missing_inference_disabled',
        message,
        blockProvider: false,
        compileCommandsDir,
        compilationDatabase,
        requestedCommand: commandPreflight.requestedCommand,
        commandProfile: commandPreflight.commandProfile,
        checks: [compilationContextCheck(compilationDatabase), {
          name: 'clangd_compile_commands_missing_inference_disabled',
          status: 'warn',
          message
        }]
      };
    }
    return {
      state: 'ready',
      blockProvider: false,
      compileCommandsDir: compileCommandsDir || null,
      compilationDatabase,
      checks: [compilationContextCheck(compilationDatabase)],
      check: null,
      requestedCommand: commandPreflight.requestedCommand,
      commandProfile: commandPreflight.commandProfile
    };
  },
  async run(ctx, inputs) {
    const abortSignal = resolveRequestedAbortSignal(ctx, inputs);
    throwIfAborted(abortSignal);
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
    if (Array.isArray(preflight?.checks)) {
      for (const check of preflight.checks) {
        if (check && typeof check === 'object') preflightChecks.push(check);
      }
    }
    if (preflight?.blockProvider === true || preflight?.blockSourcekit === true) {
      return {
        ...(ctx.semanticLspSession ? { semanticFacts: ctx.semanticLspSession.output() } : {}),
        provider: { id: 'clangd', version: this.version, configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, [...duplicateChecks, ...preflightChecks])
      };
    }
    const checks = [...duplicateChecks, ...preflightChecks];
    const compilationDatabase = preflight?.compilationDatabase || await admitCompilationDatabase({
      rootDir: ctx.repoRoot, config: clangdConfig, documents: docs, signal: abortSignal
    });
    const contextIsCurrent = async () => {
      try {
        return await revalidateCompilationDatabase(compilationDatabase,
          { rootDir: ctx.repoRoot, config: clangdConfig, documents: docs, signal: abortSignal });
      } catch (error) {
        observeStorageResource(error, { phase: 'clangd-compilation-context-revalidation' }).requireSettled();
        throwIfAborted(abortSignal); return false;
      }
    };
    if (!await contextIsCurrent()) {
      checks.push({ name: 'clangd_compilation_context_changed', status: 'warn',
        message: 'clangd compilation context changed after preflight; replan before provider dispatch.' });
      return { provider: { id: 'clangd', version: this.version, configHash: this.getConfigHash(ctx) }, byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks) };
    }
    if (!checks.some(check => check.name === 'clangd_compilation_context')) checks.push(compilationContextCheck(compilationDatabase));
    const compileCommandsDir = compilationDatabase.selection.dir;
    const contextByPath = new Map(compilationDatabase.documents.map(row => [row.virtualPath, row]));
    const exactDocs = docs.filter(doc => contextByPath.get(doc.virtualPath)?.status === 'exact');
    const weakDocs = docs.filter(doc => contextByPath.get(doc.virtualPath)?.status !== 'exact');
    let selectedDocs = [...exactDocs, ...weakDocs];
    if (weakDocs.length) {
      const maxDocsWithoutCompileCommands = Number.isFinite(Number(clangdConfig.maxDocsWithoutCompileCommands))
        ? Math.max(1, Math.floor(Number(clangdConfig.maxDocsWithoutCompileCommands)))
        : 128;
      if (weakDocs.length > maxDocsWithoutCompileCommands) {
        const scopeReduction = reduceClangdWeakCompileContextScope({
          docs: weakDocs,
          targets,
          maxDocs: maxDocsWithoutCompileCommands
        });
        selectedDocs = [...exactDocs, ...scopeReduction.selectedDocs];
        targets = filterTargetsForDocuments(targets, selectedDocs);
        checks.push({
          name: 'clangd_weak_compile_context_scope_reduced',
          status: 'warn',
          message: `clangd reduced documentSymbol scope to ${selectedDocs.length}/${docs.length} files; retained ${exactDocs.length} exact-context files and dropped ${scopeReduction.droppedDocs} weak-context file(s) (${scopeReduction.droppedHeaders} headers, ${scopeReduction.droppedByTier['low-value']} low-value, ${scopeReduction.droppedByTier.secondary} secondary).`,
          selectedDocs: selectedDocs.length,
          totalDocs: docs.length,
          droppedDocs: scopeReduction.droppedDocs,
          droppedHeaders: scopeReduction.droppedHeaders,
          droppedByTier: scopeReduction.droppedByTier
        });
        log(
          `[tooling] clangd limiting documentSymbol scope to ${selectedDocs.length}/${docs.length} files ` +
          `(exact=${exactDocs.length}; droppedWeak=${scopeReduction.droppedDocs}; ` +
          `headers=${scopeReduction.droppedHeaders}; lowValue=${scopeReduction.droppedByTier['low-value']}).`
        );
      }
    }
    if (!selectedDocs.length || (!targets.length && !ctx.semanticLspSession?.hasTargetedWork)) {
      return {
        provider: { id: 'clangd', version: this.version, configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks)
      };
    }
    const currentRequestedCommand = buildClangdRequestedCommand({ ctx, clangdConfig, compileCommandsDir });
    if (preflight?.requestedCommand && hashProviderConfig(preflight.requestedCommand) !== hashProviderConfig(currentRequestedCommand)) {
      checks.push({ name: 'clangd_compilation_launch_changed', status: 'warn',
        message: 'clangd launch/configuration changed after compilation-context admission; replan before dispatch.' });
      return { provider: { id: 'clangd', version: this.version, configHash: this.getConfigHash(ctx) }, byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks) };
    }
    const requestedCommand = preflight?.requestedCommand && typeof preflight.requestedCommand === 'object'
      ? preflight.requestedCommand
      : buildClangdRequestedCommand({
        ctx,
        clangdConfig,
        compileCommandsDir
      });
    const runtimeCommand = resolveRuntimeCommandFromPreflight({
      signal: abortSignal,
      preflight,
      fallbackRequestedCommand: requestedCommand,
      providerId: 'clangd',
      repoRoot: ctx?.repoRoot || process.cwd(),
      toolingConfig: ctx?.toolingConfig || {},
      missingProfileCheck: {
        name: 'clangd_preflight_command_profile_missing',
        status: 'warn',
        message: 'clangd preflight did not provide a resolved command profile; skipping provider.'
      }
    });
    const resolvedCmd = runtimeCommand.cmd;
    const resolvedArgs = runtimeCommand.args;
    if (!resolvedCmd) {
      checks.push(...runtimeCommand.checks);
      return {
        provider: { id: 'clangd', version: this.version, configHash: this.getConfigHash(ctx) },
        byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks)
      };
    }
    if (runtimeCommand.probeKnown && runtimeCommand.probeOk !== true) {
      log('[index] clangd command probe failed; attempting stdio initialization.');
      if (!checks.some((entry) => entry?.name === 'clangd_command_unavailable')) {
        checks.push(buildClangdCommandUnavailableCheck());
      }
    }
    const configuredFallbackFlags = resolveConfiguredFallbackFlags(clangdConfig);
    let inferredIncludeRoots = [];
    const selectedWeakDocs = selectedDocs.filter(doc => contextByPath.get(doc.virtualPath)?.status !== 'exact');
    if (selectedWeakDocs.length && clangdConfig.autoInferIncludeRoots !== false) {
      const maxDocsForIncludeInference = Number.isFinite(Number(clangdConfig.maxDocsForIncludeInference))
        ? Math.max(1, Math.floor(Number(clangdConfig.maxDocsForIncludeInference)))
        : 384;
      if (selectedWeakDocs.length <= maxDocsForIncludeInference) {
        const includeHeaders = extractIncludeHeadersFromDocuments(selectedWeakDocs);
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
          `[tooling] clangd skipped include-root inference for ${selectedWeakDocs.length} weak-context files ` +
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
      : (exactDocs.length > 0 || clangdConfig.disableHoverWithoutCompileCommands === false);
    const signatureHelpEnabled = clangdConfig.signatureHelpEnabled === false
      || clangdConfig.signatureHelp === false
      ? false
      : runtimeConfig.signatureHelpEnabled !== false;
    const signatureHelpTimeoutMs = asFiniteNumber(clangdConfig.signatureHelpTimeoutMs)
      ?? asFiniteNumber(runtimeConfig.signatureHelpTimeoutMs);
    const hoverMaxPerFile = Number.isFinite(Number(clangdConfig.hoverMaxPerFile))
      ? Math.max(0, Math.floor(Number(clangdConfig.hoverMaxPerFile)))
      : (exactDocs.length ? null : 8);
    const documentRequestPolicies = Object.freeze(Object.fromEntries(selectedDocs.map(doc => {
      const exact = contextByPath.get(doc.virtualPath)?.status === 'exact';
      return [doc.virtualPath, Object.freeze({
        hoverEnabled: clangdConfig.hoverEnabled !== false && (exact || clangdConfig.disableHoverWithoutCompileCommands === false),
        hoverMaxPerFile: hoverMaxPerFile === 0 ? null : exact ? hoverMaxPerFile : hoverMaxPerFile ?? 8
      })];
    })));
    // Exact compile commands belong to their physical source URI. A VFS copy
    // cannot acquire exact command identity merely by sharing its basename.
    const documentUris = Object.freeze(Object.fromEntries(exactDocs.map(doc => [doc.virtualPath,
      pathToFileURL(path.resolve(ctx.repoRoot, doc.containerPath || doc.virtualPath)).href])));
    checks.push({ name: 'clangd_compile_context_request_plan', status: selectedWeakDocs.length ? 'warn' : 'ok',
      message: `clangd planned ${exactDocs.length} exact and ${selectedWeakDocs.length} weak-context documents.`,
      selectedExact: exactDocs.length, selectedWeak: selectedWeakDocs.length,
      droppedWeak: weakDocs.length - selectedWeakDocs.length,
      documents: selectedDocs.map(doc => ({ virtualPath: doc.virtualPath,
        context: contextByPath.get(doc.virtualPath)?.status === 'exact' ? 'exact'
          : inferredIncludeRoots.length ? 'inferred' : contextByPath.get(doc.virtualPath)?.status || 'unknown',
        ...documentRequestPolicies[doc.virtualPath] })) });
    if (selectedWeakDocs.length && clangdConfig.hoverEnabled !== false && clangdConfig.disableHoverWithoutCompileCommands !== false) {
      log('[tooling] clangd hover disabled for weak compilation context (set tooling.clangd.disableHoverWithoutCompileCommands=false to override).');
    }
    const clangdStderr = createClangdStderrFilter();
    if (!await contextIsCurrent()) {
      checks.push({ name: 'clangd_compilation_context_changed', status: 'warn',
        message: 'clangd compilation context changed during planning; replan before provider dispatch.' });
      return { provider: { id: 'clangd', version: this.version, configHash: this.getConfigHash(ctx) }, byChunkUid: {},
        diagnostics: appendDiagnosticChecks(null, checks) };
    }
    let result, collectionError, collectionFailed = false;
    try {
      result = await collectLspTypes({
        requestCacheGeneration: hashProviderConfig({ generation: resolveRequestCacheGeneration(ctx),
          compilationDatabase: compilationDatabase.sha256, responses: compilationDatabase.responses,
          documents: compilationDatabase.documents, sourcePaths: compilationDatabase.sourcePaths,
          ...(compilationDatabase.counts.unknown || compilationDatabase.counts.ambiguous ? { unsealedAttempt: crypto.randomUUID() } : {}) }),
        semanticSession: ctx.semanticLspSession || null,
        ...runtimeConfig,
        rootDir: ctx.repoRoot,
        documents: selectedDocs,
        targets,
        abortSignal,
        log,
        providerId: 'clangd',
        adaptiveDegradedHint: preflight?.state === 'degraded',
        adaptiveReasonHint: preflight?.reasonCode || null,
        cmd: resolvedCmd,
        args: resolvedArgs,
        documentSymbolTimeoutMs,
        documentSymbolConcurrency: clangdConfig.documentSymbolConcurrency,
        hoverEnabled,
        signatureHelpEnabled,
        ...(Number.isFinite(signatureHelpTimeoutMs) ? { signatureHelpTimeoutMs } : {}),
        hoverMaxPerFile,
        documentRequestPolicies,
        documentUris,
        hoverConcurrency: clangdConfig.hoverConcurrency,
        cacheRoot: ctx?.cache?.dir || null,
        stderrFilter: clangdStderr.filter,
        parseSignature,
        strict: ctx?.strict !== false,
        vfsRoot: ctx?.buildRoot || ctx.repoRoot,
        storageContext: ctx.storageContext || null,
        vfsTokenMode: ctx?.toolingConfig?.vfs?.tokenMode,
        vfsIoBatching: ctx?.toolingConfig?.vfs?.ioBatching,
        vfsColdStartCache: ctx?.toolingConfig?.vfs?.coldStartCache,
        indexDir: ctx?.buildRoot || null,
        initializationOptions
      });
    } catch (error) {
      collectionFailed = true;
      const observation = observeStorageResource(error, { phase: 'clangd-collection' });
      collectionError = observation.isSettled() ? error : observation.retain();
      throw collectionError;
    } finally {
      try { clangdStderr.flush(log); }
      catch (cleanup) {
        if (collectionFailed) throw addStorageFailureContext(collectionError, {}, cleanup, { secondaryPresent: true });
        throw cleanup;
      }
    }
    throwIfAborted(abortSignal);
    const diagnostics = appendDiagnosticChecks(
      result.diagnosticsCount ? { diagnosticsCount: result.diagnosticsCount } : null,
      [...checks, ...(Array.isArray(result.checks) ? result.checks : [])]
    );
    invalidateProbeCacheOnInitializeFailure({
      checks: result?.checks,
      providerId: 'clangd',
      command: resolvedCmd,
      args: resolvedArgs,
      toolingConfig: ctx?.toolingConfig || null,
      cwd: ctx?.repoRoot || process.cwd()
    });
    return {
      provider: { id: 'clangd', version: this.version, configHash: this.getConfigHash(ctx) },
      byChunkUid: result.byChunkUid,
      diagnostics: result.runtime
        ? { ...(diagnostics || {}), runtime: result.runtime }
        : diagnostics
    };
  }
});

