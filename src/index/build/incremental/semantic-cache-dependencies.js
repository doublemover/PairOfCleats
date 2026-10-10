import { semanticPolicyIdentities } from '../../semantic/policy.js';
import { createRequire } from 'node:module';
import { loadTypeScriptModule } from '../../../lang/typescript/parser.js';
import { JAVASCRIPT_ADAPTER_VERSION } from '../../semantic/javascript-collector.js';
import { TYPESCRIPT_ADAPTER_VERSION } from '../../semantic/typescript-collector.js';
import { semanticHash } from '../../semantic/identity.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';

const require = createRequire(import.meta.url);
const parserVersions = Object.fromEntries(['@babel/parser', 'acorn', 'esprima'].map(name => [
  name, require(name + '/package.json').version
]));

/** Include runtime parser/extractor versions: old parse signatures only covered their options. */
export const createSemanticCacheDependencySignatures = ({ dependencySignatures, policy, root,
  languageOptions = {} }) => {
  if (!dependencySignatures || !policy) throw new TypeError('Semantic cache runtime dependencies are required.');
  return { ...dependencySignatures, semantic: semanticHash('pairofcleats.semantic.cache-runtime.v1', {
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, semanticSchemaVersion: 1,
    parsers: { ...parserVersions, typescript: loadTypeScriptModule(root)?.version || null },
    extractors: { javascript: JAVASCRIPT_ADAPTER_VERSION, typescript: TYPESCRIPT_ADAPTER_VERSION },
    structuralPolicy: { structure: 'complete', adapterVersion: 2 },
    policy: { languages: policy.languages, baseFacts: policy.baseFacts },
    parserOptions: { javascript: languageOptions.javascript || {}, typescript: languageOptions.typescript || {} }
  }), semanticAnalysis: semanticPolicyIdentities(policy).analysis, semanticLayout: semanticPolicyIdentities(policy).layout };
};
