import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../../contracts/versioning.js';
import { CALL_SITE_SEMANTIC_REF_VERSION } from '../../../../contracts/schemas/call-site-semantic-ref.js';
import { assertSemanticEnvelope } from '../../../../contracts/validators/semantic-envelopes.js';
import { createArtifactSemanticStore } from '../../../../semantic/artifact-store.js';
import { throwIfAborted } from '../../../../shared/abort.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_CALL_SITE_SEMANTIC_REF' });
export const unavailableCallSiteSemanticRef = (reason = 'semantic-retention-unavailable') => ({
  schemaVersion: CALL_SITE_SEMANTIC_REF_VERSION, status: 'unavailable', reason
});

/** Associate only existing retained source/record authority. One file header and
 * a bounded existing store read scope are reused; no source bytes or corpus-wide
 * invocation map are retained by this artifact writer.
 */
export const createCallSiteSemanticRefResolver = ({ state, outDir, buildRoot, buildId, signal }) => {
  let previous = null;
  const open = async (chunk, facts) => {
    assertSemanticEnvelope('fileFactsRef', facts);
    if (typeof buildId !== 'string' || !buildId || facts.storage.generation.baseBuildId !== buildId
      || facts.storage.generation.semanticRevision !== 0) throw fail('Call-site semantic source belongs to another build generation.');
    if (!buildRoot || path.resolve(buildRoot, facts.storage.relativePath) !== path.resolve(outDir, 'semantic')) {
      throw fail('Call-site semantic source belongs to another generation root.');
    }
    if (previous?.facts === facts && previous.file === chunk.file) return previous;
    const partition = facts.partitions.find(row => row.partitionId === facts.syntaxPartitionId);
    const store = createArtifactSemanticStore({ root: path.join(outDir, 'semantic'), repoRoot: facts.repositoryNamespace,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: facts.storage.generation, partitions: [partition] });
    let source = null;
    for await (const header of store.iterateRows(partition.partitionId, 'semantic_sources', { signal, batchRows: 1 })) {
      if (source) throw fail('Call-site semantic partition has multiple source headers.');
      source = header;
    }
    if (!source || source.sourceUnitId !== facts.sourceUnitId || source.byteHash !== facts.sourceHash || source.path !== chunk.file) {
      throw fail('Call-site semantic source header differs from its exact file descriptor.');
    }
    previous = { facts, file: chunk.file, store, source };
    return previous;
  };
  return { async withChunk(chunk, run) {
    throwIfAborted(signal);
    const facts = state?.semanticFactsByFile?.get(chunk.file);
    if (!facts) return run(async () => unavailableCallSiteSemanticRef());
    const { store, source } = await open(chunk, facts);
    return store.withReadScope(() => run(async detail => {
      throwIfAborted(signal);
      if (source.mapping !== null) return unavailableCallSiteSemanticRef('mapped-source-unqualified');
      if (source.coordinateUnit !== 'utf16' || detail.coordinateSystem !== 'utf16') {
        return unavailableCallSiteSemanticRef('coordinate-system-unqualified');
      }
      const ref = detail.semanticRecordRef;
      if (!ref) return unavailableCallSiteSemanticRef(detail.semanticRecordRefReason === 'ambiguous-invocation-span'
        ? 'ambiguous-invocation-span' : 'invocation-reference-unavailable');
      if (ref.partitionId !== facts.syntaxPartitionId) return unavailableCallSiteSemanticRef('invocation-reference-stale');
      const [record] = await store.getRecords([ref], ['span', 'data'], { signal });
      if (!record || record.kind !== 'expression' || !record.data.invocationKind
        || record.span?.[0] !== detail.start || record.span?.[1] !== detail.end
        || detail.start < 0 || detail.end > source.textLength) {
        throw fail('Call-site invocation reference differs from its exact retained record/span.');
      }
      return { schemaVersion: CALL_SITE_SEMANTIC_REF_VERSION, status: 'available', recordRef: { ...ref },
        sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash,
        generation: { ...facts.storage.generation }, coordinateUnit: 'utf16' };
    }));
  } };
};
