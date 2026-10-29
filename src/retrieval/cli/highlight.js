import { projectNormalizedText } from '../normalized-text.js';
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildHighlightRegex(queryTokens, { caseSensitive = false } = {}) {
  const highlightTokens = [...new Set(queryTokens.map((tok) => tok.trim().normalize('NFKD')).filter(Boolean))];
  if (!highlightTokens.length) return null;
  try {
    const pattern = highlightTokens.map((tok) => escapeRegExp(tok)).join('|');
    return pattern ? new RegExp(`(${pattern})`, caseSensitive ? 'gu' : 'igu') : null;
  } catch {
    return null;
  }
}

/** Match the analyzer's normalized spelling, then style whole original graphemes. */
export const highlightText = (value, regex, style) => {
  const text = String(value || '');
  if (!text || !regex) return text;
  const { normalized, starts, ends } = projectNormalizedText(text);
  const matcher = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  const ranges = [];
  for (const match of normalized.matchAll(matcher)) {
    if (!match[0].length) continue;
    const start = starts[match.index], end = ends[match.index + match[0].length - 1];
    if (start == null || end == null) continue;
    const previous = ranges[ranges.length - 1];
    if (previous && start < previous.end) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  }
  let cursor = 0, output = '';
  for (const { start, end } of ranges) {
    output += text.slice(cursor, start) + style(text.slice(start, end));
    cursor = end;
  }
  return output + text.slice(cursor);
};
