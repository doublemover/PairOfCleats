import path from 'node:path';
import { uniqueTypes } from '../../integrations/tooling/providers/shared.js';
import { buildToolingVirtualDocuments } from '../tooling/vfs.js';
import { runToolingProviders } from '../tooling/orchestrator.js';
import { selectToolingProviders } from '../tooling/provider-registry.js';
import { registerDefaultToolingProviders } from '../tooling/providers/index.js';
import { TOOLING_CONFIDENCE, TOOLING_SOURCE } from './constants.js';
import { addInferredParam, addInferredReturn } from './apply.js';
import { ensureParamTypeMap, getParamTypeList } from './extract.js';
import { isAbsolutePathNative, isUncPath } from '../../shared/files.js';
import { createQueuedAppendWriter } from '../../shared/io/append-writer.js';
import { normalizePathForPlatform } from '../../shared/path-normalize.js';
const EMPTY_TOOLING_PASS_STATS = Object.freeze({
  inferredReturns: 0,
  toolingDegradedProviders: 0,
  toolingDegradedWarnings: 0,
  toolingDegradedErrors: 0,
  toolingProvidersExecuted: 0,
  toolingProvidersContributed: 0,
  toolingRequests: 0,
  toolingRequestFailures: 0,
  toolingRequestTimeouts: 0
});

const WINDOWS_DRIVE_PREFIX_RE = /^[a-zA-Z]:[\\/]/;

const resolveDefaultToolingCacheDir = ({
  rootDir,
  buildRoot
}) => {
  const rawRootDir = String(rootDir || process.cwd());
  const rawBuildRoot = buildRoot ? String(buildRoot) : '';
  const useWin32PathApi = WINDOWS_DRIVE_PREFIX_RE.test(rawRootDir)
    || WINDOWS_DRIVE_PREFIX_RE.test(rawBuildRoot)
    || isUncPath(rawRootDir)
    || isUncPath(rawBuildRoot);
  const platform = useWin32PathApi ? 'win32' : 'posix';
  const pathApi = useWin32PathApi ? path.win32 : path.posix;
  const resolvedRootDir = normalizePathForPlatform(
    pathApi.resolve(rawRootDir),
    { platform }
  );
  const resolvedBuildRoot = rawBuildRoot
    ? normalizePathForPlatform(
      pathApi.resolve(rawBuildRoot),
      { platform }
    )
    : '';
  const buildParent = resolvedBuildRoot ? pathApi.dirname(resolvedBuildRoot) : '';
  if (resolvedBuildRoot && pathApi.basename(buildParent).toLowerCase() === 'builds') {
    return pathApi.join(pathApi.dirname(buildParent), 'tooling-cache');
  }
  return pathApi.join(resolvedRootDir, '.build', 'pairofcleats', 'tooling-cache');
};

export const __resolveDefaultToolingCacheDirForTests = resolveDefaultToolingCacheDir;

const createToolingLogger = (rootDir, logDir, provider, baseLog) => {
  if (!logDir || !provider) return baseLog;
  const absDir = isAbsolutePathNative(logDir) ? logDir : path.join(rootDir, logDir);
  const logFile = path.join(absDir, `${provider}.log`);
  const writer = createQueuedAppendWriter({
    filePath: logFile,
    onError: () => {}
  });
  const logger = (message) => {
    baseLog(message);
    void writer.enqueue(`[${new Date().toISOString()}] ${message}\n`);
  };
  logger.flush = () => writer.flush();
  logger.close = () => writer.close();
  return logger;
};

const toProvenanceList = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return [value];
};

const mergeToolingSources = (chunk, provenanceList) => {
  if (!chunk?.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
  const toolingMeta = chunk.docmeta.tooling && typeof chunk.docmeta.tooling === 'object'
    ? chunk.docmeta.tooling
    : {};
  const existing = Array.isArray(toolingMeta.sources) ? toolingMeta.sources : [];
  const next = [];
  const seen = new Set();
  for (const entry of [...existing, ...toProvenanceList(provenanceList)]) {
    if (!entry?.provider) continue;
    if (seen.has(entry.provider)) continue;
    seen.add(entry.provider);
    next.push(entry);
  }
  toolingMeta.sources = next;
  chunk.docmeta.tooling = toolingMeta;
};

const applyToolingTypes = ({ byChunkUid, chunkByUid, entryByUid }) => {
  let inferredReturns = 0;
  let enriched = 0;
  for (const [chunkUid, info] of byChunkUid.entries()) {
    const chunk = chunkByUid.get(chunkUid);
    if (!chunk || !info?.payload) continue;
    if (!chunk.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
    mergeToolingSources(chunk, info.provenance);
    const payload = info.payload;
    let touched = false;
    if (payload.signature && !chunk.docmeta.signature) {
      chunk.docmeta.signature = payload.signature;
      touched = true;
    }
    if (payload.returnType) {
      if (!chunk.docmeta.returnType) chunk.docmeta.returnType = payload.returnType;
      if (addInferredReturn(chunk.docmeta, payload.returnType, TOOLING_SOURCE, TOOLING_CONFIDENCE)) {
        inferredReturns += 1;
        touched = true;
      }
    }
    if (payload.paramTypes && typeof payload.paramTypes === 'object') {
      chunk.docmeta.paramTypes = ensureParamTypeMap(chunk.docmeta.paramTypes);
      for (const [name, entries] of Object.entries(payload.paramTypes)) {
        if (!name || !Array.isArray(entries)) continue;
        for (const entry of entries) {
          const type = entry?.type || null;
          if (!type) continue;
          if (!Object.hasOwn(chunk.docmeta.paramTypes, name)) chunk.docmeta.paramTypes[name] = type;
          addInferredParam(
            chunk.docmeta,
            name,
            type,
            entry?.source || TOOLING_SOURCE,
            Number.isFinite(entry?.confidence) ? entry.confidence : TOOLING_CONFIDENCE
          );
          const symbolEntry = entryByUid?.get(chunkUid) || null;
          if (symbolEntry) {
            symbolEntry.paramTypes = ensureParamTypeMap(symbolEntry.paramTypes);
            const existing = getParamTypeList(symbolEntry.paramTypes, name);
            symbolEntry.paramTypes[name] = uniqueTypes([...existing, type]);
          }
          touched = true;
        }
      }
    }
    if (touched) enriched += 1;
  }
  return { inferredReturns, enriched };
};

const applyToolingDiagnostics = ({ diagnosticsByChunkUid, chunkByUid }) => {
  let enriched = 0;
  for (const [chunkUid, diagnostics] of diagnosticsByChunkUid.entries()) {
    if (!Array.isArray(diagnostics) || !diagnostics.length) continue;
    const chunk = chunkByUid.get(chunkUid);
    if (!chunk) continue;
    if (!chunk.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
    const toolingMeta = chunk.docmeta.tooling && typeof chunk.docmeta.tooling === 'object'
      ? chunk.docmeta.tooling
      : {};
    const existing = Array.isArray(toolingMeta.diagnostics) ? toolingMeta.diagnostics : [];
    toolingMeta.diagnostics = [...existing, ...diagnostics];
    chunk.docmeta.tooling = toolingMeta;
    enriched += 1;
  }
  return { enriched };
};

const summarizeDegradedProviderCounts = (degradedProviders) => {
  if (!Array.isArray(degradedProviders) || !degradedProviders.length) {
    return {
      toolingDegradedProviders: 0,
      toolingDegradedWarnings: 0,
      toolingDegradedErrors: 0
    };
  }
  let toolingDegradedWarnings = 0;
  let toolingDegradedErrors = 0;
  for (const entry of degradedProviders) {
    toolingDegradedWarnings += Number(entry?.warningCount) || 0;
    toolingDegradedErrors += Number(entry?.errorCount) || 0;
  }
  return {
    toolingDegradedProviders: degradedProviders.length,
    toolingDegradedWarnings,
    toolingDegradedErrors
  };
};

const summarizeToolingRuntimeCounts = (metrics) => ({
  toolingProvidersExecuted: Number(metrics?.providersExecuted) || 0,
  toolingProvidersContributed: Number(metrics?.providersContributed) || 0,
  toolingRequests: Number(metrics?.requests?.requests) || 0,
  toolingRequestFailures: Number(metrics?.requests?.failed) || 0,
  toolingRequestTimeouts: Number(metrics?.requests?.timedOut) || 0
});

export const runToolingPass = async ({
  rootDir,
  buildRoot,
  chunks,
  entryByUid,
  log,
  toolingConfig,
  toolingTimeoutMs,
  toolingRetries,
  toolingBreaker,
  toolingLogDir,
  fileTextByFile,
  abortSignal = null
}) => {
  if (!Array.isArray(chunks) || !chunks.length) return { ...EMPTY_TOOLING_PASS_STATS };
  registerDefaultToolingProviders();
  const strict = toolingConfig?.strict !== false;
  const vfsConfig = toolingConfig?.vfs && typeof toolingConfig.vfs === 'object'
    ? toolingConfig.vfs
    : {};
  const vfsStrict = typeof vfsConfig.strict === 'boolean' ? vfsConfig.strict : strict;
  const maxVirtualFileBytesRaw = Number(vfsConfig.maxVirtualFileBytes);
  const maxVirtualFileBytes = Number.isFinite(maxVirtualFileBytesRaw)
    ? Math.max(0, Math.floor(maxVirtualFileBytesRaw))
    : null;
  const hashRouting = vfsConfig.hashRouting === true;
  const coalesceSegments = vfsConfig.coalesceSegments === true;
  const logger = (evt) => {
    if (!evt) return;
    if (typeof evt === 'string') {
      log(evt);
      return;
    }
    if (evt?.message) log(evt.message);
  };
  const { documents, targets } = await buildToolingVirtualDocuments({
    chunks,
    fileTextByPath: fileTextByFile,
    strict: vfsStrict,
    maxVirtualFileBytes,
    hashRouting,
    coalesceSegments,
    log
  });
  if (!documents.length || !targets.length) return { ...EMPTY_TOOLING_PASS_STATS };

  const chunkByUid = new Map();
  for (const chunk of chunks) {
    if (chunk?.chunkUid) chunkByUid.set(chunk.chunkUid, chunk);
  }

  const cacheConfig = toolingConfig?.cache || {};
  const cacheDirRaw = cacheConfig.dir;
  const cacheDir = cacheDirRaw
    ? (isAbsolutePathNative(cacheDirRaw) ? cacheDirRaw : path.join(buildRoot || rootDir, cacheDirRaw))
    : resolveDefaultToolingCacheDir({ rootDir, buildRoot });

  const ctx = {
    repoRoot: rootDir,
    buildRoot: buildRoot || rootDir,
    mode: 'code',
    strict,
    logger,
    toolingConfig: {
      ...toolingConfig,
      timeoutMs: toolingTimeoutMs,
      maxRetries: toolingRetries,
      circuitBreakerThreshold: toolingBreaker,
      logDir: toolingLogDir
    },
    cache: {
      enabled: cacheConfig.enabled !== false,
      dir: cacheDir,
      maxBytes: Number.isFinite(cacheConfig.maxBytes) ? cacheConfig.maxBytes : null,
      maxEntries: Number.isFinite(cacheConfig.maxEntries) ? cacheConfig.maxEntries : null
    },
    abortSignal
  };
  const providerPlans = selectToolingProviders({
    toolingConfig: ctx.toolingConfig,
    documents,
    targets,
    kinds: ['types']
  });
  const providerIds = Array.from(new Set(
    providerPlans
      .map((plan) => String(plan?.provider?.id || '').trim())
      .filter(Boolean)
  ));
  if (!providerIds.length) {
    log('[tooling] providers: none selected for current documents/targets; skipping provider runtime.');
    return { ...EMPTY_TOOLING_PASS_STATS };
  }
  log(`[tooling] providers:selected count=${providerIds.length}.`);

  const providerLog = createToolingLogger(rootDir, toolingLogDir, 'tooling', log);
  let result;
  try {
    log(`[tooling] providers:start docs=${documents.length} targets=${targets.length}.`);
    const providerStartMs = Date.now();
    result = await runToolingProviders(ctx, { documents, targets, kinds: ['types'] }, providerIds);
    const providerElapsedMs = Math.max(0, Date.now() - providerStartMs);
    log(`[tooling] providers:done elapsedMs=${providerElapsedMs}.`);
    if (Array.isArray(result?.degradedProviders) && result.degradedProviders.length) {
      const summary = result.degradedProviders
        .map((entry) => `${entry.providerId}${entry.errorCount > 0 ? `:error=${entry.errorCount}` : ''}${entry.warningCount > 0 ? `:warn=${entry.warningCount}` : ''}`)
        .join(', ');
      log(`[tooling] degraded mode active for ${result.degradedProviders.length} provider(s): ${summary}`);
    }
    if (providerLog && result?.diagnostics) {
      for (const [providerId, diag] of Object.entries(result.diagnostics || {})) {
        if (!diag) continue;
        providerLog(`[tooling] ${providerId} diagnostics captured.`);
      }
    }
    if (providerLog && Array.isArray(result?.observations)) {
      for (const observation of result.observations) {
        if (!observation?.message) continue;
        providerLog(`[tooling] ${observation.message}`);
      }
    }
  } finally {
    await providerLog?.close?.();
  }
  const degradedStats = summarizeDegradedProviderCounts(result?.degradedProviders);
  const runtimeStats = summarizeToolingRuntimeCounts(result?.metrics);

  const applyResult = applyToolingTypes({
    byChunkUid: result.byChunkUid,
    chunkByUid,
    entryByUid
  });
  const diagnosticsByChunkUid = new Map();
  for (const diag of Object.values(result.diagnostics || {})) {
    const map = diag?.diagnosticsByChunkUid || null;
    if (!map || typeof map !== 'object') continue;
    for (const [chunkUid, list] of Object.entries(map)) {
      const existing = diagnosticsByChunkUid.get(chunkUid) || [];
      diagnosticsByChunkUid.set(chunkUid, [...existing, ...(Array.isArray(list) ? list : [])]);
    }
  }
  if (diagnosticsByChunkUid.size) {
    applyToolingDiagnostics({ diagnosticsByChunkUid, chunkByUid });
  }

  if (applyResult.enriched) {
    log(`[index] tooling enriched ${applyResult.enriched} symbol(s).`);
  }

  return {
    inferredReturns: applyResult.inferredReturns || 0,
    ...degradedStats,
    ...runtimeStats
  };
};
