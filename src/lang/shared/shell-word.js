/** Read a single static shell word. Dynamic expansion remains unresolved. */
export const readStaticShellWord = (source, start = 0) => {
  let index = start, value = '', quote = null, started = false, dynamic = false;
  while (/\s/u.test(source[index] || '') && index < source.length) index++;
  for (; index < source.length; index++) {
    const char = source[index];
    if (!quote && (/[\s;&|<>]/u.test(char) || char === '#')) break;
    started = true;
    if (char === "'" && quote !== '"') { quote = quote === "'" ? null : "'"; continue; }
    if (char === '"' && quote !== "'") { quote = quote === '"' ? null : '"'; continue; }
    if (char === '\\' && quote !== "'") {
      const next = source[index + 1];
      if (next == null) return null;
      if (next === '\n') { index++; continue; }
      if (quote === '"' && !['$','`','"','\\'].includes(next)) value += char;
      else { value += next; index++; continue; }
    }
    if (quote !== "'" && (char === '$' || char === '`')) dynamic = true;
    value += char;
  }
  return started && !quote && !dynamic ? { value, end:index } : null;
};
