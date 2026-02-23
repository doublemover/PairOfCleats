import { collectDeclaredReturnTypes } from '../../../shared/docmeta.js';
import { formatScoreBreakdown } from '../explain.js';
import { getBodySummary } from '../summary.js';
import { getFormatFullCache } from '../cache.js';
import {
  ANSI,
  BG_CALLS,
  BG_CALL_SUMMARY,
  BG_EXPORTS,
  BG_IMPORT_LINKS,
  BG_IMPORTS,
  applyLineBackground,
  boldText,
  colorText,
  italicColor,
  labelToken,
  stripAnsi
} from './ansi.js';
import {
  INDENT,
  buildFormatCacheKey,
  buildQueryHash,
  buildVerticalLines,
  buildWrappedLines,
  compareText,
  formatControlFlow,
  formatInferredEntries,
  formatInferredMap,
  formatLastModified,
  formatSignature,
  formatWrappedList,
  toArray
} from './display-meta.js';

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
  summaryState,
  allowSummary = true,
  _skipCache = false
}) {
  if (!chunk || !chunk.file) {
    return color.red(`   ${index + 1}. [Invalid result - missing chunk or file]`) + '\n';
  }
  const canCache = !_skipCache && !explain && (!summaryState || !allowSummary);
  const formatCache = canCache ? getFormatFullCache() : null;
  const queryHash = canCache ? buildQueryHash(queryTokens, rx) : '';
  let cacheKey = null;
  if (canCache && formatCache) {
    cacheKey = buildFormatCacheKey({ chunk, index, mode, queryHash, matched, explain });
    const cached = formatCache.get(cacheKey);
    if (cached) return cached;
  }
  const c = color;
  let out = '';

  const lineRange = Number.isFinite(chunk.startLine) && Number.isFinite(chunk.endLine)
    ? `[${chunk.startLine}-${chunk.endLine}]`
    : '';
  const fileLabel = lineRange ? `${chunk.file}:${lineRange}` : chunk.file;
  const signature = chunk.docmeta?.signature || '';
  const isPlaceholderName = chunk.name === 'blob' || chunk.name === 'root';
  const isPlaceholderKind = chunk.kind === 'Blob' || (chunk.kind === 'Section' && !chunk.name) || (chunk.kind === 'Module' && !chunk.name);
  const nameLabel = (!isPlaceholderName && chunk.name) ? String(chunk.name) : '';
  const kindLabel = isPlaceholderKind ? '' : (chunk.kind ? String(chunk.kind) : '');
  const fallbackSig = [kindLabel, nameLabel].filter(Boolean).join(' ').trim();
  const signatureLabel = signature || fallbackSig;
  const displayName = nameLabel || signatureLabel || fileLabel;
  const signaturePart = signatureLabel && signatureLabel !== displayName
    ? formatSignature(signatureLabel, nameLabel || displayName)
    : '';
  const lastModLabel = formatLastModified(chunk.last_modified);
  const filePathStyled = italicColor(chunk.file, ANSI.fgLight);
  const rangeStyled = lineRange ? colorText(lineRange, ANSI.fgLight) : '';
  const fileStyled = lineRange
    ? `${filePathStyled}${colorText(':', ANSI.fgLight)}${rangeStyled}`
    : filePathStyled;
  const timeStyled = lastModLabel ? colorText(lastModLabel, ANSI.fgBlack) : '';
  const line1Parts = [
    `${index + 1}. ${boldText(displayName)}`,
    signaturePart,
    displayName === fileLabel ? '' : fileStyled,
    timeStyled
  ].filter(Boolean);
  out += line1Parts.join(' - ') + '\n';

  if (explain) {
    const chunkAuthors = Array.isArray(chunk.chunk_authors)
      ? chunk.chunk_authors
      : (Array.isArray(chunk.chunkAuthors) ? chunk.chunkAuthors : []);
    const authorParts = [];
    if (chunk.last_author) authorParts.push(`last=${chunk.last_author}`);
    if (chunkAuthors.length) {
      const authors = chunkAuthors.slice(0, 6);
      const suffix = chunkAuthors.length > authors.length ? ' ...' : '';
      authorParts.push(`chunks=${authors.join(', ')}${suffix}`);
    }
    if (authorParts.length) {
      out += c.gray(`${INDENT}Authors: `) + c.green(authorParts.join(' | ')) + '\n';
    }
  }

  const summaryBits = [];
  const pipeSeparator = ` ${colorText('|', ANSI.fgBlack)} `;
  const declaredReturns = collectDeclaredReturnTypes(chunk.docmeta);
  if (declaredReturns.length) {
    summaryBits.push(
      `${labelToken('Returns', ANSI.fgDarkGreen)} ${colorText(declaredReturns.join(' | '), ANSI.fgLightGreen)}`
    );
  } else if (chunk.docmeta?.returnsValue) {
    summaryBits.push(
      `${labelToken('Returns', ANSI.fgDarkGreen)} ${colorText('value', ANSI.fgLightGreen)}`
    );
  }
  const throwsList = toArray(chunk.docmeta?.throws);
  if (throwsList.length) {
    summaryBits.push(
      `${labelToken('Throws', ANSI.fgDarkOrange)} ${throwsList.slice(0, 6).join(', ')}`
    );
  }
  const controlParts = formatControlFlow(chunk.docmeta?.controlFlow || null);
  if (controlParts.length) {
    const labelColors = {
      Branch: ANSI.fgPurple,
      Branches: ANSI.fgPurple,
      Return: ANSI.fgGreen,
      Returns: ANSI.fgGreen,
      Throw: ANSI.fgDarkOrange,
      Throws: ANSI.fgDarkOrange
    };
    const controlValue = controlParts.map(({ label, value }) => {
      const count = colorText(String(value), ANSI.fgBrightWhite);
      const labelColor = labelColors[label];
      const renderedLabel = labelColor ? colorText(label, labelColor) : label;
      return `${count} ${renderedLabel}`;
    }).join(', ');
    summaryBits.push(`${labelToken('Control', ANSI.fgDarkerCyan)} ${controlValue}`);
  }
  if (summaryBits.length) {
    out += `${INDENT}${summaryBits.join(pipeSeparator)}\n`;
  }

  const backgroundSections = [];
  const pushBackgroundSection = (lines, bg) => {
    if (lines.length) backgroundSections.push({ lines, bg });
  };
  const formatFileItem = (item) => italicColor(String(item), ANSI.fgLight);
  const formatExportItem = (item) => colorText(String(item), ANSI.fgBrightWhite);
  const formatCallValue = (value) => {
    const raw = String(value).trim();
    if (!raw) return '';
    if (raw === '...') return colorText(raw, ANSI.fgDarkGray);
    const match = raw.match(/^(.*?)(\s*\((\d+)\))$/);
    if (match) {
      const name = match[1].trim();
      const count = match[3];
      return `${colorText(name, ANSI.fgBlack)} ${colorText(`(${count})`, ANSI.fgBrightWhite)}`;
    }
    return colorText(raw, ANSI.fgBlack);
  };
  const formatCallSummary = (text) => {
    const raw = String(text);
    const match = raw.match(/^([A-Za-z0-9_$\.]+)(.*)$/);
    if (match) {
      return `${colorText(match[1], ANSI.fgBlue)}${colorText(match[2], ANSI.fgBrightWhite)}`;
    }
    return colorText(raw, ANSI.fgBrightWhite);
  };

  const importItems = toArray(chunk.imports).length
    ? toArray(chunk.imports)
    : toArray(chunk.codeRelations?.imports);
  const importLines = importItems.length
    ? buildWrappedLines(labelToken('Imports', ANSI.fgPink), importItems.map(formatFileItem))
    : [];
  pushBackgroundSection(importLines, BG_IMPORTS);

  const exportItems = toArray(chunk.exports).length
    ? toArray(chunk.exports)
    : toArray(chunk.codeRelations?.exports);
  const exportLines = exportItems.length
    ? buildWrappedLines(labelToken('Exports', ANSI.fgCyan), exportItems.map(formatExportItem))
    : [];
  pushBackgroundSection(exportLines, BG_EXPORTS);

  const callPairs = toArray(chunk.codeRelations?.calls);
  if (callPairs.length) {
    const callers = new Set();
    const calleeCounts = new Map();
    for (const [caller, callee] of callPairs) {
      if (caller) callers.add(caller);
      if (!callee) continue;
      calleeCounts.set(callee, (calleeCounts.get(callee) || 0) + 1);
    }
    const entries = Array.from(calleeCounts.entries())
      .sort((a, b) => (b[1] - a[1]) || compareText(a[0], b[0]));
    const maxEntries = 8;
    const rendered = entries.slice(0, maxEntries).map(([callee, count]) => (
      count > 1 ? `${callee} (${count})` : callee
    ));
    const trimmed = entries.length > rendered.length;
    if (rendered.length) {
      const callerName = callers.size === 1 ? Array.from(callers)[0] : '';
      const callerPrefixPlain = callerName ? `${callerName}->` : '';
      const callerPrefixStyled = callerName
        ? `${colorText(callerName, ANSI.fgBlue)}${colorText('->', ANSI.fgBrightWhite)}`
        : '';
      const values = rendered.map(formatCallValue);
      if (trimmed) values.push(formatCallValue('...'));
      const callLabel = labelToken('Calls', ANSI.fgBlue);
      const prefixVisible = stripAnsi(`${INDENT}${callLabel} ${callerPrefixPlain}`).length;
      const pad = ' '.repeat(prefixVisible);
      const firstLine = `${INDENT}${callLabel} ${callerPrefixStyled}${values[0]}`;
      const rest = values.slice(1).map((value) => `${pad}${value}`);
      const callLines = [firstLine, ...rest];
      pushBackgroundSection(callLines, BG_CALLS);
    }
  }
  const callSummaries = toArray(chunk.codeRelations?.callSummaries);
  if (callSummaries.length) {
    const summaries = callSummaries.slice(0, 3).map((summary) => {
      const args = Array.isArray(summary.args) && summary.args.length ? summary.args.join(', ') : '';
      const returns = Array.isArray(summary.returnTypes) && summary.returnTypes.length
        ? ` -> ${summary.returnTypes.join(' | ')}`
        : '';
      return formatCallSummary(`${summary.name}(${args})${returns}`);
    });
    const summaryLines = buildVerticalLines(labelToken('Call Summary', ANSI.fgBlue), summaries);
    pushBackgroundSection(summaryLines, BG_CALL_SUMMARY);
  }

  const importLinkItems = toArray(chunk.importLinks).length
    ? toArray(chunk.importLinks)
    : toArray(chunk.codeRelations?.importLinks);
  const importLinkLines = importLinkItems.length
    ? buildWrappedLines(labelToken('Import Links', ANSI.fgGreen), importLinkItems.map(formatFileItem))
    : [];
  pushBackgroundSection(importLinkLines, BG_IMPORT_LINKS);

  const maxSectionWidth = backgroundSections.length
    ? Math.max(...backgroundSections.flatMap((section) => section.lines.map((line) => {
      const content = line.startsWith(INDENT) ? line.slice(INDENT.length) : line;
      return stripAnsi(content).length;
    })))
    : 0;
  for (const section of backgroundSections) {
    for (const line of section.lines) {
      const indent = line.startsWith(INDENT) ? INDENT : '';
      const content = line.startsWith(INDENT) ? line.slice(INDENT.length) : line;
      out += `${indent}${applyLineBackground(content, {
        enabled: true,
        columns: maxSectionWidth,
        bg: section.bg || ANSI.bgBlack
      })}\n`;
    }
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
    out += formatWrappedList(labelToken('Modifiers', ANSI.fgDarkGray), modifierParts);
  }
  const decorators = toArray(chunk.docmeta?.decorators);
  if (decorators.length) {
    out += formatWrappedList(labelToken('Decorators', ANSI.fgMagenta), decorators);
  }
  const bases = chunk.docmeta?.extends || chunk.docmeta?.bases || [];
  if (Array.isArray(bases) && bases.length) {
    out += formatWrappedList(labelToken('Extends', ANSI.fgMagenta), bases);
  }

  const usages = toArray(chunk.usages);
  if (usages.length) {
    const usageFreq = Object.create(null);
    usages.forEach((raw) => {
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

    if (usageStr.length) out += formatWrappedList(labelToken('Usages', ANSI.fgCyan), usageStr.split(', '));
  } else {
    const relationUsages = toArray(chunk.codeRelations?.usages);
    if (relationUsages.length) {
      const usageFreq = Object.create(null);
      relationUsages.forEach((raw) => {
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

      if (usageStr.length) out += formatWrappedList(labelToken('Usages', ANSI.fgCyan), usageStr.split(', '));
    }
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
      out += `${INDENT}${labelToken('Summary', ANSI.fgDarkGray)} ${chunk.docmeta.doc}\n`;
    }
  }

  // Signature/identity are folded into the first line; omit the verbose block by default.
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
  if (explain) {
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
  }
  const awaits = toArray(chunk.docmeta?.awaits);
  if (awaits.length) {
    out += formatWrappedList(labelToken('Awaits', ANSI.fgBlue), awaits.slice(0, 6));
  }
  if (chunk.docmeta?.yields) {
    out += c.blue(`${INDENT}Yields: `) + 'yes' + '\n';
  }
  const dataflow = chunk.docmeta?.dataflow || null;
  if (dataflow) {
    const reads = toArray(dataflow.reads);
    if (reads.length) {
      out += formatWrappedList(labelToken('Reads', ANSI.fgDarkGray), reads.slice(0, 6));
    }
    const writes = toArray(dataflow.writes);
    if (writes.length) {
      out += formatWrappedList(labelToken('Writes', ANSI.fgDarkGray), writes.slice(0, 6));
    }
    const mutations = toArray(dataflow.mutations);
    if (mutations.length) {
      out += formatWrappedList(labelToken('Mutates', ANSI.fgDarkGray), mutations.slice(0, 6));
    }
    const aliases = toArray(dataflow.aliases);
    if (aliases.length) {
      out += formatWrappedList(labelToken('Aliases', ANSI.fgDarkGray), aliases.slice(0, 6));
    }
    const globals = toArray(dataflow.globals);
    if (globals.length) {
      out += formatWrappedList(labelToken('Globals', ANSI.fgDarkGray), globals.slice(0, 6));
    }
    const nonlocals = toArray(dataflow.nonlocals);
    if (nonlocals.length) {
      out += formatWrappedList(labelToken('Nonlocals', ANSI.fgDarkGray), nonlocals.slice(0, 6));
    }
  }
  const risk = chunk.docmeta?.risk || null;
  if (risk) {
    if (risk.severity) {
      out += c.red(`${INDENT}RiskLevel: ${risk.severity}`) + '\n';
    }
    const riskTags = toArray(risk.tags);
    if (riskTags.length) {
      out += formatWrappedList(labelToken('RiskTags', ANSI.fgRed), riskTags.slice(0, 6));
    }
    const riskFlows = toArray(risk.flows);
    if (riskFlows.length) {
      const flowList = riskFlows.slice(0, 3).map((flow) =>
        `${flow.source}->${flow.sink} (${flow.category})`
      );
      out += formatWrappedList(labelToken('RiskFlows', ANSI.fgRed), flowList);
    }
  }

  const lintIssues = toArray(chunk.lint);
  if (lintIssues.length) {
    out += c.red(`${INDENT}Lint: ${lintIssues.length} issues`) +
      (lintIssues.length ? c.gray(' | ') + lintIssues.slice(0, 2).map((lintMsg) => JSON.stringify(lintMsg.message)).join(', ') : '') + '\n';
  }

  const externalDocs = toArray(chunk.externalDocs);
  if (externalDocs.length) {
    out += formatWrappedList(labelToken('Docs', ANSI.fgBlue), externalDocs);
  }

  if (summaryState && rootDir && !chunk.docmeta?.record && allowSummary) {
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
      out += `${INDENT}${labelToken('Summary', ANSI.fgDarkGray)} ${bodySummary}\n`;
    }
  }

  if (explain && chunk.scoreBreakdown) {
    const explainLines = formatScoreBreakdown(chunk.scoreBreakdown, c);
    if (explainLines.length) {
      out += explainLines.join('\n') + '\n';
    }
  }
  out += '\n';
  if (canCache && formatCache && cacheKey) {
    formatCache.set(cacheKey, out);
  }
  return out;
}

