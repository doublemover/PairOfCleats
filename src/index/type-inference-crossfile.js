import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { getToolingConfig } from '../../tools/dict-utils.js';
import { collectLspTypes } from '../integrations/tooling/providers/lsp.js';
import { collectClangdTypes, CLIKE_EXTS } from './tooling/clangd-provider.js';
import { collectSourcekitTypes, SWIFT_EXTS } from './tooling/sourcekit-provider.js';
import { collectTypeScriptTypes } from './tooling/typescript-provider.js';
import { mergeToolingMaps, uniqueTypes } from '../integrations/tooling/providers/shared.js';

const FLOW_SOURCE = 'flow';
const TOOLING_SOURCE = 'tooling';
const FLOW_CONFIDENCE = 0.55;
const TOOLING_CONFIDENCE = 0.85;

const TYPE_KIND_PATTERNS = [
  /class/i,
  /struct/i,
  /enum/i,
  /interface/i,
  /protocol/i,
  /trait/i,
  /record/i,
  /type/i
];

const RETURN_CALL_RX = /return\s+(?:await\s+)?(?!new\s)([A-Za-z_$][\w$.:]*)\s*\(/g;
const RETURN_NEW_RX = /return\s+(?:await\s+)?new\s+([A-Za-z_$][\w$.:]*)\s*\(/g;

const normalizeName = (value) => String(value || '').trim();

const leafName = (value) => {
  if (!value) return null;
  const parts = String(value).split(/::|\./).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : value;
};

const isTypeDeclaration = (kind) => {
  if (!kind) return false;
  return TYPE_KIND_PATTERNS.some((rx) => rx.test(kind));
};

const addSymbol = (index, key, entry) => {
  if (!key) return;
  const list = index.get(key) || [];
  list.push(entry);
  index.set(key, list);
};

const addLink = (list, link) => {
  if (!link) return;
  const key = `${link.name}:${link.target}:${link.file}`;
  if (list._keys?.has(key)) return;
  if (!list._keys) list._keys = new Set();
  list._keys.add(key);
  list.push(link);
};

const extractReturnTypes = (chunk) => {
  const docmeta = chunk?.docmeta || {};
  const types = [];
  if (docmeta.returnType) types.push(docmeta.returnType);
  if (Array.isArray(docmeta.returns)) {
    for (const value of docmeta.returns) {
      if (value) types.push(value);
    }
  } else if (docmeta.returns) {
    types.push(docmeta.returns);
  }
  if (Array.isArray(docmeta.inferredTypes?.returns)) {
    for (const entry of docmeta.inferredTypes.returns) {
      if (entry?.type) types.push(entry.type);
    }
  }
  if (isTypeDeclaration(chunk?.kind) && chunk?.name) {
    types.push(chunk.name);
  }
  return uniqueTypes(types);
};

const extractParamTypes = (chunk) => {
  const docmeta = chunk?.docmeta || {};
  const paramNames = Array.isArray(docmeta.params) ? docmeta.params : [];
  const paramTypes = {};

  if (docmeta.paramTypes && typeof docmeta.paramTypes === 'object') {
    for (const [name, type] of Object.entries(docmeta.paramTypes)) {
      if (!name || !type) continue;
      paramTypes[name] = uniqueTypes([...(paramTypes[name] || []), type]);
    }
  }

  const inferred = docmeta.inferredTypes?.params || {};
  if (inferred && typeof inferred === 'object') {
    for (const [name, entries] of Object.entries(inferred)) {
      if (!name || !Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry?.type) continue;
        paramTypes[name] = uniqueTypes([...(paramTypes[name] || []), entry.type]);
      }
    }
  }

  return { paramNames, paramTypes };
};

const resolveUniqueSymbol = (index, name) => {
  if (!name) return null;
  const direct = index.get(name) || [];
  if (direct.length === 1) return direct[0];
  if (direct.length > 1) return null;
  const leaf = leafName(name);
  if (!leaf || leaf === name) return null;
  const leafMatches = index.get(leaf) || [];
  return leafMatches.length === 1 ? leafMatches[0] : null;
};

const ensureInferred = (docmeta) => {
  if (!docmeta.inferredTypes || typeof docmeta.inferredTypes !== 'object') {
    docmeta.inferredTypes = {};
  }
  return docmeta.inferredTypes;
};

const addInferredReturn = (docmeta, type, source, confidence) => {
  if (!type) return false;
  const inferred = ensureInferred(docmeta);
  if (!Array.isArray(inferred.returns)) inferred.returns = [];
  const existing = inferred.returns.find((entry) => entry.type === type && entry.source === source);
  if (existing) {
    existing.confidence = Math.max(existing.confidence || 0, confidence);
    return true;
  }
  inferred.returns.push({ type, source, confidence });
  return true;
};

const addInferredParam = (docmeta, name, type, source, confidence, maxCandidates = null) => {
  if (!name || !type) return false;
  const inferred = ensureInferred(docmeta);
  if (!inferred.params || typeof inferred.params !== 'object') inferred.params = {};
  const list = inferred.params[name] || [];
  if (Number.isFinite(maxCandidates) && maxCandidates > 0) {
    const hasType = list.some((entry) => entry.type === type);
    if (!hasType && list.length >= maxCandidates) return false;
  }
  const existing = list.find((entry) => entry.type === type && entry.source === source);
  if (existing) {
    existing.confidence = Math.max(existing.confidence || 0, confidence);
    inferred.params[name] = list;
    return true;
  }
  inferred.params[name] = [...list, { type, source, confidence }];
  return true;
};

const extractReturnCalls = (chunkText) => {
  const calls = new Set();
  const news = new Set();
  if (!chunkText) return { calls, news };
  RETURN_CALL_RX.lastIndex = 0;
  RETURN_NEW_RX.lastIndex = 0;
  let match;
  while ((match = RETURN_CALL_RX.exec(chunkText)) !== null) {
    const name = match[1];
    if (name) calls.add(name);
  }
  while ((match = RETURN_NEW_RX.exec(chunkText)) !== null) {
    const name = match[1];
    if (name) news.add(name);
  }
  return { calls, news };
};

const inferArgType = (raw) => {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;
  const lowered = value.toLowerCase();
  if (lowered === 'null') return 'null';
  if (lowered === 'undefined') return 'undefined';
  if (lowered === 'true' || lowered === 'false') return 'boolean';
  if (/^-?\d+(\.\d+)?$/.test(value)) return 'number';
  if (value.startsWith('"') || value.startsWith("'") || value.startsWith('`')) return 'string';
  if (value.startsWith('[')) return 'array';
  if (value.startsWith('{')) return 'object';
  const newMatch = value.match(/^new\s+([A-Za-z_$][\w$.]*)/);
  if (newMatch) return newMatch[1];
  if (value === 'fn(...)') return 'function';
  return null;
};

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

const buildChunksByFile = (chunks) => {
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

export async function applyCrossFileInference({
  rootDir,
  chunks,
  enabled,
  log = () => {},
  useTooling = false,
  enableTypeInference = true,
  enableRiskCorrelation = false,
  fileRelations = null
}) {
  if (!enabled) {
    return { linkedCalls: 0, linkedUsages: 0, inferredReturns: 0, riskFlows: 0 };
  }
  const toolingConfig = useTooling ? getToolingConfig(rootDir) : null;
  const toolingTimeoutMs = Number.isFinite(Number(toolingConfig?.timeoutMs))
    ? Math.max(1000, Math.floor(Number(toolingConfig.timeoutMs)))
    : 15000;
  const toolingRetries = Number.isFinite(Number(toolingConfig?.maxRetries))
    ? Math.max(0, Math.floor(Number(toolingConfig.maxRetries)))
    : 2;
  const toolingBreaker = Number.isFinite(Number(toolingConfig?.circuitBreakerThreshold))
    ? Math.max(1, Math.floor(Number(toolingConfig.circuitBreakerThreshold)))
    : 3;
  const toolingLogDir = typeof toolingConfig?.logDir === 'string' && toolingConfig.logDir.trim()
    ? toolingConfig.logDir.trim()
    : null;
  const symbolIndex = new Map();
  const symbolEntries = [];
  const entryByKey = new Map();
  const chunkByKey = new Map();
  const riskSeverityRank = { low: 1, medium: 2, high: 3 };
  const callSampleLimit = 25;
  const paramTypeLimit = 5;
  const callSampleCounts = new Map();
  const confidenceForHop = (hops) => Math.max(0.2, FLOW_CONFIDENCE * (0.85 ** hops));

  for (const chunk of chunks) {
    if (!chunk?.name) continue;
    chunkByKey.set(`${chunk.file}::${chunk.name}`, chunk);
    const { paramNames, paramTypes } = extractParamTypes(chunk);
    const entry = {
      name: chunk.name,
      file: chunk.file,
      kind: chunk.kind || null,
      returnTypes: extractReturnTypes(chunk),
      typeDeclaration: isTypeDeclaration(chunk.kind),
      paramNames,
      paramTypes
    };
    symbolEntries.push(entry);
    entryByKey.set(`${chunk.file}::${chunk.name}`, entry);
    addSymbol(symbolIndex, chunk.name, entry);
    const leaf = leafName(chunk.name);
    if (leaf && leaf !== chunk.name) addSymbol(symbolIndex, leaf, entry);
  }

  const chunksByFile = buildChunksByFile(chunks);

  let linkedCalls = 0;
  let linkedUsages = 0;
  let inferredReturns = 0;
  let riskFlows = 0;

  const toolingEnabled = useTooling && enableTypeInference && toolingConfig?.autoEnableOnDetect !== false;
  if (toolingEnabled) {
    const toolingChunksByFile = filterChunksByPredicate(chunksByFile, (chunk) => !hasToolingReturn(chunk));
    const toolingTypes = new Map();
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

    if (toolingTypes.size) {
      const applyResult = applyToolingTypes(toolingTypes, chunkByKey, entryByKey, toolingSourcesByChunk, toolingProvenance);
      inferredReturns += applyResult.inferredReturns || 0;
      if (applyResult.enriched) {
        log(`[index] tooling enriched ${applyResult.enriched} symbol(s).`);
      }
    }
  }

  const textCache = new Map();
  const getChunkText = async (chunk) => {
    if (!chunk?.file) return '';
    const absPath = path.join(rootDir, chunk.file);
    if (!textCache.has(absPath)) {
      try {
        textCache.set(absPath, await fs.readFile(absPath, 'utf8'));
      } catch {
        textCache.set(absPath, '');
      }
    }
    const text = textCache.get(absPath) || '';
    return text.slice(chunk.start, chunk.end);
  };

  if (enableTypeInference) {
    for (const chunk of chunks) {
      if (!chunk) continue;
      if (chunk.docmeta && chunk.docmeta.returnsValue) {
        const chunkText = await getChunkText(chunk);
        const { news: returnNews } = extractReturnCalls(chunkText);
        for (const typeName of returnNews) {
          if (addInferredReturn(chunk.docmeta, typeName, FLOW_SOURCE, FLOW_CONFIDENCE)) {
            inferredReturns += 1;
          }
          const entry = entryByKey.get(`${chunk.file}::${chunk.name}`);
          if (entry) {
            entry.returnTypes = uniqueTypes([...(entry.returnTypes || []), typeName]);
          }
        }
      }
    }
  }

  const normalizeRisk = (chunk) => {
    if (!chunk) return null;
    if (!chunk.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
    const base = chunk.docmeta.risk && typeof chunk.docmeta.risk === 'object'
      ? chunk.docmeta.risk
      : {};
    const risk = {
      ...base,
      tags: Array.isArray(base.tags) ? base.tags.slice() : [],
      categories: Array.isArray(base.categories) ? base.categories.slice() : [],
      sources: Array.isArray(base.sources) ? base.sources.slice() : [],
      sinks: Array.isArray(base.sinks) ? base.sinks.slice() : [],
      flows: Array.isArray(base.flows) ? base.flows.slice() : []
    };
    chunk.docmeta.risk = risk;
    return risk;
  };

  const addUnique = (list, value) => {
    if (!value) return;
    if (!list.includes(value)) list.push(value);
  };

  const riskFlowKeys = new WeakMap();
  const flowKey = (flow) => `${flow.source}::${flow.sink}::${flow.scope || 'local'}::${flow.via || ''}`;
  const getFlowKeys = (chunk, risk) => {
    if (!chunk || !risk) return null;
    let keys = riskFlowKeys.get(chunk);
    if (!keys) {
      keys = new Set();
      if (Array.isArray(risk.flows)) {
        for (const existing of risk.flows) {
          if (!existing) continue;
          keys.add(flowKey(existing));
        }
      }
      riskFlowKeys.set(chunk, keys);
    }
    return keys;
  };
  const addRiskFlow = (chunk, risk, flow) => {
    if (!risk || !flow) return false;
    const keys = getFlowKeys(chunk, risk);
    if (!keys) return false;
    const key = flowKey(flow);
    if (keys.has(key)) return false;
    keys.add(key);
    risk.flows.push(flow);
    return true;
  };

  for (const chunk of chunks) {
    if (!chunk) continue;
    const relations = chunk.codeRelations || {};
    const fileRelation = fileRelations
      ? (typeof fileRelations.get === 'function'
        ? fileRelations.get(chunk.file)
        : fileRelations[chunk.file])
      : null;
    const callLinks = [];
    const callSummaries = [];
    const usageLinks = [];

    if (Array.isArray(relations.calls)) {
      for (const [, callee] of relations.calls) {
        const resolved = resolveUniqueSymbol(symbolIndex, callee);
        if (!resolved) continue;
        if (resolved.file === chunk.file && resolved.name === chunk.name) continue;
        const link = {
          name: callee,
          target: resolved.name,
          file: resolved.file,
          kind: resolved.kind
        };
        if (resolved.returnTypes?.length) link.returnTypes = resolved.returnTypes;
        if (resolved.paramNames?.length) link.paramNames = resolved.paramNames;
        if (resolved.paramTypes && Object.keys(resolved.paramTypes).length) link.paramTypes = resolved.paramTypes;
        addLink(callLinks, link);
      }
    }

    if (Array.isArray(relations.callDetails)) {
      for (const detail of relations.callDetails) {
        const callee = detail?.callee;
        if (!callee) continue;
        const resolved = resolveUniqueSymbol(symbolIndex, callee);
        if (!resolved) continue;
        if (resolved.file === chunk.file && resolved.name === chunk.name) continue;
        const args = Array.isArray(detail.args) ? detail.args : [];
        const summary = {
          name: callee,
          target: resolved.name,
          file: resolved.file,
          kind: resolved.kind,
          args
        };
        if (resolved.returnTypes?.length) summary.returnTypes = resolved.returnTypes;
        if (resolved.paramNames?.length) summary.params = resolved.paramNames;
        if (resolved.paramTypes && Object.keys(resolved.paramTypes).length) summary.paramTypes = resolved.paramTypes;
        if (args.length && resolved.paramNames?.length) {
          const argMap = {};
          for (let i = 0; i < resolved.paramNames.length && i < args.length; i += 1) {
            const paramName = resolved.paramNames[i];
            const argValue = args[i];
            if (paramName && argValue) argMap[paramName] = argValue;
          }
          if (Object.keys(argMap).length) summary.argMap = argMap;
        }
        addLink(callSummaries, summary);
      }
    }

    const usageSource = Array.isArray(relations.usages)
      ? relations.usages
      : (Array.isArray(fileRelation?.usages) ? fileRelation.usages : null);
    if (Array.isArray(usageSource)) {
      for (const usage of usageSource) {
        const resolved = resolveUniqueSymbol(symbolIndex, usage);
        if (!resolved) continue;
        if (resolved.file === chunk.file && resolved.name === chunk.name) continue;
        addLink(usageLinks, {
          name: usage,
          target: resolved.name,
          file: resolved.file,
          kind: resolved.kind
        });
      }
    }

    if (callLinks.length) {
      relations.callLinks = callLinks;
      linkedCalls += callLinks.length;
    }
    if (callSummaries.length) {
      relations.callSummaries = callSummaries;
    }
    if (usageLinks.length) {
      relations.usageLinks = usageLinks;
      linkedUsages += usageLinks.length;
    }
    chunk.codeRelations = relations;

    if (enableTypeInference && callSummaries.length) {
      for (const summary of callSummaries) {
        const calleeKey = `${summary.file}::${summary.target}`;
        const calleeChunk = chunkByKey.get(calleeKey);
        if (!calleeChunk) continue;
        const currentSamples = callSampleCounts.get(calleeKey) || 0;
        if (currentSamples >= callSampleLimit) continue;
        callSampleCounts.set(calleeKey, currentSamples + 1);
        const args = Array.isArray(summary.args) ? summary.args : [];
        const paramNames = Array.isArray(summary.params)
          ? summary.params
          : (Array.isArray(calleeChunk.docmeta?.params) ? calleeChunk.docmeta.params : []);
        const argMap = summary.argMap || {};
        if (!paramNames.length && !args.length && !Object.keys(argMap).length) continue;
        if (!calleeChunk.docmeta || typeof calleeChunk.docmeta !== 'object') calleeChunk.docmeta = {};
        const hopCount = summary.file !== chunk.file ? 1 : 0;
        const confidence = confidenceForHop(hopCount);
        for (let i = 0; i < paramNames.length && i < Math.max(args.length, paramNames.length); i += 1) {
          const name = paramNames[i];
          const argValue = argMap[name] || args[i];
          if (!name || !argValue) continue;
          const type = inferArgType(argValue);
          if (!type) continue;
          if (addInferredParam(calleeChunk.docmeta, name, type, FLOW_SOURCE, confidence, paramTypeLimit)) {
            const entry = entryByKey.get(calleeKey);
            if (entry) {
              const existing = entry.paramTypes?.[name] || [];
              entry.paramTypes = entry.paramTypes || {};
              entry.paramTypes[name] = uniqueTypes([...(existing || []), type]);
            }
          }
        }
      }
    }

    if (enableTypeInference && chunk.docmeta && chunk.docmeta.returnsValue) {
      const chunkText = await getChunkText(chunk);
      const { calls: returnCalls } = extractReturnCalls(chunkText);
      for (const callName of returnCalls) {
        const resolved = resolveUniqueSymbol(symbolIndex, callName);
        if (!resolved || !resolved.returnTypes?.length) continue;
        const hopCount = resolved.file !== chunk.file ? 1 : 0;
        const confidence = confidenceForHop(hopCount);
        for (const type of resolved.returnTypes) {
          if (addInferredReturn(chunk.docmeta, type, FLOW_SOURCE, confidence)) {
            inferredReturns += 1;
          }
        }
      }
    }

    if (enableRiskCorrelation && callLinks.length) {
      const callerRisk = chunk.docmeta?.risk;
      const callerSources = Array.isArray(callerRisk?.sources) ? callerRisk.sources : [];
      if (callerSources.length) {
        for (const link of callLinks) {
          const calleeChunk = chunkByKey.get(`${link.file}::${link.target}`);
          const calleeRisk = calleeChunk?.docmeta?.risk;
          const calleeSinks = Array.isArray(calleeRisk?.sinks) ? calleeRisk.sinks : [];
          if (!calleeSinks.length) continue;
          const risk = normalizeRisk(chunk);
          for (const sink of calleeSinks) {
            if (sink.category) addUnique(risk.categories, sink.category);
            const sinkTags = Array.isArray(sink.tags) && sink.tags.length
              ? sink.tags
              : (Array.isArray(calleeRisk?.tags) ? calleeRisk.tags : []);
            sinkTags.forEach((tag) => addUnique(risk.tags, tag));
            if (sink.severity) {
              const currentRank = riskSeverityRank[risk.severity] || 0;
              const sinkRank = riskSeverityRank[sink.severity] || 0;
              if (sinkRank > currentRank) risk.severity = sink.severity;
            }
          }
          for (const source of callerSources) {
            for (const sink of calleeSinks) {
              const scope = link.file === chunk.file ? 'file' : 'cross-file';
              const flow = {
                source: source.name,
                sink: sink.name,
                category: sink.category || null,
                severity: sink.severity || null,
                scope,
                via: `${chunk.name}->${link.target}`,
                confidence: Math.max(0.2, (source.confidence || 0.5) * 0.85),
                ruleIds: [source.ruleId, sink.ruleId].filter(Boolean)
              };
              if (addRiskFlow(chunk, risk, flow)) riskFlows += 1;
            }
          }
        }
      }
    }
  }

  return { linkedCalls, linkedUsages, inferredReturns, riskFlows };
}
