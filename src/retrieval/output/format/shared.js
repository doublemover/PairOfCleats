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
  truncatePathMiddle,
  truncateVisibleText
} from './display-meta.js';

export const normalizeSnippet = (value, maxLength = 140) => {
  const raw = String(value || '').replace(/\s+/gu, ' ').trim();
  if (!raw) return '';
  const limit = Number(maxLength);
  if (Number.isSafeInteger(limit) && limit >= 0) return truncateVisibleText(raw, limit);
  return raw.length > maxLength ? `${raw.slice(0, Math.max(0, maxLength - 3))}...` : raw;
};

const terminalSegments = new Intl.Segmenter('en', { granularity: 'grapheme' });
const wideGlyph = /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u;
const segmentWidth = (segment) => {
  if (/^[\p{Mark}\u200c\u200d\ufe0e\ufe0f]+$/u.test(segment)) return 0;
  return wideGlyph.test(segment) || /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(segment) ? 2 : 1;
};

/** Wrap overflowing terminal lines without splitting a grapheme or an escape.
 * Long lines lose styling rather than carrying partial SGR/OSC state across rows.
 * Wide glyphs and emoji use two cells; combining clusters remain intact.
 */
export const wrapTerminalText = (value, columns = 108) => {
  const width = Math.max(8, Math.floor(columns));
  return String(value).split('\n').map((line) => {
    const plain = stripAnsi(line);
    // Keep opaque continuation tokens copyable, even in a narrow terminal.
    if (plain.startsWith('next --cursor ')) return line;
    const segments = Array.from(terminalSegments.segment(plain), ({ segment }) => segment);
    if (segments.reduce((sum, segment) => sum + segmentWidth(segment), 0) <= width) return line;
    const lines = [];
    let row = '';
    let used = 0;
    for (const segment of segments) {
      const cells = segmentWidth(segment);
      if (used + cells > width && row) {
        let breakAt = -1;
        for (const part of terminalSegments.segment(row)) {
          if (part.segment === ' ') breakAt = part.index;
        }
        const tail = row.slice(breakAt + 1);
        const tailWidth = Array.from(terminalSegments.segment(tail), (entry) => segmentWidth(entry.segment))
          .reduce((sum, entry) => sum + entry, 0);
        if (breakAt > 2 && tailWidth + cells + 2 <= width) {
          lines.push(row.slice(0, breakAt));
          row = `  ${tail}`;
          used = tailWidth + 2;
        } else {
          lines.push(row);
          row = '  ';
          used = 2;
        }
      }
      row += segment;
      used += cells;
    }
    if (row) lines.push(row);
    return lines.join('\n');
  }).join('\n');
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
  const layoutSignature = `${layout?.cacheKey || ''}|links:${hyperlinkMode || 'auto'}|styled:${layout?.styled !== false}`;
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
  const maxWidth = Math.max(8, columns - stripAnsi(indent).length);
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
  const recordSource = chunk.recordSource || chunk.metaV2?.recordSource;
  const recordDisplay = recordSource?.storagePath === chunk.file && typeof recordSource.displayPath === 'string'
    ? `${recordSource.kind}:${recordSource.displayPath}` : null;
  const displayPath = recordDisplay || chunk.file;
  const fileLabel = lineRange ? `${displayPath}:${lineRange}` : displayPath;
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
    Math.min(minFileWidth, Math.max(8, columns - pathWidthOffset)),
    columns - (pathWidthOffset + (lastModLabel ? lastModLabel.length + 2 : 0))
  );
  const shortenedFilePath = truncatePathMiddle(displayPath, Math.max(12, maxFileWidth - (lineRange ? lineRange.length + 1 : 0)));
  // A root-qualified virtual reference is not a current repo-local file URL.
  const filePathStyled = recordDisplay ? italicColor(shortenedFilePath, ANSI.fgLight) : hyperlinkFileLabel({
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
