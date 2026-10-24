/** Small lexical boosts for explicit symbol/file lookups, not natural-language guesses. */
export const exactLookupIntent = (query, chunk, isDefinition) => {
  const raw = typeof query === 'string' ? query.trim() : '';
  if (!raw || !/^[\w$./\\-]+$/.test(raw)) return { symbol: false, file: false, factor: 1 };
  const name = String(chunk.name || '');
  const symbol = isDefinition && (name === raw || name.split('.').at(-1) === raw);
  const filePath = String(chunk.file || '').replace(/\\/g, '/');
  const queryPath = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  const file = queryPath.includes('.') && (filePath === queryPath
    || filePath.endsWith(`/${queryPath}`));
  return { symbol, file, factor: (symbol ? 1.5 : 1) * (file ? 1.25 : 1) };
};
