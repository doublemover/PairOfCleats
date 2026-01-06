const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildHighlightRegex(queryTokens) {
  const highlightTokens = [...new Set(queryTokens.map((tok) => tok.trim()).filter(Boolean))];
  if (!highlightTokens.length) return null;
  try {
    const pattern = highlightTokens.map((tok) => escapeRegExp(tok)).join('|');
    return pattern ? new RegExp(`(${pattern})`, 'ig') : null;
  } catch {
    return null;
  }
}
