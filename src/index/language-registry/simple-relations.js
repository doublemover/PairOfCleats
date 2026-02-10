export const normalizeImportToken = (raw) => {
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/^[\"']/, '')
    .replace(/[\"']$/, '')
    .replace(/[);]+$/g, '');
};

export const buildSimpleRelations = (imports) => {
  const list = Array.isArray(imports)
    ? imports
    : (Array.isArray(imports?.imports) ? imports.imports : []);
  const normalized = list
    .map((entry) => normalizeImportToken(entry))
    .filter(Boolean);
  const unique = Array.from(new Set(normalized));
  return {
    imports: unique,
    exports: [],
    calls: [],
    usages: []
  };
};
