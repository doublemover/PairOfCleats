import { createRequire } from 'node:module';
import { compileSchema,createAjv } from '../../shared/validation/ajv-factory.js';
import { semanticHash } from './identity.js';
import { normalizeCompilerAdmissionPolicy } from './compiler-admission.js';
const require=createRequire(import.meta.url), normalized=new WeakSet();let validate;
const defaults=profile=>({schemaVersion:1,enabled:false,profile,languages:['javascript','typescript','wasm'],baseFacts:{structure:'complete',sourceRetention:'content-addressed'},planning:{prepass:'reuse-existing-walk',costModel:'measured',inlineBudgetMs:100},
  enrichment:{bindings:profile==='targeted'?'deferred':'auto',localFlow:profile==='targeted'?'deferred':'auto',crossFileFlow:'deferred',fieldPathDepth:profile==='rich'?4:2,callContextDepth:profile==='rich'?1:0,maxSccIterations:profile==='rich'?12:8,unknownEffects:'conservative'},
  execution:{deferredDrain:'manual',afterIndexMaxMs:30000,maxAttempts:3},storage:{batchRows:4096,batchBytes:1048576,maxQueuedBytes:33554432,decodedCacheBytes:67108864,targetPartBytes:16777216,maxDiskWorkingSetBytes:8589934592},query:{maxRecords:128,maxRows:512,maxDepth:64,maxBytes:65536,maxWorkMs:250,maxContinuations:64,cursorTtlMs:300000},publication:{base:'publish-with-coverage',semantic:'whole-generation'},overrides:[],targets:[]});
/** Profile defaults precede explicit values; validation and normalization happen once per build. */
export const normalizeSemanticConfig=(value={})=>{
  if(normalized.has(value))return value;
  if(!validate){const ajv=createAjv({allErrors:true,strict:true});validate=compileSchema(ajv,require('../../../docs/config/schema.json').properties.indexing.properties.semantic);}
  if(!validate(value))throw Object.assign(new TypeError('Invalid semantic policy: '+JSON.stringify(validate.errors)),{code:'ERR_SEMANTIC_POLICY'});
  const result=defaults(value.profile||'balanced');
  for(const [key,setting]of Object.entries(value))result[key]=setting&&typeof setting==='object'&&!Array.isArray(setting)?{...result[key],...setting}:structuredClone(setting);
  result.execution.compilerAdmission=normalizeCompilerAdmissionPolicy(value.execution?.compilerAdmission);
  for(const target of result.targets)if(target.range && target.range.end<=target.range.start)throw new TypeError("Semantic targets require a nonempty half-open UTF16 range.");
  const seen=new Set();result.overrides=(result.overrides||[]).map((rule,index)=>{const id=rule.id||'rule:'+index+':'+semanticHash('semantic.policy-rule.v1',rule);if(seen.has(id))throw new TypeError('Duplicate semantic override ID: '+id);seen.add(id);return{...rule,id};});
  if(result.enabled && (!result.storage.batchRows||!result.storage.batchBytes||!result.storage.maxQueuedBytes))throw new TypeError('Enabled semantic storage requires positive row, byte and queue bounds.');
  normalized.add(result);return result;
};
