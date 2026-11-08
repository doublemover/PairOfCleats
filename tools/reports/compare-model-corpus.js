import path from 'node:path';
import { readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { buildIndexSignatureInfo } from '../../src/retrieval/index-cache.js';
import { buildGenerationKey } from '../../src/shared/indexing/build-pointer.js';
import { resolveRetrievalCorpusIdentity } from '../../src/retrieval/corpus-comparison.js';
import { semanticHash } from '../../src/index/semantic/identity.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';

const unknown = reason => ({comparable:false,policy:'source-file-hash-and-chunk-ranges.v1',digest:null,reason});
/** Intern only an actual result's immutable generation. Preflight current roots
 * are intentionally not an input to this source/corpus admission owner. */
export const createComparisonCorpusRegistry = ({maxEntries=256,maxBytes=512*1024}={}) => {
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>256||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>512*1024) throw new RangeError('Invalid private comparison corpus retention bound.');
  const rows=[],memo=new Map(); let retainedBytes=0,corpusReads=0,metadataBytes=0,omitted=0;
  return Object.freeze({
    async observe({generation,mode,repoCacheRoot}) {
      if (!generation?.activeBuildRoot || !path.isAbsolute(generation.activeBuildRoot)
        || !generation.generationKey || !generation.signatureHash || !generation.buildId) return {ref:null,...unknown('actual-generation-unavailable')};
      const root=path.resolve(generation.activeBuildRoot), relative=path.relative(path.resolve(repoCacheRoot),root);
      if(relative.startsWith('..')||path.isAbsolute(relative)) return {ref:null,...unknown('actual-generation-outside-model-cache')};
      const key=semanticHash('comparison-observed-corpus-generation.v1',{mode,generation});
      if(memo.has(key)) return structuredClone(rows[memo.get(key)]);
      if(rows.length>=maxEntries) {omitted++;return {ref:null,...unknown('actual-corpus-retention-limit')};}
      let corpus;
      try {
        const indexDir=path.join(root,`index-${mode}`),info=await buildIndexSignatureInfo(indexDir);
        const stateRead=await readVerifiedContainedFile(repoCacheRoot,path.join(indexDir,'index_state.json'),{maxBytes:8*1024*1024});
        metadataBytes+=stateRead.buffer.byteLength;
        const state=JSON.parse(stateRead.buffer.toString('utf8'));
        const canonicalRoot=info ? path.dirname(info.canonicalDir) : null;
        if(!info || canonicalRoot!==root || info.buildId!==generation.buildId
          || info.artifactSurfaceVersion!==generation.artifactSurfaceVersion || state.profile?.id!==generation.profileId
          || semanticHash('retrieval-mode-signature.v1',info.signature,{maxBytes:8192})!==generation.signatureHash
          || buildGenerationKey({buildId:info.buildId,buildRoot:root,activeRoot:root,buildRoots:{[mode]:root}})!==generation.generationKey) {
          corpus=unknown('actual-generation-mismatch');
        } else {corpusReads++;corpus=await resolveRetrievalCorpusIdentity(indexDir,mode);}
      } catch(error) {
        observeStorageResource(error,{phase:'comparison-actual-generation'}).requireSettled();
        if(!['ENOENT','ENOTDIR','ERR_UNSAFE_FILE_PATH','ERR_ARTIFACT_SCHEMA','ERR_ARTIFACT_SURFACE_VERSION'].includes(error.code)
          && !(error instanceof SyntaxError)) throw error;
        corpus=unknown('actual-generation-unavailable');
      }
      const row={ref:rows.length,key,mode,generation:structuredClone(generation),...corpus};
      const bytes=Buffer.byteLength(JSON.stringify(row));
      if(retainedBytes+bytes>maxBytes) {omitted++;return {ref:null,...unknown('actual-corpus-retention-limit')};}
      retainedBytes+=bytes;memo.set(key,row.ref);rows.push(row);return structuredClone(row);
    },
    snapshot:()=>structuredClone({schemaVersion:1,policy:'actual-execution-generation-per-query',corpusReads,metadataBytes,
      metadataBytesScope:'verified-index-state-bytes;chunk-table-bytes-unobserved',
      retainedEntries:rows.length,retainedBytes,omitted,rows})
  });
};
