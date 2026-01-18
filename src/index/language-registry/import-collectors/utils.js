export const MAX_REGEX_LINE = 8192;

export const shouldScanLine = (line, precheck) => {
  if (!line) return false;
  if (line.length > MAX_REGEX_LINE) return false;
  if (precheck && !precheck(line)) return false;
  return true;
};

export const lineHasAny = (line, tokens) => {
  for (const token of tokens) {
    if (line.includes(token)) return true;
  }
  return false;
};

export const lineHasAnyInsensitive = (line, tokens) => {
  const lower = line.toLowerCase();
  for (const token of tokens) {
    if (lower.includes(token)) return true;
  }
  return false;
};
