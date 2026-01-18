export const normalizeImportToken = (raw) => {
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/^[\"']/, '')
    .replace(/[\"']$/, '')
    .replace(/[);]+$/g, '');
};

export const buildSimpleRelations = (imports, allImports) => {
  const list = Array.isArray(imports) ? imports.filter(Boolean) : [];
  const unique = Array.from(new Set(list));
  const importLinks = unique
    .map((entry) => allImports?.[entry])
    .filter((entry) => !!entry)
    .flat();
  return {
    imports: unique,
    exports: [],
    calls: [],
    usages: [],
    importLinks
  };
};
