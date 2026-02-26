import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { uniqueTypes } from '../../integrations/tooling/providers/shared.js';
import { buildToolingVirtualDocuments } from '../tooling/vfs.js';
import { runToolingProviders } from '../tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../tooling/providers/index.js';
import { runToolingDoctor } from '../tooling/doctor.js';
import { TOOLING_CONFIDENCE, TOOLING_SOURCE } from './constants.js';
import { addInferredParam, addInferredReturn } from './apply.js';
import { ensureParamTypeMap, getParamTypeList } from './extract.js';
import { isAbsolutePathNative } from '../../shared/files.js';
import { stableStringify } from '../../shared/stable-json.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { createQueuedAppendWriter } from '../../shared/io/append-writer.js';

const TOOLING_DOCTOR_CACHE_VERSION = 1;
const TOOLING_DOCTOR_CACHE_FILE = '.tooling-doctor-cache.json';

const buildToolingDoctorCacheKey = ({ rootDir, buildRoot, strict, toolingConfig, toolingTimeoutMs, toolingRetries, toolingBreaker }) => {
  const payload = {
    version: TOOLING_DOCTOR_CACHE_VERSION,
    rootDir,
    buildRoot,
    strict,
    toolingTimeoutMs,
    toolingRetries,
    toolingBreaker,
    toolingConfig,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      path: process.env.PATH || process.env.Path || ''
    }
  };
  return stableStringify(payload);
};

const readToolingDoctorCache = async (cachePath) => {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== TOOLING_DOCTOR_CACHE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeToolingDoctorCache = async ({ cachePath, key, reportPath }) => {
  const payload = {
    version: TOOLING_DOCTOR_CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    key,
    reportPath
  };
  try {
    await atomicWriteJson(cachePath, payload, {
      spaces: 0,
      newline: false
    });
  } catch {}
};

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
  if (!Array.isArray(chunks) || !chunks.length) return { inferredReturns: 0 };
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
  if (!documents.length || !targets.length) return { inferredReturns: 0 };

  const chunkByUid = new Map();
  for (const chunk of chunks) {
    if (chunk?.chunkUid) chunkByUid.set(chunk.chunkUid, chunk);
  }

  const cacheConfig = toolingConfig?.cache || {};
  const cacheDirRaw = cacheConfig.dir;
  const cacheDir = cacheDirRaw
    ? (isAbsolutePathNative(cacheDirRaw) ? cacheDirRaw : path.join(buildRoot || rootDir, cacheDirRaw))
    : path.join(buildRoot || rootDir, 'tooling-cache');

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

  const doctorCacheEnabled = toolingConfig?.doctorCache !== false;
  const doctorCachePath = path.join(buildRoot || rootDir, TOOLING_DOCTOR_CACHE_FILE);
  const doctorReportPath = path.join(buildRoot || rootDir, 'tooling_report.json');
  const doctorCacheKey = buildToolingDoctorCacheKey({
    rootDir,
    buildRoot: buildRoot || rootDir,
    strict,
    toolingConfig: ctx.toolingConfig,
    toolingTimeoutMs,
    toolingRetries,
    toolingBreaker
  });
  let doctorCacheHit = false;
  if (doctorCacheEnabled) {
    const cached = await readToolingDoctorCache(doctorCachePath);
    if (cached?.key === doctorCacheKey && fsSync.existsSync(doctorReportPath)) {
      doctorCacheHit = true;
      log('[tooling] doctor: using cached report.');
    }
  }
  if (!doctorCacheHit) {
    await runToolingDoctor(ctx, null, { log });
    if (doctorCacheEnabled) {
      await writeToolingDoctorCache({
        cachePath: doctorCachePath,
        key: doctorCacheKey,
        reportPath: doctorReportPath
      });
    }
  }

  const providerLog = createToolingLogger(rootDir, toolingLogDir, 'tooling', log);
  const result = await runToolingProviders(ctx, { documents, targets, kinds: ['types'] });
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
  await providerLog?.close?.();

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

  return { inferredReturns: applyResult.inferredReturns || 0 };
};
