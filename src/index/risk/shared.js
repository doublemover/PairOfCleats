export const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

const isIdentCharCode = (code) => (
  (code >= 48 && code <= 57)
  || (code >= 65 && code <= 90)
  || (code >= 97 && code <= 122)
  || code === 95
  || code === 36
);

export const containsIdentifier = (text, name, options = {}) => {
  if (!text || !name) return false;
  const hay = String(text);
  const needle = String(name);
  if (!needle) return false;
  const start = Number.isFinite(Number(options.start))
    ? Math.max(0, Math.floor(Number(options.start)))
    : 0;
  const rawEnd = options.end;
  const end = Number.isFinite(Number(rawEnd))
    ? Math.min(hay.length, Math.max(0, Math.floor(Number(rawEnd))))
    : hay.length;
  if (end <= start) return false;

  const needleLength = needle.length;
  let idx = start;
  while ((idx = hay.indexOf(needle, idx)) !== -1) {
    if (idx + needleLength > end) return false;
    const beforePos = idx - 1;
    const afterPos = idx + needleLength;
    const beforeOk = beforePos < start || !isIdentCharCode(hay.charCodeAt(beforePos));
    const afterOk = afterPos >= end || !isIdentCharCode(hay.charCodeAt(afterPos));
    if (beforeOk && afterOk) return true;
    idx += 1;
  }
  return false;
};

export const matchRulePatterns = (text, rule, options = {}) => {
  if (!text || !rule) return null;
  const line = String(text);
  const patterns = Array.isArray(rule.patterns) ? rule.patterns : [];
  const lineLowerRef = options.lineLowerRef && typeof options.lineLowerRef === 'object'
    ? options.lineLowerRef
    : null;
  const returnMatch = options.returnMatch === true;

  for (const pattern of patterns) {
    if (!pattern) continue;
    const prefilter = pattern.prefilter;
    if (prefilter) {
      if (pattern.prefilterLower) {
        if (lineLowerRef) {
          if (!lineLowerRef.value) lineLowerRef.value = line.toLowerCase();
          if (!lineLowerRef.value.includes(pattern.prefilterLower)) continue;
        } else if (!line.toLowerCase().includes(pattern.prefilterLower)) {
          continue;
        }
      } else if (!line.includes(prefilter)) {
        continue;
      }
    }
    try {
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (match) {
        return returnMatch ? { index: match.index, match: match[0] } : true;
      }
    } catch {
      continue;
    }
  }
  return returnMatch ? null : false;
};
