import fs from 'node:fs';
import path from 'node:path';

const fileTextCache = new Map();
const summaryCache = new Map();

/**
 * Filter chunk metadata by search constraints.
 * @param {Array} meta
 * @param {object} filters
 * @returns {Array}
 */
export function filterChunks(meta, filters = {}) {
  const {
    type,
    author,
    call,
    importName,
    lint,
    churn,
    calls,
    uses,
    signature,
    param,
    decorator,
    returnType,
    throws,
    reads,
    writes,
    mutates,
    alias,
    risk,
    riskTag,
    riskSource,
    riskSink,
    riskCategory,
    riskFlow,
    awaits,
    branches,
    loops,
    breaks,
    continues,
    inferredType,
    visibility,
    extends: extendsFilter,
    async: asyncOnly,
    generator: generatorOnly,
    returns: returnsOnly,
    file,
    ext,
    meta: metaFilter
  } = filters;
  const normalize = (value) => String(value || '').toLowerCase();
  const normalizeList = (value) => {
    if (!value) return [];
    const entries = Array.isArray(value) ? value : [value];
    return entries
      .flatMap((entry) => String(entry || '').split(/[,\s]+/))
      .map((entry) => entry.trim())
      .filter(Boolean);
  };
  const fileNeedles = normalizeList(file).map(normalize);
  const extNeedles = normalizeList(ext)
    .map((entry) => {
      let value = entry.toLowerCase();
      value = value.replace(/^\*+/, '');
      if (value && !value.startsWith('.')) value = `.${value}`;
      return value;
    })
    .filter(Boolean);
  const metaFilters = Array.isArray(metaFilter) ? metaFilter : (metaFilter ? [metaFilter] : []);
  const matchList = (list, value) => {
    if (!value) return true;
    if (!Array.isArray(list)) return false;
    const needle = normalize(value);
    return list.some((entry) => normalize(entry).includes(needle));
  };
  const matchInferredType = (inferred, value) => {
    if (!value) return true;
    if (!inferred) return false;
    const needle = normalize(value);
    const types = [];
    const collect = (entries) => {
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (entry?.type) types.push(entry.type);
      }
    };
    const collectMap = (map) => {
      if (!map || typeof map !== 'object') return;
      Object.values(map).forEach((entries) => collect(entries));
    };
    collectMap(inferred.params);
    collectMap(inferred.fields);
    collectMap(inferred.locals);
    collect(inferred.returns);
    if (!types.length) return false;
    return types.some((entry) => normalize(entry).includes(needle));
  };
  const truthy = (value) => value === true;
  const resolveMetaField = (record, key) => {
    if (!record || typeof record !== 'object' || !key) return undefined;
    if (!key.includes('.')) return record[key];
    return key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), record);
  };
  const matchMetaFilters = (chunk) => {
    if (!metaFilters.length) return true;
    const recordMeta = chunk?.docmeta?.record;
    if (!recordMeta || typeof recordMeta !== 'object') return false;
    for (const filter of metaFilters) {
      const key = filter?.key;
      if (!key) continue;
      const value = filter?.value;
      const field = resolveMetaField(recordMeta, key);
      if (value == null || value === '') {
        if (field == null) return false;
        if (Array.isArray(field) && field.length === 0) return false;
        if (typeof field === 'string' && !field.trim()) return false;
        continue;
      }
      const needle = normalize(value);
      if (Array.isArray(field)) {
        if (!field.some((entry) => normalize(entry).includes(needle))) return false;
      } else if (field && typeof field === 'object') {
        if (!normalize(JSON.stringify(field)).includes(needle)) return false;
      } else if (!normalize(field).includes(needle)) {
        return false;
      }
    }
    return true;
  };

  return meta.filter((c) => {
    if (!c) return false;
    if (fileNeedles.length) {
      const fileValue = normalize(c.file);
      if (!fileNeedles.some((needle) => fileValue.includes(needle))) return false;
    }
    if (extNeedles.length) {
      const extValue = normalize(c.ext || path.extname(c.file || ''));
      if (!extNeedles.includes(extValue)) return false;
    }
    if (!matchMetaFilters(c)) return false;
    if (type && c.kind && c.kind.toLowerCase() !== type.toLowerCase()) return false;
    if (author && c.last_author && !c.last_author.toLowerCase().includes(author.toLowerCase())) return false;
    if (call && c.codeRelations && c.codeRelations.calls) {
      const found = c.codeRelations.calls.find(([fn, callName]) => callName === call || fn === call);
      if (!found) return false;
    }
    if (importName && c.codeRelations && c.codeRelations.imports) {
      if (!c.codeRelations.imports.includes(importName)) return false;
    }
    if (lint && (!c.lint || !c.lint.length)) return false;
    if (churn !== null && churn !== undefined) {
      const churnValue = Number(c.churn);
      if (!Number.isFinite(churnValue) || churnValue < churn) return false;
    }
    if (calls && c.codeRelations && c.codeRelations.calls) {
      const found = c.codeRelations.calls.find(([fn, callName]) => fn === calls || callName === calls);
      if (!found) return false;
    }
    if (uses && c.codeRelations && c.codeRelations.usages) {
      if (!c.codeRelations.usages.includes(uses)) return false;
    }
    if (signature && c.docmeta?.signature) {
      if (!c.docmeta.signature.includes(signature)) return false;
    }
    if (param && c.docmeta?.params) {
      if (!c.docmeta.params.includes(param)) return false;
    }
    if (decorator && !matchList(c.docmeta?.decorators, decorator)) return false;
    if (returnType) {
      const foundReturnType = c.docmeta?.returnType || null;
      if (!foundReturnType || !normalize(foundReturnType).includes(normalize(returnType))) {
        return false;
      }
    }
    if (inferredType && !matchInferredType(c.docmeta?.inferredTypes, inferredType)) {
      return false;
    }
    if (throws && !matchList(c.docmeta?.throws, throws)) return false;
    if (awaits && !matchList(c.docmeta?.awaits, awaits)) return false;
    if (reads && !matchList(c.docmeta?.dataflow?.reads, reads)) return false;
    if (writes && !matchList(c.docmeta?.dataflow?.writes, writes)) return false;
    if (mutates && !matchList(c.docmeta?.dataflow?.mutations, mutates)) return false;
    if (alias && !matchList(c.docmeta?.dataflow?.aliases, alias)) return false;
    const riskMeta = c.docmeta?.risk || null;
    const riskTagValue = riskTag || risk;
    if (riskTagValue && !matchList(riskMeta?.tags, riskTagValue)) return false;
    if (riskSource) {
      const sourceNames = Array.isArray(riskMeta?.sources)
        ? riskMeta.sources.map((source) => source.name)
        : null;
      if (!matchList(sourceNames, riskSource)) return false;
    }
    if (riskSink) {
      const sinkNames = Array.isArray(riskMeta?.sinks)
        ? riskMeta.sinks.map((sink) => sink.name)
        : null;
      if (!matchList(sinkNames, riskSink)) return false;
    }
    if (riskCategory) {
      const categories = Array.isArray(riskMeta?.categories)
        ? riskMeta.categories
        : (Array.isArray(riskMeta?.sinks) ? riskMeta.sinks.map((sink) => sink.category) : null);
      if (!matchList(categories, riskCategory)) return false;
    }
    if (riskFlow) {
      const flows = Array.isArray(riskMeta?.flows)
        ? riskMeta.flows.map((flow) => `${flow.source}->${flow.sink}`)
        : null;
      if (!matchList(flows, riskFlow)) return false;
    }
    if (branches != null) {
      const count = c.docmeta?.controlFlow?.branches;
      if (!Number.isFinite(count) || count < branches) return false;
    }
    if (loops != null) {
      const count = c.docmeta?.controlFlow?.loops;
      if (!Number.isFinite(count) || count < loops) return false;
    }
    if (breaks != null) {
      const count = c.docmeta?.controlFlow?.breaks;
      if (!Number.isFinite(count) || count < breaks) return false;
    }
    if (continues != null) {
      const count = c.docmeta?.controlFlow?.continues;
      if (!Number.isFinite(count) || count < continues) return false;
    }
    if (visibility) {
      const docVisibility = c.docmeta?.visibility || c.docmeta?.modifiers?.visibility || null;
      if (!docVisibility || !normalize(docVisibility).includes(normalize(visibility))) {
        return false;
      }
    }
    if (extendsFilter) {
      const parents = c.docmeta?.extends || c.docmeta?.bases || [];
      if (!matchList(parents, extendsFilter)) return false;
    }
    if (truthy(asyncOnly)) {
      if (!(c.docmeta?.async || c.docmeta?.modifiers?.async)) return false;
    }
    if (truthy(generatorOnly)) {
      if (!(c.docmeta?.modifiers?.generator || c.docmeta?.yields)) return false;
    }
    if (truthy(returnsOnly)) {
      if (!(c.docmeta?.returnsValue || c.docmeta?.returns)) return false;
    }
    return true;
  });
}

/**
 * Normalize context lines for display.
 * @param {string[]} lines
 * @returns {string[]}
 */
export function cleanContext(lines) {
  return lines
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '```') return false;
      if (!/[a-zA-Z0-9]/.test(trimmed)) return false;
      return true;
    })
    .map((line) => line.replace(/\s+/g, ' ').trim());
}

function getBodySummary(rootDir, chunk, maxWords = 80) {
  try {
    const absPath = path.join(rootDir, chunk.file);
    const cacheKey = `${absPath}:${chunk.start}:${chunk.end}:${maxWords}`;
    if (summaryCache.has(cacheKey)) return summaryCache.get(cacheKey);
    let text = fileTextCache.get(absPath);
    if (!text) {
      text = fs.readFileSync(absPath, 'utf8');
      fileTextCache.set(absPath, text);
    }
    const chunkText = text.slice(chunk.start, chunk.end)
      .replace(/\s+/g, ' ')
      .trim();
    const words = chunkText.split(/\s+/).slice(0, maxWords).join(' ');
    summaryCache.set(cacheKey, words);
    return words;
  } catch {
    return '(Could not load summary)';
  }
}

const formatInferredEntry = (entry) => {
  if (!entry?.type) return '';
  const parts = [];
  if (entry.source) parts.push(entry.source);
  if (Number.isFinite(entry.confidence)) parts.push(entry.confidence.toFixed(2));
  const suffix = parts.length ? ` (${parts.join(', ')})` : '';
  return `${entry.type}${suffix}`;
};

const formatInferredEntries = (entries, limit = 3) => {
  if (!Array.isArray(entries) || !entries.length) return '';
  return entries.slice(0, limit).map(formatInferredEntry).filter(Boolean).join(', ');
};

const formatInferredMap = (map, limit = 3) => {
  if (!map || typeof map !== 'object') return '';
  const entries = Object.entries(map).slice(0, limit).map(([name, items]) => {
    const formatted = formatInferredEntries(items, 2);
    return formatted ? `${name}=${formatted}` : '';
  }).filter(Boolean);
  return entries.join(', ');
};

const formatScore = (score, scoreType, color) => {
  if (!Number.isFinite(score)) return '';
  const label = scoreType ? `${score.toFixed(2)} ${scoreType}` : score.toFixed(2);
  return color.green(label);
};

/**
 * Render a full, human-readable result entry.
 * @param {object} options
 * @returns {string}
 */
export function formatFullChunk({
  chunk,
  index,
  mode,
  annScore,
  scoreType,
  color,
  queryTokens = [],
  rx,
  matched = false,
  rootDir,
  summaryState
}) {
  if (!chunk || !chunk.file) {
    return color.red(`   ${index + 1}. [Invalid result - missing chunk or file]`) + '\n';
  }
  const c = color;
  let out = '';

  const line1 = [
    c.bold(c[mode === 'code' ? 'blue' : 'magenta'](`${index + 1}. ${chunk.file}`)),
    c.cyan(chunk.name || ''),
    c.yellow(chunk.kind || ''),
    formatScore(annScore, scoreType, c),
    c.gray(`Start/End: ${chunk.start}/${chunk.end}`),
    (chunk.startLine && chunk.endLine)
      ? c.gray(`Lines: ${chunk.startLine}-${chunk.endLine}`)
      : '',
    typeof chunk.churn === 'number' ? c.yellow(`Churn: ${chunk.churn}`) : ''
  ].filter(Boolean).join('  ');

  out += line1 + '\n';

  const headlinePart = chunk.headline ? c.bold('Headline: ') + c.underline(chunk.headline) : '';
  const lastModPart = chunk.last_modified ? c.gray('Last Modified: ') + c.bold(chunk.last_modified) : '';
  const secondLine = [headlinePart, lastModPart].filter(Boolean).join('   ');
  if (secondLine) out += '   ' + secondLine + '\n';

  if (chunk.last_author) {
    out += c.gray('   Last Author: ') + c.green(chunk.last_author) + '\n';
  }

  if (chunk.imports?.length) {
    out += c.magenta('   Imports: ') + chunk.imports.join(', ') + '\n';
  } else if (chunk.codeRelations?.imports?.length) {
    out += c.magenta('   Imports: ') + chunk.codeRelations.imports.join(', ') + '\n';
  }

  if (chunk.exports?.length) {
    out += c.blue('   Exports: ') + chunk.exports.join(', ') + '\n';
  } else if (chunk.codeRelations?.exports?.length) {
    out += c.blue('   Exports: ') + chunk.codeRelations.exports.join(', ') + '\n';
  }

  if (chunk.codeRelations?.calls?.length) {
    out += c.yellow('   Calls: ') + chunk.codeRelations.calls.map(([a, b]) => `${a}->${b}`).join(', ') + '\n';
  }
  if (chunk.codeRelations?.callSummaries?.length) {
    const summaries = chunk.codeRelations.callSummaries.slice(0, 3).map((summary) => {
      const args = Array.isArray(summary.args) && summary.args.length ? summary.args.join(', ') : '';
      const returns = Array.isArray(summary.returnTypes) && summary.returnTypes.length
        ? ` -> ${summary.returnTypes.join(' | ')}`
        : '';
      return `${summary.name}(${args})${returns}`;
    });
    out += c.yellow('   CallSummary: ') + summaries.join(', ') + '\n';
  }

  if (chunk.codeRelations?.importLinks?.length) {
    out += c.green('   ImportLinks: ') + chunk.codeRelations.importLinks.join(', ') + '\n';
  }

  if (chunk.codeRelations?.usages?.length) {
    const usageFreq = Object.create(null);
    chunk.codeRelations.usages.forEach((raw) => {
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (!trimmed) return;
      usageFreq[trimmed] = (usageFreq[trimmed] || 0) + 1;
    });

    const usageEntries = Object.entries(usageFreq).sort((a, b) => b[1] - a[1]);
    const maxCount = usageEntries[0]?.[1] || 0;

    const usageStr = usageEntries.slice(0, 10).map(([usage, count]) => {
      if (count === 1) return usage;
      if (count === maxCount) return c.bold(c.yellow(`${usage} (${count})`));
      return c.cyan(`${usage} (${count})`);
    }).join(', ');

    if (usageStr.length) out += c.cyan('   Usages: ') + usageStr + '\n';
  }

  const uniqueTokens = [...new Set((chunk.tokens || []).map((t) => t.trim()).filter((t) => t))];
  if (uniqueTokens.length) {
    out += c.magenta('   Tokens: ') + uniqueTokens.slice(0, 10).join(', ') + '\n';
  }

  if (matched && queryTokens.length) {
    const matchedTokens = queryTokens.filter((tok) =>
      (chunk.tokens && chunk.tokens.includes(tok)) ||
      (chunk.ngrams && chunk.ngrams.includes(tok)) ||
      (chunk.headline && chunk.headline.includes(tok))
    );
    if (matchedTokens.length) {
      out += c.gray('   Matched: ') + matchedTokens.join(', ') + '\n';
    }
  }

  const recordMeta = chunk.docmeta?.record || null;
  if (recordMeta) {
    const recordParts = [];
    if (recordMeta.recordType) recordParts.push(`type=${recordMeta.recordType}`);
    if (recordMeta.severity) recordParts.push(`severity=${recordMeta.severity}`);
    if (recordMeta.status) recordParts.push(`status=${recordMeta.status}`);
    const vulnId = recordMeta.vulnId || recordMeta.cve;
    if (vulnId) recordParts.push(`vuln=${vulnId}`);
    if (recordMeta.packageName) recordParts.push(`package=${recordMeta.packageName}`);
    if (recordMeta.packageEcosystem) recordParts.push(`ecosystem=${recordMeta.packageEcosystem}`);
    if (recordParts.length) {
      out += c.yellow('   Record: ') + recordParts.join(', ') + '\n';
    }
    const routeParts = [];
    if (recordMeta.service) routeParts.push(`service=${recordMeta.service}`);
    if (recordMeta.env) routeParts.push(`env=${recordMeta.env}`);
    if (recordMeta.team) routeParts.push(`team=${recordMeta.team}`);
    if (recordMeta.owner) routeParts.push(`owner=${recordMeta.owner}`);
    if (recordMeta.assetId) routeParts.push(`asset=${recordMeta.assetId}`);
    if (routeParts.length) {
      out += c.gray('   Route: ') + routeParts.join(', ') + '\n';
    }
    if (chunk.docmeta?.doc) {
      out += c.gray('   Summary: ') + chunk.docmeta.doc + '\n';
    }
  }

  if (chunk.docmeta?.signature) {
    out += c.cyan('   Signature: ') + chunk.docmeta.signature + '\n';
  }
  const modifiers = chunk.docmeta?.modifiers || null;
  const modifierParts = [];
  if (chunk.docmeta?.async || modifiers?.async) modifierParts.push('async');
  if (modifiers?.generator || chunk.docmeta?.yields) modifierParts.push('generator');
  if (modifiers?.static) modifierParts.push('static');
  const visibility = chunk.docmeta?.visibility || modifiers?.visibility || null;
  if (visibility) modifierParts.push(`visibility=${visibility}`);
  if (chunk.docmeta?.methodKind) modifierParts.push(`kind=${chunk.docmeta.methodKind}`);
  if (modifierParts.length) {
    out += c.gray('   Modifiers: ') + modifierParts.join(', ') + '\n';
  }
  if (chunk.docmeta?.decorators?.length) {
    out += c.magenta('   Decorators: ') + chunk.docmeta.decorators.join(', ') + '\n';
  }
  const bases = chunk.docmeta?.extends || chunk.docmeta?.bases || [];
  if (Array.isArray(bases) && bases.length) {
    out += c.magenta('   Extends: ') + bases.join(', ') + '\n';
  }
  if (chunk.docmeta?.returnType) {
    out += c.cyan('   Return Type: ') + chunk.docmeta.returnType + '\n';
  } else if (chunk.docmeta?.returnsValue) {
    out += c.cyan('   Returns: ') + 'value' + '\n';
  }
  const inferredTypes = chunk.docmeta?.inferredTypes || null;
  if (inferredTypes) {
    const inferredParams = formatInferredMap(inferredTypes.params);
    if (inferredParams) {
      out += c.gray('   Inferred Params: ') + inferredParams + '\n';
    }
    const inferredReturns = formatInferredEntries(inferredTypes.returns, 2);
    if (inferredReturns) {
      out += c.gray('   Inferred Returns: ') + inferredReturns + '\n';
    }
    const inferredFields = formatInferredMap(inferredTypes.fields);
    if (inferredFields) {
      out += c.gray('   Inferred Fields: ') + inferredFields + '\n';
    }
    const inferredLocals = formatInferredMap(inferredTypes.locals);
    if (inferredLocals) {
      out += c.gray('   Inferred Locals: ') + inferredLocals + '\n';
    }
  }
  if (chunk.docmeta?.throws?.length) {
    out += c.red('   Throws: ') + chunk.docmeta.throws.slice(0, 6).join(', ') + '\n';
  }
  if (chunk.docmeta?.awaits?.length) {
    out += c.blue('   Awaits: ') + chunk.docmeta.awaits.slice(0, 6).join(', ') + '\n';
  }
  if (chunk.docmeta?.yields) {
    out += c.blue('   Yields: ') + 'yes' + '\n';
  }
  const dataflow = chunk.docmeta?.dataflow || null;
  if (dataflow) {
    if (dataflow.reads?.length) {
      out += c.gray('   Reads: ') + dataflow.reads.slice(0, 6).join(', ') + '\n';
    }
    if (dataflow.writes?.length) {
      out += c.gray('   Writes: ') + dataflow.writes.slice(0, 6).join(', ') + '\n';
    }
    if (dataflow.mutations?.length) {
      out += c.gray('   Mutates: ') + dataflow.mutations.slice(0, 6).join(', ') + '\n';
    }
    if (dataflow.aliases?.length) {
      out += c.gray('   Aliases: ') + dataflow.aliases.slice(0, 6).join(', ') + '\n';
    }
    if (dataflow.globals?.length) {
      out += c.gray('   Globals: ') + dataflow.globals.slice(0, 6).join(', ') + '\n';
    }
    if (dataflow.nonlocals?.length) {
      out += c.gray('   Nonlocals: ') + dataflow.nonlocals.slice(0, 6).join(', ') + '\n';
    }
  }
  const risk = chunk.docmeta?.risk || null;
  if (risk) {
    if (risk.severity) {
      out += c.red(`   RiskLevel: ${risk.severity}`) + '\n';
    }
    if (risk.tags?.length) {
      out += c.red('   RiskTags: ') + risk.tags.slice(0, 6).join(', ') + '\n';
    }
    if (risk.flows?.length) {
      const flowList = risk.flows.slice(0, 3).map((flow) =>
        `${flow.source}->${flow.sink} (${flow.category})`
      );
      out += c.red('   RiskFlows: ') + flowList.join(', ') + '\n';
    }
  }
  const controlFlow = chunk.docmeta?.controlFlow || null;
  if (controlFlow) {
    const entries = [
      ['branches', controlFlow.branches],
      ['loops', controlFlow.loops],
      ['returns', controlFlow.returns],
      ['breaks', controlFlow.breaks],
      ['continues', controlFlow.continues],
      ['throws', controlFlow.throws],
      ['awaits', controlFlow.awaits],
      ['yields', controlFlow.yields]
    ].filter(([, value]) => Number.isFinite(value) && value > 0);
    if (entries.length) {
      out += c.gray('   Control: ') + entries.map(([key, value]) => `${key}=${value}`).join(', ') + '\n';
    }
  }

  if (chunk.lint?.length) {
    out += c.red(`   Lint: ${chunk.lint.length} issues`) +
      (chunk.lint.length ? c.gray(' | ') + chunk.lint.slice(0, 2).map((lintMsg) => JSON.stringify(lintMsg.message)).join(', ') : '') + '\n';
  }

  if (chunk.externalDocs?.length) {
    out += c.blue('   Docs: ') + chunk.externalDocs.join(', ') + '\n';
  }

  const cleanedPreContext = chunk.preContext ? cleanContext(chunk.preContext) : [];
  if (cleanedPreContext.length) {
    out += c.gray('   preContext: ') + cleanedPreContext.map((line) => c.green(line.trim())).join(' | ') + '\n';
  }

  const cleanedPostContext = chunk.postContext ? cleanContext(chunk.postContext) : [];
  if (cleanedPostContext.length) {
    out += c.gray('   postContext: ') + cleanedPostContext.map((line) => c.green(line.trim())).join(' | ') + '\n';
  }

  if (summaryState && rootDir && !chunk.docmeta?.record) {
    if (index === 0) summaryState.lastCount = 0;
    if (index < 5) {
      let maxWords = 10;
      const lessPer = 3;
      maxWords -= (lessPer * index);
      const bodySummary = getBodySummary(rootDir, chunk, maxWords);
      if (summaryState.lastCount < maxWords) {
        maxWords = bodySummary.length;
      }
      summaryState.lastCount = bodySummary.length;
      out += c.gray('   Summary: ') + `${getBodySummary(rootDir, chunk, maxWords)}` + '\n';
    }
  }

  out += c.gray(''.padEnd(60, '-')) + '\n';
  return out;
}

/**
 * Render a compact, single-line result entry.
 * @param {object} options
 * @returns {string}
 */
export function formatShortChunk({
  chunk,
  index,
  mode,
  annScore,
  scoreType,
  color,
  queryTokens = [],
  rx,
  matched = false
}) {
  if (!chunk || !chunk.file) {
    return color.red(`   ${index + 1}. [Invalid result - missing chunk or file]`) + '\n';
  }
  let out = '';
  out += `${color.bold(color[mode === 'code' ? 'blue' : 'magenta'](`${index + 1}. ${chunk.file}`))}`;
  const scoreLabel = Number.isFinite(annScore)
    ? `[${scoreType ? `${annScore.toFixed(2)} ${scoreType}` : annScore.toFixed(2)}]`
    : '';
  if (scoreLabel) {
    out += color.yellow(` ${scoreLabel}`);
  }
  if (chunk.name) out += ' ' + color.cyan(chunk.name);
  out += color.gray(` (${chunk.kind || 'unknown'})`);
  const recordMeta = chunk.docmeta?.record || null;
  if (recordMeta) {
    const recordBits = [];
    if (recordMeta.severity) recordBits.push(recordMeta.severity);
    if (recordMeta.status) recordBits.push(recordMeta.status);
    const vulnId = recordMeta.vulnId || recordMeta.cve;
    if (vulnId) recordBits.push(vulnId);
    if (recordMeta.packageName) recordBits.push(recordMeta.packageName);
    if (recordBits.length) {
      out += color.yellow(` [${recordBits.join(' | ')}]`);
    }
  }
  if (chunk.last_author) out += color.green(` by ${chunk.last_author}`);
  if (chunk.headline) out += ` - ${color.underline(chunk.headline)}`;
  else if (chunk.tokens && chunk.tokens.length && rx) {
    out += ' - ' + chunk.tokens.slice(0, 10).join(' ').replace(rx, (m) => color.bold(color.yellow(m)));
  }

  if (matched && queryTokens.length) {
    const matchedTokens = queryTokens.filter((tok) =>
      (chunk.tokens && chunk.tokens.includes(tok)) ||
      (chunk.ngrams && chunk.ngrams.includes(tok)) ||
      (chunk.headline && chunk.headline.includes(tok))
    );
    if (matchedTokens.length) {
      out += color.gray(` Matched: ${matchedTokens.join(', ')}`);
    }
  }

  out += '\n';
  return out;
}
