import { collectDeclaredReturnTypes } from '../../shared/docmeta.js';
import { cleanContext } from './context.js';
import { formatScoreBreakdown } from './explain.js';
import { getBodySummary } from './summary.js';

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
  score,
  scoreType,
  explain = false,
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
    formatScore(score, scoreType, c),
    c.gray(`Start/End: ${chunk.start}/${chunk.end}`),
    (chunk.startLine && chunk.endLine)
      ? c.gray(`Lines: ${chunk.startLine}-${chunk.endLine}`)
      : '',
    typeof chunk.churn === 'number' ? c.yellow(`Churn: ${chunk.churn}`) : ''
  ].filter(Boolean).join('  ');

  out += line1 + '\n';

  if (explain && chunk.scoreBreakdown) {
    const explainLines = formatScoreBreakdown(chunk.scoreBreakdown, c);
    if (explainLines.length) {
      out += explainLines.join('\n') + '\n';
    }
  }

  const headlinePart = chunk.headline ? c.bold('Headline: ') + c.underline(chunk.headline) : '';
  const lastModPart = chunk.last_modified ? c.gray('Last Modified: ') + c.bold(chunk.last_modified) : '';
  const secondLine = [headlinePart, lastModPart].filter(Boolean).join('   ');
  if (secondLine) out += '   ' + secondLine + '\n';

  if (chunk.last_author) {
    out += c.gray('   Last Author: ') + c.green(chunk.last_author) + '\n';
  }
  const chunkAuthors = Array.isArray(chunk.chunk_authors)
    ? chunk.chunk_authors
    : (Array.isArray(chunk.chunkAuthors) ? chunk.chunkAuthors : []);
  if (chunkAuthors.length) {
    const authors = chunkAuthors.slice(0, 6);
    const suffix = chunkAuthors.length > authors.length ? ' ...' : '';
    out += c.gray('   Chunk Authors: ') + c.green(authors.join(', ') + suffix) + '\n';
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

  if (chunk.importLinks?.length) {
    out += c.green('   ImportLinks: ') + chunk.importLinks.join(', ') + '\n';
  } else if (chunk.codeRelations?.importLinks?.length) {
    out += c.green('   ImportLinks: ') + chunk.codeRelations.importLinks.join(', ') + '\n';
  }

  if (chunk.usages?.length) {
    const usageFreq = Object.create(null);
    chunk.usages.forEach((raw) => {
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
  } else if (chunk.codeRelations?.usages?.length) {
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

  if (matched && queryTokens.length && chunk.headline) {
    const matchedTokens = queryTokens.filter((tok) => chunk.headline.includes(tok));
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
  if (explain && chunk.metaV2) {
    const containerExt = chunk.metaV2?.container?.ext || chunk.ext || null;
    const containerLang = chunk.metaV2?.container?.languageId || null;
    const effectiveExt = chunk.metaV2?.effective?.ext || null;
    const effectiveLang = chunk.metaV2?.effective?.languageId || chunk.metaV2?.lang || null;
    const segment = chunk.metaV2?.segment || null;
    const identityParts = [];
    const containerBits = [];
    if (chunk.file) containerBits.push(chunk.file);
    if (containerExt) containerBits.push(containerExt);
    if (containerLang) containerBits.push(`lang=${containerLang}`);
    if (containerBits.length) identityParts.push(`container=${containerBits.join(' ')}`);
    const effectiveBits = [];
    if (effectiveExt) effectiveBits.push(effectiveExt);
    if (effectiveLang) effectiveBits.push(`lang=${effectiveLang}`);
    if (effectiveBits.length) identityParts.push(`effective=${effectiveBits.join(' ')}`);
    if (segment) {
      const segmentBits = [];
      if (segment.segmentId) segmentBits.push(`id=${segment.segmentId}`);
      if (segment.segmentUid) segmentBits.push(`uid=${segment.segmentUid}`);
      if (segment.type) segmentBits.push(`type=${segment.type}`);
      if (Number.isFinite(segment.start) && Number.isFinite(segment.end)) {
        segmentBits.push(`span=${segment.start}-${segment.end}`);
      }
      if (Number.isFinite(segment.startLine) && Number.isFinite(segment.endLine)) {
        segmentBits.push(`lines=${segment.startLine}-${segment.endLine}`);
      }
      if (segmentBits.length) identityParts.push(`segment=${segmentBits.join(' ')}`);
    }
    if (identityParts.length) {
      out += c.gray('   Identity: ') + identityParts.join(' | ') + '\n';
    }
  }
  const commentEntries = Array.isArray(chunk.docmeta?.commentExcerpts)
    ? chunk.docmeta.commentExcerpts
    : null;
  const commentText = (commentEntries && commentEntries.length)
    ? commentEntries[0]?.text
    : chunk.docmeta?.commentExcerpt;
  if (commentText) {
    const normalized = String(commentText).replace(/\s+/g, ' ').trim();
    const snippet = normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
    out += c.gray('   Comment: ') + snippet + '\n';
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
  const declaredReturns = collectDeclaredReturnTypes(chunk.docmeta);
  if (declaredReturns.length) {
    out += c.cyan('   Return Type: ') + declaredReturns.join(' | ') + '\n';
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
      const summaryWords = bodySummary.split(/\s+/).filter(Boolean).length;
      if (summaryState.lastCount < maxWords) {
        maxWords = summaryWords;
      }
      summaryState.lastCount = summaryWords;
      out += c.gray('   Summary: ') + bodySummary + '\n';
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
  score,
  scoreType,
  explain = false,
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
  const scoreLabel = Number.isFinite(score)
    ? `[${scoreType ? `${score.toFixed(2)} ${scoreType}` : score.toFixed(2)}]`
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
  else if (chunk.headline && rx) {
    out += ' - ' + chunk.headline.replace(rx, (m) => color.bold(color.yellow(m)));
  }

  if (matched && queryTokens.length && chunk.headline) {
    const matchedTokens = queryTokens.filter((tok) => chunk.headline.includes(tok));
    if (matchedTokens.length) {
      out += color.gray(` Matched: ${matchedTokens.join(', ')}`);
    }
  }

  if (explain && chunk.scoreBreakdown) {
    const explainLines = formatScoreBreakdown(chunk.scoreBreakdown, color);
    if (explainLines.length) {
      out += '\n' + explainLines.join('\n');
    }
  }

  out += '\n';
  return out;
}
