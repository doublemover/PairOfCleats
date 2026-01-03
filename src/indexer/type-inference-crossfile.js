import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { getToolingConfig } from '../../tools/dict-utils.js';
import { collectLspTypes } from '../tooling/providers/lsp.js';
import { collectClangdTypes, CLIKE_EXTS } from './tooling/clangd-provider.js';
import { collectSourcekitTypes, SWIFT_EXTS } from './tooling/sourcekit-provider.js';
import { collectTypeScriptTypes } from './tooling/typescript-provider.js';
import { mergeToolingMaps, uniqueTypes } from '../tooling/providers/shared.js';

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

const addInferredParam = (docmeta, name, type, source, confidence) => {
  if (!name || !type) return false;
  const inferred = ensureInferred(docmeta);
  if (!inferred.params || typeof inferred.params !== 'object') inferred.params = {};
  const list = inferred.params[name] || [];
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

const applyToolingTypes = (typesByChunk, chunkByKey, entryByKey) => {
  let inferredReturns = 0;
  let enriched = 0;
  for (const [key, info] of typesByChunk.entries()) {
    const chunk = chunkByKey.get(key);
    if (!chunk || !info) continue;
    if (!chunk.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
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
  const symbolIndex = new Map();
  const symbolEntries = [];
  const entryByKey = new Map();
  const chunkByKey = new Map();
  const riskSeverityRank = { low: 1, medium: 2, high: 3 };

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

    if (toolingChunksByFile.size) {
      const tsResult = await collectTypeScriptTypes({
        rootDir,
        chunksByFile: toolingChunksByFile,
        log,
        toolingConfig
      });
      mergeToolingMaps(toolingTypes, tsResult.typesByChunk);
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
        const clangdResult = await collectClangdTypes({
          rootDir,
          chunksByFile: clangdFiles,
          log,
          cmd: 'clangd',
          args: clangdArgs
        });
        mergeToolingMaps(toolingTypes, clangdResult.typesByChunk);
        if (clangdResult.enriched) log(`[index] clangd enriched ${clangdResult.enriched} symbol(s).`);
      }
    }

    const swiftFiles = filterChunksByExt(toolingChunksByFile, SWIFT_EXTS);
    if (swiftFiles.size) {
      const swiftResult = await collectSourcekitTypes({
        rootDir,
        chunksByFile: swiftFiles,
        log,
        cmd: 'sourcekit-lsp',
        args: []
      });
      mergeToolingMaps(toolingTypes, swiftResult.typesByChunk);
      if (swiftResult.enriched) log(`[index] sourcekit-lsp enriched ${swiftResult.enriched} symbol(s).`);
    }

    if (toolingTypes.size) {
      const applyResult = applyToolingTypes(toolingTypes, chunkByKey, entryByKey);
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

    if (enableTypeInference && chunk.docmeta && chunk.docmeta.returnsValue) {
      const chunkText = await getChunkText(chunk);
      const { calls: returnCalls } = extractReturnCalls(chunkText);
      for (const callName of returnCalls) {
        const resolved = resolveUniqueSymbol(symbolIndex, callName);
        if (!resolved || !resolved.returnTypes?.length) continue;
        for (const type of resolved.returnTypes) {
          if (addInferredReturn(chunk.docmeta, type, FLOW_SOURCE, FLOW_CONFIDENCE)) {
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
              const flow = {
                source: source.name,
                sink: sink.name,
                category: sink.category || null,
                severity: sink.severity || null,
                scope: 'cross-file',
                via: `${chunk.name}->${link.target}`
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
