import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { SEMANTIC_SOURCE_SCHEMA } from '../../contracts/schemas/semantic-envelopes.js';
import { admitOwnedSemanticSourceSnapshot } from '../../index/semantic/source-snapshot-admission.js';
import { readRetainedSemanticSourceSnapshot } from '../../semantic/retained-source-snapshot.js';
import { openSemanticQueryStore } from '../../semantic/query-store.js';
import { withSemanticReaderCleanup, semanticReadDeadlineFailure } from '../../semantic/reader-lifetime.js';
import { acquireRepoStorageSession } from '../../shared/storage/repository-session.js';
import { retainSessionFailure } from '../../shared/storage/session.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import { throwIfAborted } from '../../shared/abort.js';
import { deliveryError, deliveryJson } from './manifest.js';
import { canonicalSemanticJson } from '../../index/semantic/identity.js';

const sourceSchema = { ...SEMANTIC_SOURCE_SCHEMA, properties: { ...SEMANTIC_SOURCE_SCHEMA.properties,
  lineStarts: { ...SEMANTIC_SOURCE_SCHEMA.properties.lineStarts, maxItems: 1024 * 1024 + 1 } } };

/** One actual storage session, artifact reader and original contained source
 * read. The existing storage/descriptor owners retain failed cleanup. Recovery
 * releases metadata after original settlement only; it never replays hydration.
 */
export const createSourceHydrationReader = ({ openStore = openSemanticQueryStore,
  readSnapshot = readRetainedSemanticSourceSnapshot } = {}) => async (selection, signal) => {
  const callerSignal = signal, deadline = AbortSignal.timeout(250); signal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  throwIfAborted(signal);
  const { request, repoRoot, cacheRoot, indexDir, userConfig, env } = selection;
  const admission = acquireRepoStorageSession(cacheRoot, { repoRoot, userConfig, env },
    { scope: 'context-source-hydration', resourceRoots: [indexDir] });
  let operationDone = false, released = false, observation = null, primary, failed = false, value;
  const owner = Object.freeze({ kind: 'shared-source-hydration', resourceId: admission.session.resourceId,
    isSettled: () => released,
    releaseAfterOriginalSettlement: () => {
      if (released) return { resourceId: admission.session.resourceId, settled: true, pending: false };
      if (!operationDone || !observation) throw deliveryError('HydrationUnavailable', 'Original source hydration work is still pending.');
      observation.requireSettled();
      admission.session.releaseAfterSettlement({ resourceId: admission.session.resourceId, settled: true, pending: false,
        cacheOwnershipPending: true, cacheOwnershipReleased: () => { observation.requireSettled(); return operationDone; } });
      observation.requireSettled(); released = true; selection.onResourceSettled?.();
      return { resourceId: admission.session.resourceId, settled: true, pending: false };
    } });
  try {
    admission.revalidate(); throwIfAborted(signal);
    const opened = await openStore({ indexDir, repoRoot, generation: request.worldRef.generation, backend: 'artifact', signal });
    const close = opened.close?.bind(opened);
    value = await withSemanticReaderCleanup(async () => {
      const store = opened.store;
      if (store.repoRoot !== repoRoot || store.cursorScope !== request.worldRef.sourceSnapshotId
        || deliveryJson(store.generation) !== deliveryJson(request.worldRef.generation)
        || store.getPartitionSourceUnitId?.(request.partitionId) !== request.sourceUnitId) {
        throw deliveryError('SourceStale', 'Source hydration differs from its pinned repository, inventory or partition.');
      }
      const read = async () => {
        const captured = await readSnapshot({ store, partitionId: request.partitionId, maxBytes: request.maxBytes,
          repositoryNamespace: repoRoot, signal });
        const source = admitOwnedSemanticSourceSnapshot(captured.snapshot, { maxBytes: request.maxBytes, repositoryNamespace: repoRoot });
        if (source.manifest.sourceUnitId !== request.sourceUnitId || source.manifest.byteHash !== request.sourceHash) {
          throw deliveryError('SourceStale', 'Hydrated source identity differs from the requested immutable bytes.');
        }
        // Share immutable text and a deeply captured manifest, never a mutable
        // Buffer or a caller-supplied copied source-capability flag.
        const encoded = canonicalSemanticJson(source.manifest, { maxBytes: 16 * request.maxBytes + 32768 });
        if (Buffer.byteLength(encoded) > 16 * request.maxBytes + 32768) throw deliveryError('MandatoryOverflow', 'Hydrated source metadata exceeds its charged envelope.');
        throwIfAborted(signal);
        return Object.freeze({ source: captureSemanticRequest(source.manifest, sourceSchema), text: source.text });
      };
      return typeof store.withReadScope === 'function' ? store.withReadScope(read) : read();
    }, () => close?.());
    admission.revalidate(); throwIfAborted(signal);
  } catch (error) {
    primary = semanticReadDeadlineFailure(error, { signal: callerSignal, deadline,
      createLimitError: () => deliveryError('HydrationUnavailable', 'Source hydration exceeded its bounded read interval. Select a smaller source window.') });
    failed = true;
  }
  operationDone = true;
  observation = observeStorageResource(failed ? primary : value, { phase: 'shared-source-hydration' });
  try { owner.releaseAfterOriginalSettlement(); }
  catch (settlementError) {
    const retained = retainSessionFailure(primary, settlementError, admission.session,
      { resourceObservation: observation.retain(), primaryPresent: failed });
    throw addStorageFailureContext(retained, { sharedSourceHydrationOwner: owner, cacheOwnershipPending: true,
      cacheOwnershipReleased: owner.isSettled }, null, { forceAggregate: true, nonEnumerable: ['sharedSourceHydrationOwner'] });
  }
  if (failed) throw primary;
  return value;
};
