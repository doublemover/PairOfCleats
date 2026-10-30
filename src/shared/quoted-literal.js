/** Delimiter ownership only: no evaluation, escape decoding or line rewriting.
 * Python/Starlark raw literals still escape quotes for lexical termination.
 * Callers retain source budgets and their language-specific prefix policy. */
export const readQuotedLiteralEnd = (source, start, { shouldContinue = () => true } = {}) => {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return null;
  const delimiter = source.startsWith(quote.repeat(3), start) ? quote.repeat(3) : quote;
  let index = start + delimiter.length;
  while (index < source.length) {
    if ((index & 1023) === 0 && !shouldContinue()) return { end: index, closed: false, limited: true };
    if (source[index] === '\\') { index = Math.min(source.length, index + 2); continue; }
    if (source.startsWith(delimiter, index)) return { end: index + delimiter.length, closed: true, limited: false };
    index++;
  }
  return { end: source.length, closed: false, limited: false };
};
