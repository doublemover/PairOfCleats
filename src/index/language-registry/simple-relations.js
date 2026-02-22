export const normalizeImportToken = (raw) => {
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/^[\"']/, '')
    .replace(/[\"']$/, '')
    .replace(/[);]+$/g, '');
};

const DEFAULT_MAX_SIMPLE_IMPORTS = 512;

export const buildSimpleRelations = (imports) => {
  const list = Array.isArray(imports)
    ? imports
    : (Array.isArray(imports?.imports) ? imports.imports : []);
  const configuredMaxImports = Number(imports?.maxImports);
  const maxImports = Number.isFinite(configuredMaxImports) && configuredMaxImports >= 0
    ? Math.max(0, Math.floor(configuredMaxImports))
    : DEFAULT_MAX_SIMPLE_IMPORTS;
  const normalized = list
    .map((entry) => normalizeImportToken(entry))
    .filter(Boolean);
  const unique = Array.from(new Set(normalized));
  unique.sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
  return {
    imports: unique.slice(0, maxImports),
    exports: [],
    calls: [],
    usages: []
  };
};
