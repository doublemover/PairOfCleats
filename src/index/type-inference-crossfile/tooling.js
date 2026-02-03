import fs from 'node:fs/promises';
import path from 'node:path';
import { buildToolingVirtualDocuments } from '../tooling/vfs.js';
import { runToolingProviders } from '../tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../tooling/providers/index.js';
import { runToolingDoctor } from '../tooling/doctor.js';
import { TOOLING_CONFIDENCE, TOOLING_SOURCE } from './constants.js';
import { addInferredParam, addInferredReturn } from './apply.js';
import { isAbsolutePathNative } from '../../shared/files.js';

const createToolingLogger = (rootDir, logDir, provider, baseLog) => {
  if (!logDir || !provider) return baseLog;
  const absDir = isAbsolutePathNative(logDir) ? logDir : path.join(rootDir, logDir);
  const logFile = path.join(absDir, `${provider}.log`);
  let ensured = false;
  const ensureDir = async () => {
    if (ensured) return;
    ensured = true;
    try {
      await fs.mkdir(absDir, { recursive: true });
    } catch {}
  };
  return (message) => {
    baseLog(message);
    void (async () => {
      await ensureDir();
      try {
        await fs.appendFile(logFile, `[${new Date().toISOString()}] ${message}\n`);
      } catch {}
    })();
  };
};

const mergeToolingSources = (chunk, provenanceList) => {
  if (!chunk?.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
  const toolingMeta = chunk.docmeta.tooling && typeof chunk.docmeta.tooling === 'object'
    ? chunk.docmeta.tooling
    : {};
  const existing = Array.isArray(toolingMeta.sources) ? toolingMeta.sources : [];
  const next = [];
  const seen = new Set();
  for (const entry of [...existing, ...(provenanceList || [])]) {
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
      if (!chunk.docmeta.paramTypes || typeof chunk.docmeta.paramTypes !== 'object') {
        chunk.docmeta.paramTypes = {};
      }
      for (const [name, entries] of Object.entries(payload.paramTypes)) {
        if (!name || !Array.isArray(entries)) continue;
        for (const entry of entries) {
          const type = entry?.type || null;
          if (!type) continue;
          if (!chunk.docmeta.paramTypes[name]) chunk.docmeta.paramTypes[name] = type;
          addInferredParam(
            chunk.docmeta,
            name,
            type,
            entry?.source || TOOLING_SOURCE,
            Number.isFinite(entry?.confidence) ? entry.confidence : TOOLING_CONFIDENCE
          );
          const symbolEntry = entryByUid?.get(chunkUid) || null;
          if (symbolEntry) {
            const existing = symbolEntry.paramTypes?.[name] || [];
            symbolEntry.paramTypes = symbolEntry.paramTypes || {};
            symbolEntry.paramTypes[name] = Array.from(new Set([...(existing || []), type]));
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
  fileTextByFile
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
    log
  });
  if (!documents.length || !targets.length) return { inferredReturns: 0 };

  const chunkByUid = new Map();
  for (const chunk of chunks) {
    if (chunk?.chunkUid) chunkByUid.set(chunk.chunkUid, chunk);
  }

  const cacheDirRaw = toolingConfig?.cache?.dir;
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
      enabled: toolingConfig?.cache?.enabled !== false,
      dir: cacheDir
    }
  };

  await runToolingDoctor(ctx, null, { log });

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
