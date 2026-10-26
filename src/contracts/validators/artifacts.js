import { admitImportExtraction, admitImportExtractionSummary } from '../../shared/import-extraction.js';
import { javascriptDeclarationErrors } from '../javascript-declaration-identities.js';
import { sqlRelationEvidenceErrors } from '../sql-relation-identities.js';
import { callArgumentProjectionErrors } from '../call-arguments.js';
import { literalEvidenceProjectionErrors } from '../literal-evidence.js';
import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { ARTIFACT_SCHEMA_DEFS } from '../schemas/artifacts.js';
import { toValidationResult } from './result.js';
import { validateMetadataV2Semantics } from './metadata.js';
import { apiContractProjectionErrors } from '../schemas/api-contracts.js';
import { callableSummaryProjectionErrors } from '../callable-parameters.js';

const ajv = createAjv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

export const ARTIFACT_VALIDATORS = Object.fromEntries(
  Object.entries(ARTIFACT_SCHEMA_DEFS).map(([name, schema]) => [name, compileSchema(ajv, schema, { lazy: true })])
);

export function validateArtifact(name, data) {
  const validator = ARTIFACT_VALIDATORS[name];
  if (!validator) return { ok: true, errors: [] };
  const result = toValidationResult(validator, data);
  if (result.ok && name === 'symbols' && Array.isArray(data)) {
    for (let index = 0; index < data.length; index++) {
      const summary = data[index]?.extensions?.callableParameters;
      result.errors.push(...callableSummaryProjectionErrors(summary).map(error => `/${index}/extensions/callableParameters: ${error}`));
      if (summary?.source === 'legacy-signature-subset') result.errors.push(`/${index}/extensions/callableParameters: legacy display cannot supply parser-node symbol authority.`);
      const language = data[index]?.lang?.toLowerCase();
      if (summary?.source === 'parser-node' && language && (summary.language === 'typescript'
        ? !['typescript', 'ts', 'tsx'].includes(language) : !['javascript', 'js', 'jsx'].includes(language))) {
        result.errors.push(`/${index}/extensions/callableParameters: parameter language differs from the published symbol.`);
      }
      if (result.errors.length >= 20) break;
    }
    result.ok = !result.errors.length;
  }
  if (result.ok && name === 'file_relations' && Array.isArray(data)) {
    for (const [index, entry] of data.entries()) {
      result.errors.push(...javascriptDeclarationErrors(entry.relations.jsDeclarations).map(error => `/${index}/relations/jsDeclarations: ${error}`));
      result.errors.push(...sqlRelationEvidenceErrors(entry.relations.sqlRelationEvidence)
        .map(error => `/${index}/relations/sqlRelationEvidence: ${error}`));
      for (const name of ['importExtraction', 'importScanExtraction']) if (entry.relations[name]) {
        try {
          if (name === 'importExtraction' && !Array.isArray(entry.relations.imports)) throw new Error('File extraction requires its retained imports array.');
          admitImportExtraction(entry.relations[name], name === 'importExtraction' ? entry.relations.imports : null);
        }
        catch (error) { result.errors.push(`/${index}/relations/${name}: ${error.message}`); }
      }
      if (result.errors.length >= 20) break;
    }
    result.ok = !result.errors.length;
  }
  if (result.ok && ['graph_relations', 'import_resolution_graph'].includes(name) && data.extractionCoverage) {
    try { admitImportExtractionSummary(data.extractionCoverage); }
    catch (error) { result.errors.push(`/extractionCoverage: ${error.message}`); }
    result.ok = !result.errors.length;
  }
  if (result.ok && name === 'call_sites' && Array.isArray(data)) {
    for (let index = 0; index < data.length; index++) {
      const argumentsEvidence = data[index]?.extensions?.arguments;
      const evaluation = data[index]?.extensions?.javascriptEvaluation;
      if (evaluation?.state === 'qualified' && (!evaluation.sourceHash
        || data[index].start < evaluation.ownerRange.start + evaluation.sourceOffset
        || data[index].end > evaluation.ownerRange.end + evaluation.sourceOffset)) result.errors.push(`/${index}/extensions/javascriptEvaluation: call differs from its source owner extent`);
      if (argumentsEvidence) result.errors.push(...callArgumentProjectionErrors(argumentsEvidence)
        .map(error => `/${index}/extensions/arguments: ${error}`));
      for (const literal of data[index]?.extensions?.argLiterals || []) {
        if (literal) result.errors.push(...literalEvidenceProjectionErrors(literal)
          .map(error => `/${index}/extensions/argLiterals: ${error}`));
      }
      if (result.errors.length >= 20) break;
    }
    result.ok = !result.errors.length;
  }
  if (result.ok && name === 'api_contracts' && Array.isArray(data)) {
    result.errors.push(...apiContractProjectionErrors({ symbols: data }));
    result.ok = result.errors.length === 0;
  }
  if (result.ok && (name === 'chunk_meta' || name === 'chunk_meta_cold') && Array.isArray(data)) {
    for (let index = 0; index < data.length; index += 1) {
      const errors = validateMetadataV2Semantics(data[index]?.metaV2);
      result.errors.push(...errors.map((error) => `/${index}/metaV2${error}`));
      if (result.errors.length >= 20) break;
    }
    result.ok = result.errors.length === 0;
  }
  return result;
}
