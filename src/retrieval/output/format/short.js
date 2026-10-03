import { formatScoreBreakdown } from '../explain.js';
import { getFormatShortCache } from '../cache.js';
import {
  ANSI,
  boldText,
  colorText,
  metaChip
} from './ansi.js';
import {
  alignTextColumns,
  buildChunkDisplayMetadata,
  looksKeywordishSnippet,
  normalizeSnippet,
  resolveFormatCache,
  writeFormatCache
} from './shared.js';

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
  const { formatCache, cacheKey, cached } = resolveFormatCache({
    canCache,
    getFormatCache: getFormatShortCache,
    chunk,
    index,
    mode,
    queryTokens,
    rx,
    matched,
    explain,
    layout,
    hyperlinkMode
  });
  if (cached) return cached;
  let out = '';
  const isNarrow = Boolean(layout?.isNarrow);
  const columns = Number.isFinite(layout?.columns) ? layout.columns : 108;
  const fullExplain = explain && explainTier === 'full';
  const rightAlign = (left, right, indent = '') => {
    return alignTextColumns({ left, right, columns, indent });
  };
  const {
    fileLabel,
    signaturePart,
    lastModLabel,
    fileStyled,
    primaryTitle
  } = buildChunkDisplayMetadata({
    chunk,
    mode,
    columns,
    minFileWidth: 18,
    pathWidthOffset: 2,
    rootDir,
    hyperlinkMode
  });
  const timeStyled = lastModLabel ? colorText(lastModLabel, ANSI.fgDarkGray) : '';
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
      ? (looksKeywordishSnippet(rawSnippet, 180) ? 'keywords' : 'comment')
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
  writeFormatCache({ canCache, formatCache, cacheKey, value: out });
  return out;
}

