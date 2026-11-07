import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { admitImportExtraction, canReuseImportExtraction } from '../../shared/import-extraction.js';
import { resolveFileRelations } from '../file-relations-resolver.js';

/** A readable family is not proof that every requested predicate was analyzed.
 * Check the same inline/file facts used by the actual filter, after all selected
 * generation reads settle. Empty imports need a qualifying producer receipt. */
export const assertRequiredRelationCoverage = ({ idx, fields, mode, indexDir }) => {
  if (!fields.length) return;
  const unavailable = (field, state, reasons = []) => {
    throw createError(ERROR_CODES.CAPABILITY_MISSING,
      `Requested ${field} filter lacks complete selected-generation relation evidence.`, {
        details: { mode, field, state, artifact: 'file_relations', reasons: reasons.slice(0, 8) }
      });
  };
  const fileFactsByPath = new Map(), validatedImports = new WeakSet();
  for (const chunk of idx.chunkMeta || []) {
    for (const field of fields) {
      let facts = chunk?.codeRelations;
      if (!Array.isArray(facts?.[field])) {
        if (!fileFactsByPath.has(chunk?.file)) fileFactsByPath.set(chunk?.file, resolveFileRelations(idx.fileRelations, chunk?.file));
        facts = fileFactsByPath.get(chunk?.file);
      }
      if (!Array.isArray(facts?.[field])) unavailable(field, 'unavailable');
      if (field !== 'imports' || validatedImports.has(facts)) continue;
      const receipt = facts.importExtraction ?? facts.importScanExtraction;
      if (receipt == null) unavailable(field, 'unqualified', ['legacy_extraction_unqualified']);
      // A secondary shallow scan cannot qualify a broader unknown primary.
      // Validate each shared file-facts object only once, including its exact
      // retained entries. Empty legacy arrays are not negative evidence.
      if (!canReuseImportExtraction(receipt, facts.imports)) {
        admitImportExtraction(receipt, facts.imports);
        unavailable(field, receipt.state, Object.keys(receipt.reasonCounts));
      }
      validatedImports.add(facts);
    }
  }
  idx.fileRelationsReadiness = { state: idx.fileRelationsReadiness?.state === 'complete-inline' ? 'complete-inline' : 'complete',
    mode, indexDir, fields: [...fields] };
};
