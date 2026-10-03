import {
  ANSI,
  colorText,
  hyperlinkFileLabel,
  italicColor,
  stripAnsi
} from './ansi.js';
import {
  buildFormatCacheKey,
  buildQueryHash,
  formatLastModified,
  formatSignature,
  truncatePathMiddle
} from './display-meta.js';

export const normalizeSnippet = (value, maxLength = 140) => {
  const raw = String(value || '').replace(/\s+/gu, ' ').trim();
  if (!raw) return '';
  return raw.length > maxLength ? `${raw.slice(0, Math.max(0, maxLength - 3))}...` : raw;
};

export const looksKeywordishSnippet = (value, maxLength) => {
  const text = normalizeSnippet(value, maxLength);
  if (!text) return false;
  if (/[.?!:;]/u.test(text)) return false;
  const tokens = text.split(/\s+/u).filter(Boolean);
  return tokens.length >= 4 && tokens.every((token) => /^[a-z0-9_\-/]+$/iu.test(token));
};

export const resolveFormatCache = ({
  canCache,
  getFormatCache,
  chunk,
  index,
  mode,
  queryTokens,
  rx,
  matched,
  explain,
  layout,
  hyperlinkMode
}) => {
  const formatCache = canCache ? getFormatCache() : null;
  const queryHash = canCache ? buildQueryHash(queryTokens, rx) : '';
  const layoutSignature = `${layout?.cacheKey || ''}|links:${hyperlinkMode || 'auto'}`;
  let cacheKey = null;
  if (canCache && formatCache) {
    cacheKey = buildFormatCacheKey({ chunk, index, mode, queryHash, matched, explain, layoutSignature });
    const cached = formatCache.get(cacheKey);
    if (cached) return { formatCache, cacheKey, cached };
  }
  return { formatCache, cacheKey, cached: null };
};

export const writeFormatCache = ({ canCache, formatCache, cacheKey, value }) => {
  if (canCache && formatCache && cacheKey) {
    formatCache.set(cacheKey, value);
  }
};

export const alignTextColumns = ({
  left,
  right,
  columns,
  indent = '',
  wrapIndent = indent,
  trailingNewline = false
}) => {
  const suffix = trailingNewline ? '\n' : '';
  if (!right) return `${indent}${left}${suffix}`;
  const maxWidth = Math.max(24, columns - stripAnsi(indent).length);
  const leftWidth = stripAnsi(left).length;
  const rightWidth = stripAnsi(right).length;
  if (leftWidth + rightWidth + 2 > maxWidth) {
    return `${indent}${left}\n${wrapIndent}${right}${suffix}`;
  }
  return `${indent}${left}${' '.repeat(Math.max(1, maxWidth - leftWidth - rightWidth))}${right}${suffix}`;
};

export const buildChunkDisplayMetadata = ({
  chunk,
  mode,
  columns,
  minFileWidth,
  pathWidthOffset,
  rootDir,
  hyperlinkMode
}) => {
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
  const maxFileWidth = Math.max(
    minFileWidth,
    columns - (pathWidthOffset + (lastModLabel ? lastModLabel.length + 2 : 0))
  );
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
  const primaryTitle = mode === 'extracted-prose'
    ? fileLabel
    : (mode === 'prose' ? (nameLabel || fileLabel) : displayName);

  return {
    lineRange,
    fileLabel,
    nameLabel,
    displayName,
    signaturePart,
    lastModLabel,
    filePathStyled,
    rangeStyled,
    fileStyled,
    primaryTitle
  };
};
