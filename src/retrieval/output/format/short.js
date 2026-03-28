import { formatScoreBreakdown } from '../explain.js';
import { getFormatShortCache } from '../cache.js';
import {
  ANSI,
  boldText,
  colorText,
  hyperlinkFileLabel,
  italicColor,
  metaChip,
  stripAnsi
} from './ansi.js';
import {
  buildFormatCacheKey,
  buildQueryHash,
  formatLastModified,
  formatSignature,
  truncatePathMiddle
} from './display-meta.js';

const normalizeSnippet = (value, maxLength = 140) => {
  const raw = String(value || '').replace(/\s+/gu, ' ').trim();
  if (!raw) return '';
  return raw.length > maxLength ? `${raw.slice(0, Math.max(0, maxLength - 3))}...` : raw;
};

const looksKeywordish = (value) => {
  const text = normalizeSnippet(value, 180);
  if (!text) return false;
  if (/[.?!:;]/u.test(text)) return false;
  const tokens = text.split(/\s+/u).filter(Boolean);
  return tokens.length >= 4 && tokens.every((token) => /^[a-z0-9_\-/]+$/iu.test(token));
};

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
  explainTier = 'summary',
  color,
  queryTokens = [],
  rx,
  matched = false,
  rootDir = process.cwd(),
  hyperlinkMode = null,
  layout = null,
  _skipCache = false
}) {
  if (!chunk || !chunk.file) {
    return color.red(`   ${index + 1}. [Invalid result - missing chunk or file]`) + '\n';
  }
  const canCache = !_skipCache && !explain;
  const formatCache = canCache ? getFormatShortCache() : null;
  const queryHash = canCache ? buildQueryHash(queryTokens, rx) : '';
  const layoutSignature = `${layout?.cacheKey || ''}|links:${hyperlinkMode || 'auto'}`;
  let cacheKey = null;
  if (canCache && formatCache) {
    cacheKey = buildFormatCacheKey({ chunk, index, mode, queryHash, matched, explain, layoutSignature });
    const cached = formatCache.get(cacheKey);
    if (cached) return cached;
  }
  let out = '';
  const isNarrow = Boolean(layout?.isNarrow);
  const columns = Number.isFinite(layout?.columns) ? layout.columns : 108;
  const fullExplain = explain && explainTier === 'full';
  const rightAlign = (left, right, indent = '') => {
    if (!right) return `${indent}${left}`;
    const maxWidth = Math.max(24, columns - stripAnsi(indent).length);
    const leftWidth = stripAnsi(left).length;
    const rightWidth = stripAnsi(right).length;
    if (leftWidth + rightWidth + 2 > maxWidth) {
      return `${indent}${left}\n${indent}${right}`;
    }
    return `${indent}${left}${' '.repeat(Math.max(1, maxWidth - leftWidth - rightWidth))}${right}`;
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
  const maxFileWidth = Math.max(18, columns - (2 + (lastModLabel ? lastModLabel.length + 2 : 0)));
  const shortenedFilePath = truncatePathMiddle(chunk.file, Math.max(12, maxFileWidth - (lineRange ? lineRange.length + 1 : 0)));
  const filePathStyled = hyperlinkFileLabel({
    label: italicColor(shortenedFilePath, ANSI.fgLight),
    filePath: chunk.file,
    line: chunk.startLine,
    rootDir,
    mode: hyperlinkMode
  });
  const rangeStyled = lineRange ? colorText(lineRange, ANSI.fgLight) : '';
  const fileStyled = lineRange
    ? `${filePathStyled}${colorText(':', ANSI.fgLight)}${rangeStyled}`
    : filePathStyled;
  const timeStyled = lastModLabel ? colorText(lastModLabel, ANSI.fgDarkGray) : '';
  const primaryTitle = mode === 'extracted-prose'
    ? fileLabel
    : (mode === 'prose' ? (nameLabel || fileLabel) : displayName);
  const titleLine = primaryTitle === fileLabel
    ? `${colorText(`${index + 1}.`, ANSI.fgYellow)} ${fileStyled}`
    : `${colorText(`${index + 1}.`, ANSI.fgYellow)} ${boldText(primaryTitle)}`;
  if (primaryTitle === fileLabel) {
    out += rightAlign(titleLine, timeStyled);
  } else if (isNarrow) {
    out += titleLine;
    out += `\n${rightAlign(fileStyled, timeStyled, '  ')}`;
    if (signaturePart) {
      out += `\n  ${signaturePart}`;
    }
  } else {
    out += titleLine;
    out += `\n${rightAlign(fileStyled, timeStyled, '  ')}`;
    if (signaturePart) {
      out += `\n  ${signaturePart}`;
    }
  }
  const recordMeta = chunk.docmeta?.record || null;
  if (recordMeta) {
    const recordBits = [];
    if (recordMeta.severity) recordBits.push(recordMeta.severity);
    if (recordMeta.status) recordBits.push(recordMeta.status);
    const vulnId = recordMeta.vulnId || recordMeta.cve;
    if (vulnId) recordBits.push(vulnId);
    if (recordMeta.packageName) recordBits.push(recordMeta.packageName);
    if (recordBits.length) {
      out += `\n  ${recordBits.map((entry) => metaChip({ value: entry, valueColor: ANSI.fgYellow })).join(' ')}`;
    }
  }
  if (fullExplain && chunk.last_author) out += color.green(` by ${chunk.last_author}`);
  const highlightSnippet = (text) => (
    rx ? String(text || '').replace(rx, (m) => color.bold(color.yellow(m))) : String(text || '')
  );
  const rawSnippet = mode === 'records'
    ? normalizeSnippet(chunk.docmeta?.doc || chunk.headline)
    : (
      mode === 'extracted-prose'
        ? normalizeSnippet(chunk.docmeta?.commentExcerpts?.[0]?.text || chunk.docmeta?.commentExcerpt || chunk.headline)
        : (mode === 'prose' ? normalizeSnippet(chunk.headline || chunk.docmeta?.doc) : '')
    );
  const snippetLabel = mode === 'records'
    ? 'summary'
    : (mode === 'extracted-prose'
        ? (looksKeywordish(rawSnippet) ? 'keywords' : 'comment')
        : 'excerpt');
  const displaySnippet = rawSnippet && normalizeSnippet(primaryTitle).toLowerCase() === rawSnippet.toLowerCase()
    ? ''
    : rawSnippet;
  if (displaySnippet) {
    out += `\n  ${metaChip({
      value: snippetLabel,
      valueColor: snippetLabel === 'comment'
        ? ANSI.fgYellow
        : (snippetLabel === 'keywords' ? ANSI.fgOrange : ANSI.fgCyan)
    })} ${highlightSnippet(displaySnippet)}`;
  }

  if (matched && queryTokens.length && chunk.headline) {
    const matchedTokens = queryTokens.filter((tok) => chunk.headline.includes(tok));
    if (matchedTokens.length) {
      out += `\n  ${color.gray(`Matched: ${matchedTokens.join(', ')}`)}`;
    }
  }

  if (explain && chunk.scoreBreakdown) {
    const explainLines = formatScoreBreakdown(chunk.scoreBreakdown, color);
    if (explainLines.length) {
      out += '\n' + explainLines.join('\n');
    }
  }

  out = out.replace(/\n+$/u, '');
  out += '\n';
  if (canCache && formatCache && cacheKey) {
    formatCache.set(cacheKey, out);
  }
  return out;
}

