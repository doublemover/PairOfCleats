import path from 'node:path';
import { getToolingConfig } from '../../../tools/dict-utils.js';
import { uniqueTypes } from '../../integrations/tooling/providers/shared.js';
import { readTextFile } from '../../shared/encoding.js';
import { FLOW_CONFIDENCE, FLOW_SOURCE } from './constants.js';
import { addInferredParam, addInferredReturn } from './apply.js';
import { extractParamTypes, extractReturnCalls, extractReturnTypes, inferArgType } from './extract.js';
import { addSymbol, leafName, isTypeDeclaration, resolveUniqueSymbol } from './symbols.js';
import { runToolingPass } from './tooling.js';

const addLink = (list, link) => {
  if (!link) return;
  const key = `${link.name}:${link.target}:${link.file}`;
  if (list._keys?.has(key)) return;
  if (!list._keys) list._keys = new Set();
  list._keys.add(key);
  list.push(link);
};

export async function applyCrossFileInference({
  rootDir,
  buildRoot,
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
  const entryByUid = new Map();
  const chunkByKey = new Map();
  const chunkByUid = new Map();
  const riskSeverityRank = { low: 1, medium: 2, high: 3 };
  const callSampleLimit = 25;
  const paramTypeLimit = 5;
  const callSampleCounts = new Map();
  const confidenceForHop = (hops) => Math.max(0.2, FLOW_CONFIDENCE * (0.85 ** hops));
  const resolveChunkByKey = (key) => {
    const list = chunkByKey.get(key);
    if (!list || list.length !== 1) return null;
    return list[0];
  };
  const formatCandidate = (entry) => {
    if (!entry) return null;
    if (entry.chunkUid) return entry.chunkUid;
    if (entry.file && entry.name) return `${entry.file}::${entry.name}`;
    return null;
  };
  const resolveSymbolCandidates = (name) => {
    if (!name) return { resolved: null, candidates: [] };
    const direct = symbolIndex.get(name) || [];
    if (direct.length === 1) return { resolved: direct[0], candidates: direct };
    if (direct.length > 1) return { resolved: null, candidates: direct };
    const leaf = leafName(name);
    if (!leaf || leaf === name) return { resolved: null, candidates: [] };
    const leafMatches = symbolIndex.get(leaf) || [];
    if (leafMatches.length === 1) return { resolved: leafMatches[0], candidates: leafMatches };
    if (leafMatches.length) return { resolved: null, candidates: leafMatches };
    return { resolved: null, candidates: [] };
  };

  for (const chunk of chunks) {
    if (!chunk?.name) continue;
    const legacyKey = `${chunk.file}::${chunk.name}`;
    const legacyList = chunkByKey.get(legacyKey) || [];
    legacyList.push(chunk);
    chunkByKey.set(legacyKey, legacyList);
    const chunkUid = chunk.chunkUid || chunk.metaV2?.chunkUid || null;
    if (chunkUid) chunkByUid.set(chunkUid, chunk);
    const { paramNames, paramTypes } = extractParamTypes(chunk);
    const entry = {
      name: chunk.name,
      file: chunk.file,
      kind: chunk.kind || null,
      chunkUid,
      returnTypes: extractReturnTypes(chunk),
      typeDeclaration: isTypeDeclaration(chunk.kind),
      paramNames,
      paramTypes
    };
    symbolEntries.push(entry);
    entryByKey.set(`${chunk.file}::${chunk.name}`, entry);
    if (chunkUid) {
      entryByUid.set(chunkUid, entry);
    }
    addSymbol(symbolIndex, chunk.name, entry);
    const leaf = leafName(chunk.name);
    if (leaf && leaf !== chunk.name) addSymbol(symbolIndex, leaf, entry);
  }

  let linkedCalls = 0;
  let linkedUsages = 0;
  let inferredReturns = 0;
  let riskFlows = 0;

  const fileTextByRel = new Map();
  const fileTextByAbs = new Map();
  const getFileText = async (relPath) => {
    if (!relPath) return '';
    const absPath = path.join(rootDir, relPath);
    if (fileTextByAbs.has(absPath)) return fileTextByAbs.get(absPath) || '';
    let text = '';
    try {
      const result = await readTextFile(absPath);
      text = result?.text || '';
    } catch {}
    fileTextByAbs.set(absPath, text);
    fileTextByRel.set(relPath, text);
    return text;
  };

  const toolingEnabled = useTooling && enableTypeInference && toolingConfig?.autoEnableOnDetect !== false;
  if (toolingEnabled) {
    const filesToLoad = new Set();
    for (const chunk of chunks) {
      if (chunk?.file) filesToLoad.add(chunk.file);
    }
    for (const file of filesToLoad) {
      await getFileText(file);
    }
    const toolingResult = await runToolingPass({
      rootDir,
      buildRoot: buildRoot || rootDir,
      chunks,
      entryByUid,
      log,
      toolingConfig,
      toolingTimeoutMs,
      toolingRetries,
      toolingBreaker,
      toolingLogDir,
      fileTextByFile: fileTextByRel
    });
    inferredReturns += toolingResult.inferredReturns || 0;
  }

  const getChunkText = async (chunk) => {
    if (!chunk?.file) return '';
    const text = await getFileText(chunk.file);
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
          const entry = chunk.chunkUid
            ? entryByUid.get(chunk.chunkUid)
            : entryByKey.get(`${chunk.file}::${chunk.name}`);
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
        const { resolved } = resolveSymbolCandidates(callee);
        if (!resolved) continue;
        if (resolved.file === chunk.file && resolved.name === chunk.name) continue;
        const link = {
          name: callee,
          target: resolved.name,
          file: resolved.file,
          kind: resolved.kind
        };
        if (resolved.chunkUid) link.targetChunkUid = resolved.chunkUid;
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
        const { resolved, candidates } = resolveSymbolCandidates(callee);
        if (resolved && resolved.file === chunk.file && resolved.name === chunk.name) continue;
        if (resolved?.chunkUid && !detail.targetChunkUid) {
          detail.targetChunkUid = resolved.chunkUid;
        } else if (!resolved?.chunkUid && !detail.targetChunkUid && Array.isArray(candidates) && candidates.length) {
          const candidateIds = candidates.map(formatCandidate).filter(Boolean);
          if (candidateIds.length) detail.targetCandidates = candidateIds;
        }
        if (!resolved) continue;
        const args = Array.isArray(detail.args) ? detail.args : [];
        const summary = {
          name: callee,
          target: resolved.name,
          file: resolved.file,
          kind: resolved.kind,
          args
        };
        if (resolved.chunkUid) summary.targetChunkUid = resolved.chunkUid;
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
        const { resolved } = resolveSymbolCandidates(usage);
        if (!resolved) continue;
        if (resolved.file === chunk.file && resolved.name === chunk.name) continue;
        const link = {
          name: usage,
          target: resolved.name,
          file: resolved.file,
          kind: resolved.kind
        };
        if (resolved.chunkUid) link.targetChunkUid = resolved.chunkUid;
        addLink(usageLinks, link);
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
        const calleeChunk = summary.targetChunkUid
          ? chunkByUid.get(summary.targetChunkUid)
          : resolveChunkByKey(calleeKey);
        if (!calleeChunk) continue;
        const sampleKey = summary.targetChunkUid || calleeKey;
        const currentSamples = callSampleCounts.get(sampleKey) || 0;
        if (currentSamples >= callSampleLimit) continue;
        callSampleCounts.set(sampleKey, currentSamples + 1);
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
            const entry = summary.targetChunkUid
              ? entryByUid.get(summary.targetChunkUid)
              : entryByKey.get(calleeKey);
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
        const { resolved } = resolveSymbolCandidates(callName);
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
          const calleeChunk = link.targetChunkUid
            ? chunkByUid.get(link.targetChunkUid)
            : resolveChunkByKey(`${link.file}::${link.target}`);
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
