import { formatScoreBreakdown } from '../explain.js';
import { getFormatShortCache } from '../cache.js';
import {
  ANSI,
  boldText,
  colorText,
  italicColor
} from './ansi.js';
import {
  buildFormatCacheKey,
  buildQueryHash,
  formatLastModified,
  formatSignature
} from './display-meta.js';

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

