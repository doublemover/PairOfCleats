import path from 'node:path';
import { assertSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { createArtifactSemanticStore } from '../../semantic/artifact-store.js';
import { createSemanticFactsRef } from './file-ref.js';
import { canonicalSemanticJson } from './identity.js';
import { validateSemanticPartitions } from './reconcile.js';
const fail=message=>Object.assign(new Error(message),{code:'ERR_SEMANTIC_SOURCE_MISMATCH'});
/** Validate all source/context/reference joins before atomically selecting provider output. */
export const mergeSemanticProviderOutput = async ({ output, state, runtime, signal }) => {
  assertSemanticEnvelope('provider', output);
  const contexts = new Map((state.semanticCompilerContexts || []).map(context => [context.contextKey, context]));
  for (const context of output.contexts) {
    if(contexts.has(context.contextKey)&&canonicalSemanticJson(contexts.get(context.contextKey))!==canonicalSemanticJson(context))throw fail('Conflicting provider context identity.');
    contexts.set(context.contextKey, context);
  }
  const inventory=new Map(),bySource=new Map();
  for(const [file,current] of state.semanticFactsByFile||[]) {
    bySource.set(current.sourceUnitId,{file,current});
    for(const partition of current.partitions)inventory.set(partition.partitionId,partition);
  }
  for(const partition of output.partitions) {
    const entry=bySource.get(partition.sourceUnitId),context=contexts.get(partition.contextHash),previous=inventory.get(partition.partitionId);
    if(!entry||!context?.sourceUnits.some(source=>source.sourceUnitId===entry.current.sourceUnitId&&source.byteHash===entry.current.sourceHash))throw fail('Semantic provider source/context mismatch.');
    if(previous&&canonicalSemanticJson(previous)!==canonicalSemanticJson(partition))throw fail('Provider attempted to replace an immutable partition.');
    if(!previous&&partition.partitionId.startsWith('sy1:'))throw fail('Provider cannot introduce replacement syntax.');
    inventory.set(partition.partitionId,partition);
  }
  const pending=new Map();
  for (const [file, current] of state.semanticFactsByFile || []) {
    const added=[...new Map(output.partitions.filter(partition=>partition.sourceUnitId===current.sourceUnitId&&!current.partitions.some(row=>row.partitionId===partition.partitionId)).map(partition=>[partition.partitionId,partition])).values()];
    if(!added.length)continue;
    const root=path.join(runtime.buildRoot,current.storage.relativePath);
    // Qualified references may cross sources/providers only within this generation/root.
    const references=[...inventory.values()].filter(partition=>{
      const facts=bySource.get(partition.sourceUnitId)?.current;
      return facts&&path.join(runtime.buildRoot,facts.storage.relativePath)===root&&canonicalSemanticJson(facts.storage.generation)===canonicalSemanticJson(current.storage.generation);
    });
    const store=createArtifactSemanticStore({root,repoRoot:runtime.root,artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,generation:current.storage.generation,partitions:references});
    await validateSemanticPartitions({store,partitions:added,referencePartitions:references,signal});
    const coverage=[...current.coverage];
    for(const partition of added)for await(const row of store.iterateRows(partition.partitionId,'semantic_coverage',{signal}))coverage.push(row);
    pending.set(file,createSemanticFactsRef({source:{sourceUnitId:current.sourceUnitId,byteHash:current.sourceHash,repositoryNamespace:current.repositoryNamespace},syntaxPartitionId:current.syntaxPartitionId,
      storage:current.storage,partitions:[...current.partitions,...added],coverage}));
  }
  for(const [file,facts] of pending)state.semanticFactsByFile.set(file,facts);
  state.semanticCompilerContexts=[...contexts.values()];
};
