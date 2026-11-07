import { createFileSchedulerShadow, createSchedulerReplayProfileIdentity } from './scheduler-shadow.js';

/** Production ordered admission has conditional backpressure and soft windows,
 * not an unconditional maximum distance from the commit frontier. Keep that
 * missing constraint explicit rather than claiming counterfactual eligibility.
 */
export const attachStage1SchedulerShadow = ({ runtime, mode, perfProfile, previousProfile,
  orderedAppender, resolveOrderIndex } = {}) => {
  const enabled = runtime?.learnedAutoProfile?.enabled === true;
  const producer = runtime?.stageProducer;
  const qualifiedProducer = typeof producer?.identity === 'string' && producer.identity.length > 0
    && producer.evidenceScope === 'observed-implementation-files-and-bootstrap-receipt'
    && runtime.stageReuseEnvironment && typeof runtime.stageReuseEnvironment === 'object';
  let identity = null;
  if (enabled && qualifiedProducer) {
    identity = createSchedulerReplayProfileIdentity({
      configHash: runtime.configHash, mode, parserIdentity: runtime.languageOptions,
      runtimeIdentity: { producer, environment: runtime.stageReuseEnvironment },
      repositoryFeatures: runtime.learnedAutoProfile.features,
      resourceIdentity: runtime.scheduler?.getDispatchReplayResourceIdentity?.(),
      features: perfProfile?.features
    });
  }
  if (enabled && perfProfile) perfProfile.schedulerReplayIdentity = identity;
  const shadow = createFileSchedulerShadow({ learnedAutoProfile: runtime?.learnedAutoProfile,
    perfProfile: previousProfile, identity, mode, currentBuildId: runtime?.buildId,
    resolveOrderIndex,
    getCommitState: () => ({ nextIndex: orderedAppender?.peekNextIndex?.() ?? null, maxAhead: null }) });
  runtime?.scheduler?.setDispatchReplayContext?.(shadow.context);
  return shadow;
};
