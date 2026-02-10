import { collectDeclaredReturnTypes } from '../../shared/docmeta.js';
import { formatScoreBreakdown } from './explain.js';
import { getBodySummary } from './summary.js';
import { getFormatFullCache, getFormatShortCache } from './cache.js';
import { sha1 } from '../../shared/hash.js';
import { buildLocalCacheKey } from '../../shared/cache-key.js';
import { ANSI, applyLineBackground, stripAnsi as stripAnsiShared } from '../../shared/cli/ansi-utils.js';

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

const formatLastModified = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  if (diffMs <= weekMs) {
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = String(date.getFullYear()).slice(-2);
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${month}/${day}/${year} ${hours}:${minutes}${period}`;
};

const INDENT = '     ';

const stripAnsi = (value) => stripAnsiShared(String(value));

const styleText = (text, ...codes) => (
  codes.length ? `${codes.join('')}${text}${ANSI.reset}` : String(text)
);
const colorText = (text, color) => (color ? styleText(text, color) : String(text));
const boldText = (text) => styleText(text, ANSI.bold);
const italicColor = (text, color) => styleText(text, ANSI.italic, color);
const labelToken = (label, color = '') => (
  `${ANSI.bold}${color}${label}${ANSI.fgBrightWhite}:${ANSI.reset}`
);

const BG_IMPORTS = '\x1b[48;5;52m';
const BG_EXPORTS = '\x1b[48;5;23m';
const BG_CALLS = '\x1b[48;5;17m';
const BG_CALL_SUMMARY = '\x1b[48;5;17m';
const BG_IMPORT_LINKS = '\x1b[48;5;22m';

const buildQueryHash = (queryTokens, rx) => {
  const tokens = Array.isArray(queryTokens) ? queryTokens.join('|') : '';
  const rxSig = rx ? `${rx.source}/${rx.flags}` : '';
  return sha1(`${tokens}:${rxSig}`);
};

const buildFormatCacheKey = ({
  chunk,
  index,
  mode,
  queryHash,
  matched,
  explain
}) => buildLocalCacheKey({
  namespace: 'format',
  payload: {
    mode,
    index,
    file: chunk.file,
    start: chunk.start,
    end: chunk.end,
    matched: Boolean(matched),
    explain: Boolean(explain),
    queryHash
  }
}).key;

const buildWrappedLines = (label, items, { indent = INDENT, maxWidth = 110 } = {}) => {
  if (!Array.isArray(items) || !items.length) return [];
  const prefix = `${indent}${label} `;
  const pad = ' '.repeat(stripAnsi(prefix).length);
  let line = prefix;
  const lines = [];
  items.forEach((item, index) => {
    const text = String(item);
    const sep = (line === prefix) ? '' : ', ';
    if (stripAnsi(line + sep + text).length > maxWidth && line !== prefix) {
      lines.push(line.trimEnd());
      line = pad + text;
    } else {
      line += sep + text;
    }
    if (index === items.length - 1) {
      lines.push(line);
    }
  });
  return lines;
};

const formatWrappedList = (label, items, options) => {
  const lines = buildWrappedLines(label, items, options);
  if (!lines.length) return '';
  return lines.map((line) => `${line}\n`).join('');
};

const buildVerticalLines = (label, items, { indent = INDENT } = {}) => {
  if (!Array.isArray(items) || !items.length) return [];
  const prefix = `${indent}${label} `;
  const pad = ' '.repeat(stripAnsi(prefix).length);
  const lines = [`${prefix}${items[0]}`];
  for (const item of items.slice(1)) {
    lines.push(`${pad}${item}`);
  }
  return lines;
};

const formatVerticalList = (label, items, options) => {
  const lines = buildVerticalLines(label, items, options);
  if (!lines.length) return '';
  return lines.map((line) => `${line}\n`).join('');
};

const formatControlFlow = (controlFlow) => {
  if (!controlFlow) return [];
  const parts = [];
  const push = (label, value) => {
    if (!Number.isFinite(value) || value <= 0) return;
    let plural = value === 1 ? label : `${label}s`;
    if (label === 'Branch' && value !== 1) plural = 'Branches';
    parts.push({ label: plural, value });
  };
  push('Branch', controlFlow.branches);
  push('Loop', controlFlow.loops);
  push('Return', controlFlow.returns);
  push('Break', controlFlow.breaks);
  push('Continue', controlFlow.continues);
  push('Throw', controlFlow.throws);
  push('Await', controlFlow.awaits);
  push('Yield', controlFlow.yields);
  return parts;
};

const formatSignature = (signature, nameLabel) => {
  const raw = String(signature || '').trim();
  if (!raw) return '';
  const styleNameArgs = (name, args, rest = '') => {
    const argsStyled = args.length
      ? `${ANSI.bold}${ANSI.fgBrightWhite}${args}${ANSI.reset}`
      : '';
    return `${boldText(name)}${boldText('(')}${argsStyled}${boldText(')')}${rest}`;
  };
  if (nameLabel) {
    const index = raw.indexOf(nameLabel);
    if (index !== -1) {
      const before = raw.slice(0, index);
      const after = raw.slice(index + nameLabel.length);
      if (after.startsWith('(')) {
        const closeIdx = after.indexOf(')');
        if (closeIdx !== -1) {
          const args = after.slice(1, closeIdx);
          const rest = after.slice(closeIdx + 1);
          return `${before}${styleNameArgs(nameLabel, args, rest)}`;
        }
      }
      return `${before}${boldText(nameLabel)}${after}`;
    }
  }
  const match = raw.match(/^([A-Za-z0-9_$\.]+)\((.*)\)(.*)$/);
  if (match) {
    return styleNameArgs(match[1], match[2], match[3]);
  }
  return raw;
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
  if (chunk.docmeta?.throws?.length) {
    summaryBits.push(
      `${labelToken('Throws', ANSI.fgDarkOrange)} ${chunk.docmeta.throws.slice(0, 6).join(', ')}`
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

  const importItems = chunk.imports?.length
    ? chunk.imports
    : (chunk.codeRelations?.imports?.length ? chunk.codeRelations.imports : []);
  const importLines = importItems.length
    ? buildWrappedLines(labelToken('Imports', ANSI.fgPink), importItems.map(formatFileItem))
    : [];
  pushBackgroundSection(importLines, BG_IMPORTS);

  const exportItems = chunk.exports?.length
    ? chunk.exports
    : (chunk.codeRelations?.exports?.length ? chunk.codeRelations.exports : []);
  const exportLines = exportItems.length
    ? buildWrappedLines(labelToken('Exports', ANSI.fgCyan), exportItems.map(formatExportItem))
    : [];
  pushBackgroundSection(exportLines, BG_EXPORTS);

  if (chunk.codeRelations?.calls?.length) {
    const callPairs = chunk.codeRelations.calls;
    const callers = new Set();
    const calleeCounts = new Map();
    for (const [caller, callee] of callPairs) {
      if (caller) callers.add(caller);
      if (!callee) continue;
      calleeCounts.set(callee, (calleeCounts.get(callee) || 0) + 1);
    }
    const entries = Array.from(calleeCounts.entries())
      .sort((a, b) => (b[1] - a[1]) || String(a[0]).localeCompare(String(b[0])));
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
  if (chunk.codeRelations?.callSummaries?.length) {
    const summaries = chunk.codeRelations.callSummaries.slice(0, 3).map((summary) => {
      const args = Array.isArray(summary.args) && summary.args.length ? summary.args.join(', ') : '';
      const returns = Array.isArray(summary.returnTypes) && summary.returnTypes.length
        ? ` -> ${summary.returnTypes.join(' | ')}`
        : '';
      return formatCallSummary(`${summary.name}(${args})${returns}`);
    });
    const summaryLines = buildVerticalLines(labelToken('Call Summary', ANSI.fgBlue), summaries);
    pushBackgroundSection(summaryLines, BG_CALL_SUMMARY);
  }

  const importLinkItems = chunk.importLinks?.length
    ? chunk.importLinks
    : (chunk.codeRelations?.importLinks?.length ? chunk.codeRelations.importLinks : []);
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
  if (chunk.docmeta?.decorators?.length) {
    out += formatWrappedList(labelToken('Decorators', ANSI.fgMagenta), chunk.docmeta.decorators);
  }
  const bases = chunk.docmeta?.extends || chunk.docmeta?.bases || [];
  if (Array.isArray(bases) && bases.length) {
    out += formatWrappedList(labelToken('Extends', ANSI.fgMagenta), bases);
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

    if (usageStr.length) out += formatWrappedList(labelToken('Usages', ANSI.fgCyan), usageStr.split(', '));
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

    if (usageStr.length) out += formatWrappedList(labelToken('Usages', ANSI.fgCyan), usageStr.split(', '));
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
  if (chunk.docmeta?.awaits?.length) {
    out += formatWrappedList(labelToken('Awaits', ANSI.fgBlue), chunk.docmeta.awaits.slice(0, 6));
  }
  if (chunk.docmeta?.yields) {
    out += c.blue(`${INDENT}Yields: `) + 'yes' + '\n';
  }
  const dataflow = chunk.docmeta?.dataflow || null;
  if (dataflow) {
    if (dataflow.reads?.length) {
      out += formatWrappedList(labelToken('Reads', ANSI.fgDarkGray), dataflow.reads.slice(0, 6));
    }
    if (dataflow.writes?.length) {
      out += formatWrappedList(labelToken('Writes', ANSI.fgDarkGray), dataflow.writes.slice(0, 6));
    }
    if (dataflow.mutations?.length) {
      out += formatWrappedList(labelToken('Mutates', ANSI.fgDarkGray), dataflow.mutations.slice(0, 6));
    }
    if (dataflow.aliases?.length) {
      out += formatWrappedList(labelToken('Aliases', ANSI.fgDarkGray), dataflow.aliases.slice(0, 6));
    }
    if (dataflow.globals?.length) {
      out += formatWrappedList(labelToken('Globals', ANSI.fgDarkGray), dataflow.globals.slice(0, 6));
    }
    if (dataflow.nonlocals?.length) {
      out += formatWrappedList(labelToken('Nonlocals', ANSI.fgDarkGray), dataflow.nonlocals.slice(0, 6));
    }
  }
  const risk = chunk.docmeta?.risk || null;
  if (risk) {
    if (risk.severity) {
      out += c.red(`${INDENT}RiskLevel: ${risk.severity}`) + '\n';
    }
    if (risk.tags?.length) {
      out += formatWrappedList(labelToken('RiskTags', ANSI.fgRed), risk.tags.slice(0, 6));
    }
    if (risk.flows?.length) {
      const flowList = risk.flows.slice(0, 3).map((flow) =>
        `${flow.source}->${flow.sink} (${flow.category})`
      );
      out += formatWrappedList(labelToken('RiskFlows', ANSI.fgRed), flowList);
    }
  }

  if (chunk.lint?.length) {
    out += c.red(`${INDENT}Lint: ${chunk.lint.length} issues`) +
      (chunk.lint.length ? c.gray(' | ') + chunk.lint.slice(0, 2).map((lintMsg) => JSON.stringify(lintMsg.message)).join(', ') : '') + '\n';
  }

  if (chunk.externalDocs?.length) {
    out += formatWrappedList(labelToken('Docs', ANSI.fgBlue), chunk.externalDocs);
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
  matched = false,
  _skipCache = false
}) {
  if (!chunk || !chunk.file) {
    return color.red(`   ${index + 1}. [Invalid result - missing chunk or file]`) + '\n';
  }
  const canCache = !_skipCache && !explain;
  const formatCache = canCache ? getFormatShortCache() : null;
  const queryHash = canCache ? buildQueryHash(queryTokens, rx) : '';
  let cacheKey = null;
  if (canCache && formatCache) {
    cacheKey = buildFormatCacheKey({ chunk, index, mode, queryHash, matched, explain });
    const cached = formatCache.get(cacheKey);
    if (cached) return cached;
  }
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
  out += line1Parts.join(' - ');
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
  if (explain && chunk.last_author) out += color.green(` by ${chunk.last_author}`);
  if (chunk.headline && rx) {
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
  if (canCache && formatCache && cacheKey) {
    formatCache.set(cacheKey, out);
  }
  return out;
}
