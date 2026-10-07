export function createAdaptiveSurfaceController({
  config,
  state,
  queueLifecycle,
  buildAdaptiveSurfaceSnapshots,
  readSystemSignals,
  appendAdaptiveDecision
}) {
  const maybeAdaptSurfaceControllers = (now) => {
    if (!config.adaptiveSurfaceControllersEnabled) return;
    const at = Number.isFinite(Number(now)) ? Number(now) : config.nowMs();
    const snapshots = buildAdaptiveSurfaceSnapshots(at);
    const signals = readSystemSignals(at);
    state.lastSystemSignals = signals;
    for (const [surfaceName, surfaceState] of config.adaptiveSurfaceStates.entries()) {
      const snapshot = snapshots[surfaceName];
      if (!snapshot) continue;
      const previousConcurrency = surfaceState.currentConcurrency;
      const running = Math.max(
        Math.max(0, Number(snapshot.running) || 0),
        queueLifecycle.countSurfaceRunning(surfaceName)
      );
      const backlogPerSlot = Math.max(0, Number(snapshot.backlogPerSlot) || 0);
      const oldestWaitMs = Math.max(0, Number(snapshot.oldestWaitMs) || 0);
      const fdPressureScore = Math.max(0, Number(signals?.fd?.pressureScore) || 0);
      const ioPressureScore = Math.max(
        0,
        Number(snapshot.ioPressureScore) || 0,
        fdPressureScore
      );
      const cpuUtilization = Math.max(
        0,
        Number(signals?.cpu?.tokenUtilization) || 0,
        Number(signals?.cpu?.loadRatio) || 0
      );
      const memoryPressure = Math.max(0, Number(signals?.memory?.pressureScore) || 0);
      const gcPressure = Math.max(0, Number(signals?.memory?.gcPressureScore) || 0);
      const ioPressureThreshold = Math.min(
        surfaceState.ioPressureThreshold,
        surfaceState.fdPressureThreshold ?? surfaceState.ioPressureThreshold
      );
      let action = 'hold';
      let reason = 'steady';
      if (
        memoryPressure >= surfaceState.memoryPressureThreshold
        || gcPressure >= surfaceState.gcPressureThreshold
        || ioPressureScore >= ioPressureThreshold
      ) {
        action = 'down';
        reason = memoryPressure >= surfaceState.memoryPressureThreshold
          ? 'memory-pressure'
          : (
            gcPressure >= surfaceState.gcPressureThreshold
              ? 'gc-pressure'
              : (
                ioPressureScore >= (surfaceState.fdPressureThreshold ?? Number.POSITIVE_INFINITY)
                  ? 'fd-pressure'
                  : 'io-pressure'
              )
          );
      } else if (
        backlogPerSlot >= surfaceState.upBacklogPerSlot
        && oldestWaitMs >= surfaceState.upWaitMs
        && cpuUtilization <= Math.max(1, surfaceState.targetUtilization + 0.15)
      ) {
        action = 'up';
        reason = 'backlog';
      } else if (
        backlogPerSlot <= surfaceState.downBacklogPerSlot
        && oldestWaitMs <= surfaceState.downWaitMs
        && running < surfaceState.currentConcurrency
      ) {
        action = 'down';
        reason = 'drain';
      }
      let nextConcurrency = surfaceState.currentConcurrency;
      if (action === 'up') {
        const inUpCooldown = (at - surfaceState.lastScaleUpAt) < surfaceState.upCooldownMs;
        const inOscillationGuard = surfaceState.lastAction === 'down'
          && (at - surfaceState.lastScaleDownAt) < surfaceState.oscillationGuardMs;
        if (
          surfaceState.currentConcurrency < surfaceState.maxConcurrency
          && !inUpCooldown
          && !inOscillationGuard
        ) {
          nextConcurrency = Math.min(surfaceState.maxConcurrency, surfaceState.currentConcurrency + 1);
        } else {
          action = 'hold';
          reason = inUpCooldown ? 'up-cooldown' : (inOscillationGuard ? 'oscillation-guard' : 'at-max');
        }
      } else if (action === 'down') {
        const inDownCooldown = (at - surfaceState.lastScaleDownAt) < surfaceState.downCooldownMs;
        const inOscillationGuard = surfaceState.lastAction === 'up'
          && (at - surfaceState.lastScaleUpAt) < surfaceState.oscillationGuardMs;
        if (
          surfaceState.currentConcurrency > surfaceState.minConcurrency
          && !inDownCooldown
          && !inOscillationGuard
        ) {
          nextConcurrency = Math.max(surfaceState.minConcurrency, surfaceState.currentConcurrency - 1);
        } else {
          action = 'hold';
          reason = inDownCooldown ? 'down-cooldown' : (inOscillationGuard ? 'oscillation-guard' : 'at-min');
        }
      }
      if (nextConcurrency !== surfaceState.currentConcurrency) {
        if (nextConcurrency > surfaceState.currentConcurrency) {
          surfaceState.lastScaleUpAt = at;
        } else {
          surfaceState.lastScaleDownAt = at;
        }
        surfaceState.currentConcurrency = nextConcurrency;
      } else {
        action = 'hold';
      }
      surfaceState.lastDecisionAt = at;
      surfaceState.lastAction = action;
      surfaceState.decisions[action] = (surfaceState.decisions[action] || 0) + 1;
      surfaceState.lastDecision = {
        at,
        action,
        reason,
        previousConcurrency,
        nextConcurrency: surfaceState.currentConcurrency,
        backlogPerSlot,
        oldestWaitMs,
        ioPressureScore,
        cpuUtilization,
        memoryPressure,
        gcPressure
      };
      state.adaptiveDecisionId += 1;
      appendAdaptiveDecision({
        id: state.adaptiveDecisionId,
        at,
        surface: surfaceName,
        action,
        reason,
        nextConcurrency: surfaceState.currentConcurrency,
        snapshot: {
          pending: snapshot.pending,
          running,
          backlogPerSlot,
          oldestWaitMs,
          ioPressureScore
        },
        signals: {
          cpu: signals?.cpu && typeof signals.cpu === 'object' ? { ...signals.cpu } : null,
          memory: signals?.memory && typeof signals.memory === 'object' ? { ...signals.memory } : null,
          fd: signals?.fd && typeof signals.fd === 'object' ? { ...signals.fd } : null
        }
      });
    }
  };

  return { maybeAdaptSurfaceControllers };
}
