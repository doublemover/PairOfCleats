export const normalizeImportToken = (raw) => {
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/^[\"']/, '')
    .replace(/[\"']$/, '')
    .replace(/[);]+$/g, '');
};

export const buildSimpleRelations = (imports) => {
  const list = Array.isArray(imports) ? imports.filter(Boolean) : [];
  const unique = Array.from(new Set(list));
  return {
    imports: unique,
    exports: [],
    calls: [],
    usages: []
  };
};
