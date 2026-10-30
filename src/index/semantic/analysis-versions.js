import { SQL_RELATION_PRODUCER_VERSION } from '../../lang/sql/version.js';
import { semanticHash } from './identity.js';
import { MODULE_EXPORTS_VERSION } from '../../lang/js-ts-exports.js';
import { FLOW_METADATA_VERSION } from '../../shared/flow-evidence.js';
import { SOURCE_OUTLINE_VERSION } from '../../shared/source-outline.js';
import { JAVASCRIPT_RELATIONS_VERSION } from '../../lang/javascript/version.js';
import { SCM_METADATA_PRODUCER_VERSION } from '../scm/version.js';

/** Shared by producers and replay admission. Bump the affected producer when its
 * semantics change; syntax extraction and physical layout remain independent.
 */
export const SEMANTIC_ANALYSIS_VERSIONS = Object.freeze({
  scmMetadata: SCM_METADATA_PRODUCER_VERSION,
  moduleExports: MODULE_EXPORTS_VERSION, sqlRelations: SQL_RELATION_PRODUCER_VERSION, javascriptRelations: JAVASCRIPT_RELATIONS_VERSION, flowMetadata: FLOW_METADATA_VERSION, sourceOutline: SOURCE_OUTLINE_VERSION,
  lexicalAnalyzer: '5', importResolution: '27', pieceAssembly: '5',
  recordsProducer: '13', ignoreRules: '5', documentExtraction: '7', discoverySelection: '8',
  repoMapProducer: '2', graphRelations: '3',
  sourceChunking: '52', typeNormalization: '15', vfsRouting: '8', complexityAnalysis: '3', lintProjection: '3',
  riskPropagation: '7', callSiteIdentity: '3', runtimeClaims: '2',
  compilerBindings: '30', lspBindings: '66', cfgFlow: '32', callFlow: '53',
  valueSlice: '10', storageFlow: '2', workerFlow: '11', boundaryFlow: '12', wasmStructure: '1', wasmFlow: '7', nativeFlow: '3'
});
// Static WASM validation is supplied by this runtime, so derived replay must
// not reuse a partition validated by a different engine version.
export const WASM_VALIDATOR_RUNTIME = process.versions.v8;
export const SEMANTIC_OWNERSHIP_VERSION = '1';
export const SEMANTIC_OWNERSHIP_PRODUCER_HASH = semanticHash('semantic.ownership-producer.v1', {
  version: Number(SEMANTIC_OWNERSHIP_VERSION)
});

// CFG construction admission changes meaning when the queue-byte policy changes.
export const resolveCfgConstructionMaxBytes = policy =>
  Math.min(16 * 1024 * 1024, policy.storage?.maxQueuedBytes ?? 16 * 1024 * 1024);

export const semanticAnalysisPolicyIdentity = (policy, versions = SEMANTIC_ANALYSIS_VERSIONS) =>
  semanticHash('semantic.analysis-policy.v2', {
    enrichment: policy.enrichment, targets: policy.targets || [], producers: versions,
    wasmValidatorRuntime: WASM_VALIDATOR_RUNTIME,
    cfgConstructionMaxBytes: resolveCfgConstructionMaxBytes(policy),
    overrides: (policy.overrides || []).filter(rule => rule.set?.enrichment).map(rule => ({
      match: rule.match, enrichment: rule.set.enrichment
    }))
  });
