import { createAdaptiveSignalReader } from './adaptive-signals.js';
import { createAdaptiveSurfaceController } from './adaptive-surface-controller.js';
import { createAdaptiveSurfaceSnapshotHelpers } from './adaptive-surface-snapshots.js';
import { createAdaptiveTokenController } from './adaptive-token-controller.js';

export function createAdaptiveSchedulerController({ config, state, queueLifecycle }) {
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
  } = createAdaptiveSurfaceSnapshotHelpers({ config });
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
    maybeAdaptTokens
  };
}
