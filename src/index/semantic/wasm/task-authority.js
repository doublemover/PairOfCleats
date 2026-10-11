import { SEMANTIC_ANALYSIS_VERSIONS, WASM_VALIDATOR_RUNTIME } from '../analysis-versions.js';
import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { throwIfAborted } from '../../../shared/abort.js';
export const WASM_DEPENDENCY_KEY='semantic.wasm.binary-inventory.v1';
const fail=message=>Object.assign(new Error(message),{code:'ERR_SEMANTIC_BINARY_AUTHORITY'});
export const createWasmTaskInventory = sources => ({schemaVersion:1,kind:'wasm-binary',producerVersion:SEMANTIC_ANALYSIS_VERSIONS.wasmFlow,
  validatorRuntime:WASM_VALIDATOR_RUNTIME,sources:sources.map(source=>({sourceUnitId:source.sourceUnitId,byteHash:source.byteHash,byteLength:source.byteLength})).sort((a,b)=>a.sourceUnitId.localeCompare(b.sourceUnitId))});
export const wasmTaskInventoryHash=inventory=>semanticHash(WASM_DEPENDENCY_KEY,inventory);
export const assertWasmTaskAuthority = (task,target) => {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(task) || !object(target) || !Array.isArray(task.dependencies) || task.dependencies.some(row => !object(row))
    || !Array.isArray(task.coverageToProduce) || !Array.isArray(task.sourceUnits)) throw fail('Invalid bounded binary task authority.');
  const inventory=target.binaryInventory,dependency=task.dependencies.find(row=>row.dependencyKey===WASM_DEPENDENCY_KEY);
  if(!inventory) {if(dependency)throw fail('Missing binary authority.');return;}
  if(!object(inventory) || !Array.isArray(inventory.sources) || inventory.sources.some(row => !object(row))
    || target.compilerInventory || task.kind!=='localFlow'||task.coverageToProduce.length!==1||task.coverageToProduce[0]!=='localFlow'
    ||task.dependencies.length!==1||!dependency||dependency.expectedHash!==wasmTaskInventoryHash(inventory)
    ||inventory.schemaVersion!==1||inventory.kind!=='wasm-binary'||!Array.isArray(inventory.sources)||inventory.sources.length!==1
    ||canonicalSemanticJson(Object.keys(inventory).sort())!==canonicalSemanticJson(['kind','producerVersion','schemaVersion','sources','validatorRuntime'])
    ||canonicalSemanticJson(inventory.sources.map(row=>row.sourceUnitId))!==canonicalSemanticJson([...task.sourceUnits].sort())
    ||inventory.sources.some(row=>Object.keys(row).sort().join(',')!=='byteHash,byteLength,sourceUnitId'||!/^su1:[a-f0-9]{64}$/.test(row.sourceUnitId)||! /^[a-f0-9]{64}$/.test(row.byteHash)||!Number.isSafeInteger(row.byteLength)||row.byteLength<8||row.byteLength>65536))throw fail('Invalid bounded binary task authority.');
};
export const verifyWasmTaskAuthority = async ({task,target,sources,store,signal}) => {
  assertWasmTaskAuthority(task,target);
  const inventory=target.binaryInventory;
  if(!inventory||inventory.producerVersion!==SEMANTIC_ANALYSIS_VERSIONS.wasmFlow||inventory.validatorRuntime!==WASM_VALIDATOR_RUNTIME)throw fail('Binary producer or validator identity changed.');
  for(const row of inventory.sources) {
    throwIfAborted(signal);const source=sources.get(row.sourceUnitId);
    if(!source||source.language!=='wasm'||source.encoding!=='binary'||source.byteHash!==row.byteHash||source.byteLength!==row.byteLength)throw fail('Binary task differs from retained source authority.');
    await store.verifySource(source,{signal});
  }
  return {verified:true,complete:true,authorityHash:wasmTaskInventoryHash(inventory),dependencyHashes:new Map([[WASM_DEPENDENCY_KEY,wasmTaskInventoryHash(inventory)]])};
};
