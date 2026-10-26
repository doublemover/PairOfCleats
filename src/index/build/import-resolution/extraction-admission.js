import { createImportExtraction, getImportExtraction, projectImportExtraction } from '../../../shared/import-extraction.js';

/** Preserve the scan observation even for an empty importer. This produces no
 * candidate edge and cannot turn a producer failure into resolver success. */
export const admitImportMapExtraction = ({ importerRel, rawImports, normalizeRelPath, importExtractionByFile, fileRelations }) => {
  if (!Array.isArray(rawImports)) throw Object.assign(new Error('Import maps require an entry array per file.'), { code: 'ERR_IMPORT_EXTRACTION_CONTRACT' });
  const relNormalized = normalizeRelPath(importerRel);
  const valid = rawImports.filter(spec => typeof spec === 'string' && spec);
  const rawSpecs = [...new Set(valid)].sort();
  const sourceReceipt = importExtractionByFile?.[importerRel] || importExtractionByFile?.[relNormalized] || getImportExtraction(rawImports)
    || createImportExtraction({ entries: rawImports, text: null, producerId: 'resolver-array-admission',
      scope: 'unqualified-import-scan-array', reasons: ['legacy_array_producer'] });
  const extraction = projectImportExtraction(sourceReceipt, rawImports, rawSpecs, { owner: 'resolver-import-array',
    duplicates: valid.length - rawSpecs.length, invalid: rawImports.length - valid.length });
  let relation = fileRelations.get(relNormalized);
  if (!relation) {
    relation = { imports: rawSpecs, importLinks: [], importExtraction: extraction };
    fileRelations.set(relNormalized, relation);
  }
  relation.importScanExtraction = extraction;
  return { relNormalized, rawSpecs, extraction };
};
