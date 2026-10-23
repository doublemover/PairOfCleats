import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { assertArtifactPublicationReady } from '../../../index/build/artifact-publication.js';
import { readCompletedStage, verifyCompletedStage } from '../../../index/build/completed-stage.js';
import { updateBuildState } from '../../../index/build/build-state.js';
import { resolveStageSnapshotRoot, snapshotStageOutput, verifyStageSnapshot } from '../../../index/build/stage-snapshot.js';
import { inventoryStageOutput, readBuildMetadata, sameStagePath } from '../../../index/build/stage-output.js';
import { GRAPH_CAPABILITY_REQUIRED_FAMILIES, withGraphCapability } from '../../../index/build/graph-capability.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_GRAPH_CAPABILITY_UNAVAILABLE' });

/** Existing failed roots gain graph authority only from independent validation
 * of exact retained inputs. Unknown historical producer/source facts stay unknown.
 */
export const sealRetainedGraph = async ({ root, userConfig, buildRoot, buildId, repoCacheRoot, lease, signal }) => {
  const { value: state } = await readBuildMetadata(buildRoot, path.join(buildRoot, 'build_state.json'), 8 * 1024 * 1024, signal);
  const existing = state.graphCapabilities?.code || state.completedStages?.code?.snapshot;
  if (existing?.graphCapability?.status === 'ready') {
    return withRetainedGraph({ root, userConfig, buildRoot, buildId, locator: existing, signal }, receipt => receipt);
  }
  await assertArtifactPublicationReady({ buildRoot, modes: ['code'] });
  const selected = piece => GRAPH_CAPABILITY_REQUIRED_FAMILIES.includes(piece.name) || piece.name.startsWith('semantic_');
  const { manifest, inventory, output } = await inventoryStageOutput({ buildRoot, buildId, mode: 'code', signal, select: selected });
  const completion = { schemaVersion: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, stage: 'graph-recovery', mode: 'code',
    buildId, buildRoot: path.resolve(buildRoot), repoRoot: path.resolve(root), output,
    producer: { identity: null, reason: 'historical-producer-not-established' }, sourceSnapshot: null,
    reusePolicy: null, reuseAuthority: 'historical-graph-only' };
  const locator = await snapshotStageOutput({ runtime: { root, buildRoot, buildId, repoCacheRoot, cacheWriterLease: lease },
    mode: 'code', manifest, inventory, output, completion, signal, graphOnly: true });
  if (locator.graphCapability?.status !== 'ready') throw fail(locator.graphCapability?.reason || 'Graph validation did not grant a capability.');
  await updateBuildState(buildRoot, { graphCapabilities: { ...(state.graphCapabilities || {}), code: locator } });
  return withRetainedGraph({ root, userConfig, buildRoot, buildId, locator, signal }, receipt => receipt);
};

/** The caller supplies only an exact generation and opaque capability id. The
 * backend resolves and verifies its own locator; caller code cannot replace validation.
 */
export const withRetainedGraph = async ({ root, userConfig, buildRoot, buildId, capabilityId = null, locator = null, signal }, consume) => {
  if (!locator) {
    const { value: state } = await readBuildMetadata(buildRoot, path.join(buildRoot, 'build_state.json'), 8 * 1024 * 1024, signal);
    locator = state.graphCapabilities?.code || (await readCompletedStage({ buildRoot, mode: 'code', state, signal }))?.snapshot;
  }
  if (locator?.graphCapability?.status !== 'ready' || capabilityId && locator.graphCapability.capabilityId !== capabilityId) throw fail('No matching validated graph capability exists in this exact generation.');
  const indexRoot = resolveStageSnapshotRoot(buildRoot, locator);
  return withGraphCapability({ root, userConfig, indexRoot, capabilityId: capabilityId || locator.graphCapability.capabilityId,
    signal, verifySnapshot: async receipt => {
      const verified = await verifyStageSnapshot({ buildRoot, buildId, repoRoot: root, mode: 'code', locator, signal });
      if (receipt.buildId !== buildId || receipt.descriptorHash !== locator.descriptorHash
        || !sameStagePath(receipt.sourceBuildRoot, buildRoot)) throw fail('Graph capability source authority changed.');
      if (verified.descriptor.completion.stage === 'stage2') {
        await verifyCompletedStage({ buildRoot, buildId, repoRoot: root, mode: 'code', snapshot: true, signal });
      }
    } }, consume);
};
