import { semanticHash } from './identity.js';
import { MODULE_EXPORTS_VERSION } from '../../lang/js-ts-exports.js';

/** Shared by producers and replay admission. Bump the affected producer when its
 * semantics change; syntax extraction and physical layout remain independent.
 */
export const SEMANTIC_ANALYSIS_VERSIONS = Object.freeze({
  moduleExports: MODULE_EXPORTS_VERSION,
  lexicalAnalyzer: '2', importResolution: '2', pieceAssembly: '2',
  sourceChunking: '3', typeNormalization: '2', vfsRouting: '2',
  riskPropagation: '3', callSiteIdentity: '2',
  compilerBindings: '10', lspBindings: '13', cfgFlow: '14', callFlow: '13',
  valueSlice: '5', storageFlow: '2', workerFlow: '6', boundaryFlow: '8', wasmFlow: '5', nativeFlow: '1'
});
// Static WASM validation is supplied by this runtime, so derived replay must
// not reuse a partition validated by a different engine version.
export const WASM_VALIDATOR_RUNTIME = process.versions.v8;
export const SEMANTIC_OWNERSHIP_VERSION = '1';
export const SEMANTIC_OWNERSHIP_PRODUCER_HASH = semanticHash('semantic.ownership-producer.v1', {
  version: Number(SEMANTIC_OWNERSHIP_VERSION)
});

export const semanticAnalysisPolicyIdentity = (policy, versions = SEMANTIC_ANALYSIS_VERSIONS) =>
  semanticHash('semantic.analysis-policy.v2', {
    enrichment: policy.enrichment, targets: policy.targets || [], producers: versions,
    wasmValidatorRuntime: WASM_VALIDATOR_RUNTIME,
    overrides: (policy.overrides || []).filter(rule => rule.set?.enrichment).map(rule => ({
      match: rule.match, enrichment: rule.set.enrichment
    }))
  });
