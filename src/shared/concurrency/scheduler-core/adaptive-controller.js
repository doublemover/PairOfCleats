import { createAdaptiveSignalReader } from './adaptive-signals.js';
import { createAdaptiveSurfaceController } from './adaptive-surface-controller.js';
import { createAdaptiveSurfaceSnapshotHelpers } from './adaptive-surface-snapshots.js';
import { createAdaptiveTokenController } from './adaptive-token-controller.js';

export function createAdaptiveSchedulerController({ config, state, queueLifecycle, admissionReason }) {
  const appendAdaptiveDecision = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    config.adaptiveDecisionTrace.push(entry);
    while (config.adaptiveDecisionTrace.length > config.adaptiveSurfaceDecisionTraceMax) {
      config.adaptiveDecisionTrace.shift();
    }
  };

  const {
    buildAdaptiveSurfaceSnapshotByName,
    buildAdaptiveSurfaceSnapshots
  } = createAdaptiveSurfaceSnapshotHelpers({ config, admissionReason, getStage: () => state.telemetryStage,
    getStageEpoch: () => state.telemetryStageEpoch });
  const { readSystemSignals } = createAdaptiveSignalReader({ config, state });
  const { maybeAdaptSurfaceControllers } = createAdaptiveSurfaceController({
    config,
    state,
    queueLifecycle,
    buildAdaptiveSurfaceSnapshots,
    readSystemSignals,
    appendAdaptiveDecision
  });
  const { maybeAdaptTokens } = createAdaptiveTokenController({
    config,
    state,
    maybeAdaptSurfaceControllers
  });

  return {
    buildAdaptiveSurfaceSnapshotByName,
    buildAdaptiveSurfaceSnapshots,
    readSystemSignals,
    maybeAdaptSurfaceControllers,
    maybeAdaptTokens: () => {
      const previous = state.lastAdaptiveAt;
      maybeAdaptTokens();
      if (state.lastAdaptiveAt !== previous) state.workloadObservation.resourcesChanged();
    }
  };
}
