import { collectDeclaredReturnTypes } from '../../../index/metadata/docmeta.js';
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
  hyperlinkFileLabel,
  italicColor,
  labelToken,
  metaChip,
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
  truncatePathMiddle,
  toArray
} from './display-meta.js';

const normalizeSnippet = (value, maxLength = 220) => {
  const raw = String(value || '').replace(/\s+/gu, ' ').trim();
  if (!raw) return '';
  return raw.length > maxLength ? `${raw.slice(0, Math.max(0, maxLength - 3))}...` : raw;
};

const looksKeywordish = (value) => {
  const text = normalizeSnippet(value, 240);
  if (!text) return false;
  if (/[.?!:;]/u.test(text)) return false;
  const tokens = text.split(/\s+/u).filter(Boolean);
  return tokens.length >= 4 && tokens.every((token) => /^[a-z0-9_\-/]+$/iu.test(token));
};

const normalizeExcerptInfo = ({ chunk, mode, primaryTitle, displayName }) => {
  const commentEntries = Array.isArray(chunk?.docmeta?.commentExcerpts)
    ? chunk.docmeta.commentExcerpts
    : [];
  const commentExcerpt = commentEntries[0]?.text || chunk?.docmeta?.commentExcerpt || '';
  if (mode === 'records') {
    const summary = normalizeSnippet(
      chunk?.docmeta?.doc
      || chunk?.headline
      || chunk?.docmeta?.record?.summary
      || chunk?.docmeta?.record?.message,
      220
    );
    return summary ? { label: 'summary', text: summary } : null;
  }
  if (mode === 'extracted-prose') {
    const comment = normalizeSnippet(commentExcerpt || chunk?.headline, 220);
    if (!comment) return null;
    return {
      label: looksKeywordish(comment) ? 'keywords' : 'comment',
      text: comment
    };
  }
  if (mode === 'prose') {
    const excerpt = normalizeSnippet(chunk?.headline || chunk?.docmeta?.doc, 220);
    if (!excerpt) return null;
    const title = normalizeSnippet(primaryTitle || displayName, 220);
    if (excerpt.toLowerCase() === title.toLowerCase()) {
      return { label: 'section', text: excerpt };
    }
    return { label: 'excerpt', text: excerpt };
  }
  return null;
};

const summarizeItems = (items, limit) => {
  const values = toArray(items).map((entry) => String(entry).trim()).filter(Boolean);
  if (!values.length) return [];
  const cap = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : values.length;
  const trimmed = values.slice(0, cap);
  if (values.length > trimmed.length) {
    trimmed.push(`+${values.length - trimmed.length} more`);
  }
  return trimmed;
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
  explainTier = 'summary',
  color,
  queryTokens = [],
  rx,
  matched = false,
  rootDir,
  hyperlinkMode = null,
  summaryState,
  allowSummary = true,
  layout = null,
  _skipCache = false
}) {
  if (!chunk || !chunk.file) {
    return color.red(`   ${index + 1}. [Invalid result - missing chunk or file]`) + '\n';
  }
  const canCache = !_skipCache && !explain && (!summaryState || !allowSummary);
  const formatCache = canCache ? getFormatFullCache() : null;
  const queryHash = canCache ? buildQueryHash(queryTokens, rx) : '';
  const layoutSignature = `${layout?.cacheKey || ''}|links:${hyperlinkMode || 'auto'}`;
  let cacheKey = null;
  if (canCache && formatCache) {
    cacheKey = buildFormatCacheKey({ chunk, index, mode, queryHash, matched, explain, layoutSignature });
    const cached = formatCache.get(cacheKey);
    if (cached) return cached;
  }
  const c = color;
  let out = '';
  const columns = Number.isFinite(layout?.columns) ? layout.columns : 108;
  const wrapWidth = Math.max(42, Math.min(Number.isFinite(layout?.contentWidth) ? layout.contentWidth : 104, columns - 6));
  const fullExplain = explain && explainTier === 'full';
  const joinInlineParts = (parts, { indent = INDENT, maxWidth = wrapWidth, separator = ` ${colorText('•', ANSI.fgDarkGray)} ` } = {}) => {
    const filtered = parts.filter(Boolean);
    if (!filtered.length) return [];
    const lines = [];
    let line = `${indent}${filtered[0]}`;
    for (const part of filtered.slice(1)) {
      const candidate = `${line}${separator}${part}`;
      if (stripAnsi(candidate).length > maxWidth && line) {
        lines.push(line);
        line = `${indent}${part}`;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  const alignRight = (left, right) => {
    if (!right) return `${INDENT}${left}\n`;
    const maxWidth = Math.max(24, columns - stripAnsi(INDENT).length);
    const leftWidth = stripAnsi(left).length;
    const rightWidth = stripAnsi(right).length;
    if (leftWidth + rightWidth + 2 > maxWidth) {
      return `${INDENT}${left}\n${INDENT}${right}\n`;
    }
    return `${INDENT}${left}${' '.repeat(Math.max(1, maxWidth - leftWidth - rightWidth))}${right}\n`;
  };
  const alignInline = (left, right) => {
    if (!right) return `${left}\n`;
    const maxWidth = Math.max(24, columns);
    const leftWidth = stripAnsi(left).length;
    const rightWidth = stripAnsi(right).length;
    if (leftWidth + rightWidth + 2 > maxWidth) {
      return `${left}\n${INDENT}${right}\n`;
    }
    return `${left}${' '.repeat(Math.max(1, maxWidth - leftWidth - rightWidth))}${right}\n`;
  };

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
  const maxFileWidth = Math.max(22, columns - (stripAnsi(INDENT).length + (lastModLabel ? lastModLabel.length + 2 : 0)));
  const shortenedFilePath = truncatePathMiddle(chunk.file, Math.max(12, maxFileWidth - (lineRange ? lineRange.length + 1 : 0)));
  const filePathStyled = hyperlinkFileLabel({
    label: italicColor(shortenedFilePath, ANSI.fgLight),
    filePath: chunk.file,
    line: chunk.startLine,
    rootDir: rootDir || process.cwd(),
    mode: hyperlinkMode
  });
  const rangeStyled = lineRange ? colorText(lineRange, ANSI.fgLight) : '';
  const fileStyled = lineRange
    ? `${filePathStyled}${colorText(':', ANSI.fgLight)}${rangeStyled}`
    : filePathStyled;
  const timeStyled = lastModLabel ? colorText(lastModLabel, ANSI.fgDarkGray) : '';
  const rankStyled = colorText(`${index + 1}.`, ANSI.fgYellow);
  const primaryTitle = mode === 'extracted-prose'
    ? fileLabel
    : (mode === 'prose' ? (nameLabel || fileLabel) : displayName);
  const primaryTitleStyled = primaryTitle === fileLabel
    ? `${filePathStyled}${lineRange ? `${colorText(':', ANSI.fgLight)}${rangeStyled}` : ''}`
    : boldText(primaryTitle);
  out += primaryTitle === fileLabel
    ? alignInline(`${rankStyled} ${primaryTitleStyled}`, timeStyled)
    : `${rankStyled} ${primaryTitleStyled}\n`;
  if (primaryTitle !== fileLabel) {
    out += alignRight(fileStyled, timeStyled);
  }

  const highlightHeadline = (text) => {
    const raw = String(text || '').trim();
    if (!raw) return '';
    return rx ? raw.replace(rx, (match) => c.bold(c.yellow(match))) : raw;
  };
  const excerptInfo = normalizeExcerptInfo({ chunk, mode, primaryTitle, displayName });
  if (excerptInfo?.text) {
    const proseLabel = metaChip({
      label: '',
      value: excerptInfo.label,
      valueColor: excerptInfo.label === 'comment'
        ? ANSI.fgYellow
        : (excerptInfo.label === 'keywords' ? ANSI.fgOrange : ANSI.fgCyan)
    });
    out += `${INDENT}${proseLabel} ${colorText(highlightHeadline(excerptInfo.text), ANSI.fgBrightWhite)}\n`;
  }

  if (fullExplain) {
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
  const declaredReturns = collectDeclaredReturnTypes(chunk.docmeta);
  if (declaredReturns.length) {
    summaryBits.push(
      metaChip({
        label: 'returns',
        value: declaredReturns.join(' | '),
        labelColor: ANSI.fgDarkGreen,
        valueColor: ANSI.fgLightGreen
      })
    );
  } else if (chunk.docmeta?.returnsValue) {
    summaryBits.push(
      metaChip({
        label: 'returns',
        value: 'value',
        labelColor: ANSI.fgDarkGreen,
        valueColor: ANSI.fgLightGreen
      })
    );
  }
  const throwsList = toArray(chunk.docmeta?.throws);
  if (throwsList.length) {
    summaryBits.push(
      metaChip({
        label: 'throws',
        value: throwsList.slice(0, 6).join(', '),
        labelColor: ANSI.fgDarkOrange
      })
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
    summaryBits.push(metaChip({
      label: 'control',
      value: controlValue,
      labelColor: ANSI.fgDarkerCyan
    }));
  }
  const codeMetaLines = mode === 'code'
    ? joinInlineParts([
      signaturePart ? metaChip({ label: 'sig', value: signaturePart, labelColor: ANSI.fgLightBlue }) : '',
      ...summaryBits
    ], { maxWidth: wrapWidth, separator: ' ' })
    : [];
  if (mode === 'code' && codeMetaLines.length) {
    out += `${codeMetaLines.join('\n')}\n`;
  } else if (summaryBits.length) {
    out += `${INDENT}${summaryBits.join(' ')}\n`;
  }

  const backgroundSections = [];
  const pushBackgroundSection = (lines, bg) => {
    if (lines.length) backgroundSections.push({ lines, bg });
  };
  const formatFileItem = (item) => hyperlinkFileLabel({
    label: italicColor(String(item), ANSI.fgLight),
    filePath: String(item),
    rootDir: rootDir || process.cwd(),
    mode: hyperlinkMode
  });
  const formatExportItem = (item) => colorText(String(item), ANSI.fgBrightWhite);
  const formatCallValue = (value) => {
    const raw = String(value).trim();
    if (!raw) return '';
    if (raw === '...') return colorText(raw, ANSI.fgDarkGray);
    const match = raw.match(/^(.*?)(\s*\((\d+)\))$/);
    if (match) {
      const name = match[1].trim();
      const count = match[3];
      return `${colorText(name, ANSI.fgBrightWhite)} ${colorText(`(${count})`, ANSI.fgLightBlue)}`;
    }
    return colorText(raw, ANSI.fgBrightWhite);
  };
  const formatCallSummary = (text) => {
    const raw = String(text);
    const match = raw.match(/^([A-Za-z0-9_$\.]+)(.*)$/);
    if (match) {
      return `${colorText(match[1], ANSI.fgLightBlue)}${colorText(match[2], ANSI.fgBrightWhite)}`;
    }
    return colorText(raw, ANSI.fgBrightWhite);
  };

  const importItems = toArray(chunk.imports).length
    ? toArray(chunk.imports)
    : toArray(chunk.codeRelations?.imports);
  const importLines = importItems.length
    ? buildWrappedLines(labelToken('Imports', ANSI.fgPink), importItems.map(formatFileItem), { maxWidth: wrapWidth })
    : [];
  pushBackgroundSection(importLines, BG_IMPORTS);

  const exportItems = toArray(chunk.exports).length
    ? toArray(chunk.exports)
    : toArray(chunk.codeRelations?.exports);
  const exportLines = exportItems.length
    ? buildWrappedLines(labelToken('Exports', ANSI.fgCyan), exportItems.map(formatExportItem), { maxWidth: wrapWidth })
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
    const maxEntries = fullExplain ? 8 : 4;
    const rendered = entries.slice(0, maxEntries).map(([callee, count]) => (
      count > 1 ? `${callee} (${count})` : callee
    ));
    const trimmed = entries.length > rendered.length;
    if (rendered.length) {
      const callerName = callers.size === 1 ? Array.from(callers)[0] : '';
      const callerPrefixStyled = callerName
        ? `${colorText(callerName, ANSI.fgLightBlue)}${colorText(' ->', ANSI.fgBrightWhite)}`
        : '';
      const values = rendered.map(formatCallValue);
      if (trimmed) values.push(formatCallValue('...'));
      const callLines = buildWrappedLines(
        `${labelToken('Calls', ANSI.fgBlue)}${callerPrefixStyled ? ` ${callerPrefixStyled}` : ''}`,
        values,
        { maxWidth: wrapWidth }
      );
      pushBackgroundSection(callLines, BG_CALLS);
    }
  }
  const callSummaries = toArray(chunk.codeRelations?.callSummaries);
  if (callSummaries.length) {
    const summaries = callSummaries.slice(0, fullExplain ? 3 : 2).map((summary) => {
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
    ? buildWrappedLines(labelToken('Import Links', ANSI.fgGreen), importLinkItems.map(formatFileItem), { maxWidth: wrapWidth })
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
  if (fullExplain && modifierParts.length) {
    out += formatWrappedList(labelToken('Modifiers', ANSI.fgDarkGray), modifierParts, { maxWidth: wrapWidth });
  }
  const decorators = toArray(chunk.docmeta?.decorators);
  if (fullExplain && decorators.length) {
    out += formatWrappedList(labelToken('Decorators', ANSI.fgMagenta), decorators, { maxWidth: wrapWidth });
  }
  const bases = chunk.docmeta?.extends || chunk.docmeta?.bases || [];
  if (fullExplain && Array.isArray(bases) && bases.length) {
    out += formatWrappedList(labelToken('Extends', ANSI.fgMagenta), bases, { maxWidth: wrapWidth });
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

    if (usageStr.length) out += formatWrappedList(labelToken('Usages', ANSI.fgCyan), usageStr.split(', '), { maxWidth: wrapWidth });
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

      if (usageStr.length) out += formatWrappedList(labelToken('Usages', ANSI.fgCyan), usageStr.split(', '), { maxWidth: wrapWidth });
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
      out += `${INDENT}${recordParts.map((entry) => metaChip({
        value: entry,
        valueColor: ANSI.fgYellow
      })).join(' ')}\n`;
    }
    const routeParts = [];
    if (recordMeta.service) routeParts.push(`service=${recordMeta.service}`);
    if (recordMeta.env) routeParts.push(`env=${recordMeta.env}`);
    if (recordMeta.team) routeParts.push(`team=${recordMeta.team}`);
    if (recordMeta.owner) routeParts.push(`owner=${recordMeta.owner}`);
    if (recordMeta.assetId) routeParts.push(`asset=${recordMeta.assetId}`);
    if (fullExplain && routeParts.length) {
      out += c.gray('   Route: ') + routeParts.join(', ') + '\n';
    }
    if (chunk.docmeta?.doc && !excerptInfo?.text) {
      out += `${INDENT}${labelToken('Summary', ANSI.fgDarkGray)} ${normalizeSnippet(chunk.docmeta.doc, 220)}\n`;
    }
  }

  // Signature/identity are folded into the first line; omit the verbose block by default.
  const commentEntries = Array.isArray(chunk.docmeta?.commentExcerpts)
    ? chunk.docmeta.commentExcerpts
    : null;
  const commentText = (commentEntries && commentEntries.length)
    ? commentEntries[0]?.text
    : chunk.docmeta?.commentExcerpt;
  if (fullExplain && commentText && mode === 'code') {
    const normalized = String(commentText).replace(/\s+/g, ' ').trim();
    const snippet = normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
    out += c.gray('   Comment: ') + snippet + '\n';
  }
  if (fullExplain) {
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
  if (fullExplain && awaits.length) {
    out += formatWrappedList(labelToken('Awaits', ANSI.fgBlue), awaits.slice(0, 6), { maxWidth: wrapWidth });
  }
  if (fullExplain && chunk.docmeta?.yields) {
    out += c.blue(`${INDENT}Yields: `) + 'yes' + '\n';
  }
  const dataflow = chunk.docmeta?.dataflow || null;
  if (dataflow) {
    const reads = toArray(dataflow.reads);
    if (reads.length) {
      out += formatWrappedList(labelToken('Reads', ANSI.fgDarkGray), summarizeItems(reads, fullExplain ? 6 : 4), { maxWidth: wrapWidth });
    }
    const writes = toArray(dataflow.writes);
    if (writes.length) {
      out += formatWrappedList(labelToken('Writes', ANSI.fgDarkGray), summarizeItems(writes, fullExplain ? 6 : 4), { maxWidth: wrapWidth });
    }
    const mutations = toArray(dataflow.mutations);
    if (fullExplain && mutations.length) {
      out += formatWrappedList(labelToken('Mutates', ANSI.fgDarkGray), summarizeItems(mutations, 6), { maxWidth: wrapWidth });
    }
    const aliases = toArray(dataflow.aliases);
    if (fullExplain && aliases.length) {
      out += formatWrappedList(labelToken('Aliases', ANSI.fgDarkGray), summarizeItems(aliases, 6), { maxWidth: wrapWidth });
    }
    const globals = toArray(dataflow.globals);
    if (fullExplain && globals.length) {
      out += formatWrappedList(labelToken('Globals', ANSI.fgDarkGray), globals.slice(0, 6), { maxWidth: wrapWidth });
    }
    const nonlocals = toArray(dataflow.nonlocals);
    if (fullExplain && nonlocals.length) {
      out += formatWrappedList(labelToken('Nonlocals', ANSI.fgDarkGray), nonlocals.slice(0, 6), { maxWidth: wrapWidth });
    }
  }
  const risk = chunk.docmeta?.risk || null;
  if (fullExplain && risk) {
    if (risk.severity) {
      out += c.red(`${INDENT}RiskLevel: ${risk.severity}`) + '\n';
    }
    const riskTags = toArray(risk.tags);
    if (riskTags.length) {
      out += formatWrappedList(labelToken('RiskTags', ANSI.fgRed), riskTags.slice(0, 6), { maxWidth: wrapWidth });
    }
    const riskFlows = toArray(risk.flows);
    if (riskFlows.length) {
      const flowList = riskFlows.slice(0, 3).map((flow) =>
        `${flow.source}->${flow.sink} (${flow.category})`
      );
      out += formatWrappedList(labelToken('RiskFlows', ANSI.fgRed), flowList, { maxWidth: wrapWidth });
    }
  }

  const lintIssues = toArray(chunk.lint);
  if (fullExplain && lintIssues.length) {
    out += c.red(`${INDENT}Lint: ${lintIssues.length} issues`) +
      (lintIssues.length ? c.gray(' | ') + lintIssues.slice(0, 2).map((lintMsg) => JSON.stringify(lintMsg.message)).join(', ') : '') + '\n';
  }

  const externalDocs = toArray(chunk.externalDocs);
  if (fullExplain && externalDocs.length) {
    out += formatWrappedList(labelToken('Docs', ANSI.fgBlue), externalDocs, { maxWidth: wrapWidth });
  }

  if (summaryState && rootDir && !chunk.docmeta?.record && allowSummary && (!excerptInfo?.text || mode === 'code')) {
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
      out += `${INDENT}${labelToken('Summary', ANSI.fgDarkGray)} ${normalizeSnippet(bodySummary, Math.max(36, wrapWidth - 14))}\n`;
    }
  }

  if (explain && chunk.scoreBreakdown) {
    const explainLines = formatScoreBreakdown(chunk.scoreBreakdown, c);
    if (explainLines.length) {
      out += explainLines.join('\n') + '\n';
    }
  }
  out = out.replace(/\n+$/u, '');
  out += '\n';
  if (canCache && formatCache && cacheKey) {
    formatCache.set(cacheKey, out);
  }
  return out;
}

