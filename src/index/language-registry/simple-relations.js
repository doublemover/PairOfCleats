import { createImportExtraction, getImportExtraction, projectImportExtraction } from '../../shared/import-extraction.js';
import { sanitizeImportSpecifier } from '../shared/import-specifier.js';

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
    .map((entry) => imports?.literalImports === true ? sanitizeImportSpecifier(entry,{literal:true}) : normalizeImportToken(entry))
    .filter(Boolean);
  const unique = Array.from(new Set(normalized));
  unique.sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
  const retained = unique.slice(0, maxImports);
  const extraction = getImportExtraction(list) || createImportExtraction({ entries: list,
    text: typeof imports?.sourceText === 'string' ? imports.sourceText : null, producerId: 'simple-relations-legacy-array',
    scope: 'unqualified-simple-relation-input', reasons: ['legacy_array_producer'] });
  const importExtraction = projectImportExtraction(extraction, list, retained, { owner: 'simple-relations',
    duplicates: normalized.length - unique.length, invalid: list.length - normalized.length,
    omitted: unique.length - retained.length, limit: maxImports });
  return {
    importExtraction,
    imports: retained,
    exports: [],
    calls: [],
    usages: []
  };
};
