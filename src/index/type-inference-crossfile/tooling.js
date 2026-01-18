import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { collectClangdTypes, CLIKE_EXTS } from '../tooling/clangd-provider.js';
import { collectPyrightTypes, PYTHON_EXTS } from '../tooling/pyright-provider.js';
import { collectSourcekitTypes, SWIFT_EXTS } from '../tooling/sourcekit-provider.js';
import { collectTypeScriptTypes } from '../tooling/typescript-provider.js';
import { mergeToolingMaps, uniqueTypes } from '../../integrations/tooling/providers/shared.js';
import { TOOLING_CONFIDENCE, TOOLING_SOURCE } from './constants.js';
import { addInferredParam, addInferredReturn, mergeDiagnostics } from './apply.js';

const resolveCompileCommandsDir = (rootDir, clangdConfig) => {
  const candidates = [];
  if (clangdConfig?.compileCommandsDir) {
    const value = clangdConfig.compileCommandsDir;
    candidates.push(path.isAbsolute(value) ? value : path.join(rootDir, value));
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

const createToolingLogger = (rootDir, logDir, provider, baseLog) => {
  if (!logDir || !provider) return baseLog;
  const absDir = path.isAbsolute(logDir) ? logDir : path.join(rootDir, logDir);
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

export const buildChunksByFile = (chunks) => {
  const byFile = new Map();
  for (const chunk of chunks || []) {
    if (!chunk?.file) continue;
    const list = byFile.get(chunk.file) || [];
    list.push(chunk);
    byFile.set(chunk.file, list);
  }
  return byFile;
};

const filterChunksByExt = (chunksByFile, extensions) => {
  const extSet = new Set(extensions.map((ext) => ext.toLowerCase()));
  const filtered = new Map();
  for (const [file, chunks] of chunksByFile.entries()) {
    const ext = path.extname(file).toLowerCase();
    if (!extSet.has(ext)) continue;
    filtered.set(file, chunks);
  }
  return filtered;
};

const filterChunksByPredicate = (chunksByFile, predicate) => {
  const filtered = new Map();
  for (const [file, chunks] of chunksByFile.entries()) {
    const kept = chunks.filter((chunk) => predicate(chunk));
    if (kept.length) filtered.set(file, kept);
  }
  return filtered;
};

const hasToolingReturn = (chunk) => {
  const inferred = chunk?.docmeta?.inferredTypes?.returns;
  if (!Array.isArray(inferred)) return false;
  return inferred.some((entry) => entry?.source === TOOLING_SOURCE);
};

const applyToolingTypes = (typesByChunk, chunkByKey, entryByKey, toolingSources = null, toolingProvenance = null) => {
  let inferredReturns = 0;
  let enriched = 0;
  for (const [key, info] of typesByChunk.entries()) {
    const chunk = chunkByKey.get(key);
    if (!chunk || !info) continue;
    if (!chunk.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
    if (toolingSources && toolingProvenance && toolingSources.has(key)) {
      const providers = Array.from(toolingSources.get(key) || []);
      if (providers.length) {
        const toolingMeta = chunk.docmeta.tooling && typeof chunk.docmeta.tooling === 'object'
          ? chunk.docmeta.tooling
          : {};
        const existing = Array.isArray(toolingMeta.sources) ? toolingMeta.sources : [];
        const next = [];
        const seen = new Set();
        for (const entry of [...existing, ...providers.map((name) => toolingProvenance[name]).filter(Boolean)]) {
          if (!entry?.provider) continue;
          if (seen.has(entry.provider)) continue;
          seen.add(entry.provider);
          next.push(entry);
        }
        toolingMeta.sources = next;
        chunk.docmeta.tooling = toolingMeta;
      }
    }
    const entry = entryByKey.get(key);
    let touched = false;
    if (info.signature && !chunk.docmeta.signature) {
      chunk.docmeta.signature = info.signature;
      touched = true;
    }
    if (info.paramNames?.length && (!Array.isArray(chunk.docmeta.params) || !chunk.docmeta.params.length)) {
      chunk.docmeta.params = info.paramNames.slice();
      touched = true;
    }
    if (entry && info.paramNames?.length && (!Array.isArray(entry.paramNames) || !entry.paramNames.length)) {
      entry.paramNames = info.paramNames.slice();
    }
    if (Array.isArray(info.returns) && info.returns.length) {
      for (const type of uniqueTypes(info.returns)) {
        if (!type) continue;
        if (!chunk.docmeta.returnType) chunk.docmeta.returnType = type;
        if (addInferredReturn(chunk.docmeta, type, TOOLING_SOURCE, TOOLING_CONFIDENCE)) {
          inferredReturns += 1;
          touched = true;
        }
        if (entry) {
          entry.returnTypes = uniqueTypes([...(entry.returnTypes || []), type]);
        }
      }
    }
    if (info.params && typeof info.params === 'object') {
      if (!chunk.docmeta.paramTypes || typeof chunk.docmeta.paramTypes !== 'object') {
        chunk.docmeta.paramTypes = {};
      }
      for (const [name, types] of Object.entries(info.params)) {
        if (!name || !Array.isArray(types)) continue;
        for (const type of uniqueTypes(types)) {
          if (!type) continue;
          if (!chunk.docmeta.paramTypes[name]) chunk.docmeta.paramTypes[name] = type;
          addInferredParam(chunk.docmeta, name, type, TOOLING_SOURCE, TOOLING_CONFIDENCE);
          if (entry) {
            const existing = entry.paramTypes?.[name] || [];
            entry.paramTypes = entry.paramTypes || {};
            entry.paramTypes[name] = uniqueTypes([...(existing || []), type]);
          }
          touched = true;
        }
      }
    }
    if (touched) enriched += 1;
  }
  return { inferredReturns, enriched };
};

const applyToolingDiagnostics = (diagnosticsByChunk, chunkByKey, toolingSources = null, toolingProvenance = null) => {
  let enriched = 0;
  for (const [key, diagnostics] of diagnosticsByChunk.entries()) {
    if (!Array.isArray(diagnostics) || !diagnostics.length) continue;
    const chunk = chunkByKey.get(key);
    if (!chunk) continue;
    if (!chunk.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
    if (toolingSources && toolingProvenance && toolingSources.has(key)) {
      const providers = Array.from(toolingSources.get(key) || []);
      if (providers.length) {
        const toolingMeta = chunk.docmeta.tooling && typeof chunk.docmeta.tooling === 'object'
          ? chunk.docmeta.tooling
          : {};
        const existing = Array.isArray(toolingMeta.sources) ? toolingMeta.sources : [];
        const next = [];
        const seen = new Set();
        for (const entry of [...existing, ...providers.map((name) => toolingProvenance[name]).filter(Boolean)]) {
          if (!entry?.provider) continue;
          if (seen.has(entry.provider)) continue;
          seen.add(entry.provider);
          next.push(entry);
        }
        toolingMeta.sources = next;
        chunk.docmeta.tooling = toolingMeta;
      }
    }
    const toolingMeta = chunk.docmeta.tooling && typeof chunk.docmeta.tooling === 'object'
      ? chunk.docmeta.tooling
      : {};
    const existing = Array.isArray(toolingMeta.diagnostics) ? toolingMeta.diagnostics : [];
    const merged = [];
    const seen = new Set();
    for (const entry of [...existing, ...diagnostics]) {
      if (!entry?.message) continue;
      const range = entry.range || {};
      const start = range.start || {};
      const keyId = `${entry.message}:${entry.code ?? ''}:${start.line ?? ''}:${start.column ?? ''}`;
      if (seen.has(keyId)) continue;
      seen.add(keyId);
      merged.push(entry);
    }
    toolingMeta.diagnostics = merged;
    chunk.docmeta.tooling = toolingMeta;
    enriched += 1;
  }
  return { enriched };
};

export const runToolingPass = async ({
  rootDir,
  chunksByFile,
  chunkByKey,
  entryByKey,
  log,
  toolingConfig,
  toolingTimeoutMs,
  toolingRetries,
  toolingBreaker,
  toolingLogDir
}) => {
  const toolingChunksByFile = filterChunksByPredicate(chunksByFile, (chunk) => !hasToolingReturn(chunk));
  const toolingTypes = new Map();
  const toolingDiagnostics = new Map();
  const toolingSourcesByChunk = new Map();
  const toolingProvenance = {};
  const markToolingSources = (typesByChunk, provider, details) => {
    if (!typesByChunk || !typesByChunk.size) return;
    toolingProvenance[provider] = details;
    for (const key of typesByChunk.keys()) {
      const existing = toolingSourcesByChunk.get(key) || new Set();
      existing.add(provider);
      toolingSourcesByChunk.set(key, existing);
    }
  };

  if (toolingChunksByFile.size) {
    const tsLog = createToolingLogger(rootDir, toolingLogDir, 'typescript', log);
    const tsResult = await collectTypeScriptTypes({
      rootDir,
      chunksByFile: toolingChunksByFile,
      log: tsLog,
      toolingConfig
    });
    mergeToolingMaps(toolingTypes, tsResult.typesByChunk);
    markToolingSources(tsResult.typesByChunk, 'typescript', {
      provider: 'typescript',
      cmd: 'typescript',
      args: [],
      workspaceRoot: rootDir
    });
  }

  const clangdFiles = filterChunksByExt(toolingChunksByFile, CLIKE_EXTS);
  if (clangdFiles.size) {
    const clangdConfig = toolingConfig?.clangd || {};
    const compileCommandsDir = resolveCompileCommandsDir(rootDir, clangdConfig);
    const requireCompilationDatabase = clangdConfig.requireCompilationDatabase === true;
    if (!compileCommandsDir && requireCompilationDatabase) {
      log('[index] clangd requires compile_commands.json; skipping tooling-based types.');
    } else {
      const clangdArgs = [];
      if (compileCommandsDir) clangdArgs.push(`--compile-commands-dir=${compileCommandsDir}`);
      if (!compileCommandsDir) {
        log('[index] clangd running in best-effort mode (compile_commands.json not found).');
      }
      const clangdLog = createToolingLogger(rootDir, toolingLogDir, 'clangd', log);
      const clangdResult = await collectClangdTypes({
        rootDir,
        chunksByFile: clangdFiles,
        log: clangdLog,
        cmd: 'clangd',
        args: clangdArgs,
        timeoutMs: toolingTimeoutMs,
        retries: toolingRetries,
        breakerThreshold: toolingBreaker
      });
      mergeToolingMaps(toolingTypes, clangdResult.typesByChunk);
      markToolingSources(clangdResult.typesByChunk, 'clangd', {
        provider: 'clangd',
        cmd: 'clangd',
        args: clangdArgs,
        workspaceRoot: rootDir
      });
      if (clangdResult.enriched) log(`[index] clangd enriched ${clangdResult.enriched} symbol(s).`);
    }
  }

  const swiftFiles = filterChunksByExt(toolingChunksByFile, SWIFT_EXTS);
  if (swiftFiles.size) {
    const sourcekitLog = createToolingLogger(rootDir, toolingLogDir, 'sourcekit-lsp', log);
    const swiftResult = await collectSourcekitTypes({
      rootDir,
      chunksByFile: swiftFiles,
      log: sourcekitLog,
      cmd: 'sourcekit-lsp',
      args: [],
      timeoutMs: toolingTimeoutMs,
      retries: toolingRetries,
      breakerThreshold: toolingBreaker
    });
    mergeToolingMaps(toolingTypes, swiftResult.typesByChunk);
    markToolingSources(swiftResult.typesByChunk, 'sourcekit-lsp', {
      provider: 'sourcekit-lsp',
      cmd: 'sourcekit-lsp',
      args: [],
      workspaceRoot: rootDir
    });
    if (swiftResult.enriched) log(`[index] sourcekit-lsp enriched ${swiftResult.enriched} symbol(s).`);
  }

  const pyrightFiles = filterChunksByExt(toolingChunksByFile, PYTHON_EXTS);
  if (pyrightFiles.size) {
    const pyrightLog = createToolingLogger(rootDir, toolingLogDir, 'pyright', log);
    const pyrightResult = await collectPyrightTypes({
      rootDir,
      chunksByFile: pyrightFiles,
      log: pyrightLog,
      timeoutMs: toolingTimeoutMs,
      retries: toolingRetries,
      breakerThreshold: toolingBreaker,
      toolingConfig
    });
    mergeToolingMaps(toolingTypes, pyrightResult.typesByChunk);
    mergeDiagnostics(toolingDiagnostics, pyrightResult.diagnosticsByChunk);
    markToolingSources(pyrightResult.typesByChunk, 'pyright', {
      provider: 'pyright',
      cmd: pyrightResult.cmd || 'pyright-langserver',
      args: pyrightResult.args || [],
      workspaceRoot: rootDir
    });
    markToolingSources(pyrightResult.diagnosticsByChunk, 'pyright', {
      provider: 'pyright',
      cmd: pyrightResult.cmd || 'pyright-langserver',
      args: pyrightResult.args || [],
      workspaceRoot: rootDir
    });
    if (pyrightResult.enriched) log(`[index] pyright enriched ${pyrightResult.enriched} symbol(s).`);
    if (pyrightResult.diagnosticsCount) {
      log(`[index] pyright captured ${pyrightResult.diagnosticsCount} diagnostic(s).`);
    }
  }

  let inferredReturns = 0;
  if (toolingTypes.size) {
    const applyResult = applyToolingTypes(toolingTypes, chunkByKey, entryByKey, toolingSourcesByChunk, toolingProvenance);
    inferredReturns += applyResult.inferredReturns || 0;
    if (applyResult.enriched) {
      log(`[index] tooling enriched ${applyResult.enriched} symbol(s).`);
    }
  }
  if (toolingDiagnostics.size) {
    const diagResult = applyToolingDiagnostics(toolingDiagnostics, chunkByKey, toolingSourcesByChunk, toolingProvenance);
    if (diagResult.enriched) {
      log(`[index] tooling diagnostics attached to ${diagResult.enriched} chunk(s).`);
    }
  }
  return { inferredReturns };
};
