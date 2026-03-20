import os from 'node:os';

export function createAdaptiveSchedulerController({ config, state, queueLifecycle }) {
  const appendAdaptiveDecision = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    config.adaptiveDecisionTrace.push(entry);
    while (config.adaptiveDecisionTrace.length > config.adaptiveSurfaceDecisionTraceMax) {
      config.adaptiveDecisionTrace.shift();
    }
  };

  const buildAdaptiveSurfaceSnapshotByName = (surfaceName, at = config.nowMs()) => {
    const surfaceState = config.adaptiveSurfaceStates.get(surfaceName);
    if (!surfaceState) return null;
    const snapshot = {
      surface: surfaceName,
      pending: 0,
      pendingBytes: 0,
      running: 0,
      inFlightBytes: 0,
      oldestWaitMs: 0,
      ioPending: 0,
      ioPendingBytes: 0,
      ioWaitP95Ms: 0,
      queues: []
    };
    for (const queue of config.queueOrder) {
      if (queue?.surface !== surfaceName) continue;
      const pending = Math.max(0, queue.pending.length);
      const pendingBytes = config.normalizeByteCount(queue.pendingBytes);
      const running = Math.max(0, queue.running);
      const inFlightBytes = config.normalizeByteCount(queue.inFlightBytes);
      const oldestWaitMs = pending > 0
        ? Math.max(0, at - Number(queue.pending[0]?.enqueuedAt || at))
        : 0;
      const waitP95Ms = Math.max(0, Number(queue?.stats?.waitP95Ms) || 0);
      snapshot.pending += pending;
      snapshot.pendingBytes += pendingBytes;
      snapshot.running += running;
      snapshot.inFlightBytes += inFlightBytes;
      snapshot.oldestWaitMs = Math.max(snapshot.oldestWaitMs, oldestWaitMs);
      if ((pendingBytes > 0) || queue.name.includes('.io') || queue.name.includes('write') || queue.name.includes('sqlite')) {
        snapshot.ioPending += pending;
        snapshot.ioPendingBytes += pendingBytes;
        snapshot.ioWaitP95Ms = Math.max(snapshot.ioWaitP95Ms, waitP95Ms);
      }
      snapshot.queues.push({
        name: queue.name,
        pending,
        pendingBytes,
        running,
        inFlightBytes,
        oldestWaitMs,
        waitP95Ms
      });
    }
    snapshot.backlogPerSlot = snapshot.pending / Math.max(1, surfaceState.currentConcurrency);
    const ioPressureByBytes = snapshot.ioPendingBytes / Math.max(1, 256 * 1024 * 1024);
    const ioPressureByWait = snapshot.ioWaitP95Ms / 10000;
    snapshot.ioPressureScore = Math.max(
      0,
      Math.min(
        1.5,
        Math.max(
          snapshot.ioPending > 0 ? (snapshot.ioPending / Math.max(1, surfaceState.currentConcurrency * 2)) : 0,
          ioPressureByBytes,
          ioPressureByWait
        )
      )
    );
    return snapshot;
  };

  const buildAdaptiveSurfaceSnapshots = (at = config.nowMs()) => {
    const out = {};
    for (const surfaceName of config.adaptiveSurfaceStates.keys()) {
      out[surfaceName] = buildAdaptiveSurfaceSnapshotByName(surfaceName, at);
    }
    return out;
  };

  const readSystemSignals = (at = config.nowMs()) => {
    const cpuTokenUtilization = state.tokens.cpu.total > 0 ? (state.tokens.cpu.used / state.tokens.cpu.total) : 0;
    const ioTokenUtilization = state.tokens.io.total > 0 ? (state.tokens.io.used / state.tokens.io.total) : 0;
    const memTokenUtilization = state.tokens.mem.total > 0 ? (state.tokens.mem.used / state.tokens.mem.total) : 0;
    const defaultFdSignals = {
      softLimit: config.normalizeNonNegativeInt(config.fdPressureRoot?.softLimit, 0),
      reserveDescriptors: config.normalizeNonNegativeInt(config.fdPressureRoot?.reserveDescriptors, 0),
      descriptorsPerToken: Math.max(
        1,
        config.normalizePositiveInt(config.fdPressureRoot?.descriptorsPerToken, 8) || 8
      ),
      minTokenCap: Math.max(1, config.normalizePositiveInt(config.fdPressureRoot?.minTokenCap, 1) || 1),
      maxTokenCap: Math.max(
        1,
        config.normalizePositiveInt(config.fdPressureRoot?.maxTokenCap, config.maxLimits.io) || config.maxLimits.io
      ),
      tokenCap: Math.max(1, Math.floor(state.tokens.io.total || 1)),
      pressureScore: 0
    };
    const defaultSignals = {
      cpu: {
        tokenUtilization: Math.max(cpuTokenUtilization, ioTokenUtilization),
        loadRatio: 0
      },
      memory: {
        rssBytes: 0,
        heapUsedBytes: 0,
        heapTotalBytes: 0,
        freeBytes: 0,
        totalBytes: 0,
        rssUtilization: null,
        heapUtilization: null,
        freeRatio: null,
        pressureScore: Math.max(memTokenUtilization, 0),
        gcPressureScore: 0
      },
      fd: defaultFdSignals
    };
    if (typeof config.input.adaptiveSignalSampler === 'function') {
      try {
        const sampled = config.input.adaptiveSignalSampler({
          at,
          stage: state.telemetryStage,
          tokens: {
            cpu: { ...state.tokens.cpu },
            io: { ...state.tokens.io },
            mem: { ...state.tokens.mem }
          }
        });
        if (sampled && typeof sampled === 'object') {
          const cpuToken = config.normalizeRatio(
            sampled?.cpu?.tokenUtilization,
            defaultSignals.cpu.tokenUtilization,
            { min: 0, max: 1.5 }
          );
          const cpuLoad = config.normalizeRatio(
            sampled?.cpu?.loadRatio,
            defaultSignals.cpu.loadRatio,
            { min: 0, max: 2 }
          );
          const pressureScore = config.normalizeRatio(
            sampled?.memory?.pressureScore,
            defaultSignals.memory.pressureScore,
            { min: 0, max: 2 }
          );
          const gcPressureScore = config.normalizeRatio(
            sampled?.memory?.gcPressureScore,
            defaultSignals.memory.gcPressureScore,
            { min: 0, max: 2 }
          );
          defaultSignals.cpu = {
            tokenUtilization: cpuToken,
            loadRatio: cpuLoad
          };
          defaultSignals.memory = {
            ...defaultSignals.memory,
            pressureScore,
            gcPressureScore,
            rssBytes: config.normalizeNonNegativeInt(sampled?.memory?.rssBytes, defaultSignals.memory.rssBytes),
            heapUsedBytes: config.normalizeNonNegativeInt(sampled?.memory?.heapUsedBytes, defaultSignals.memory.heapUsedBytes),
            heapTotalBytes: config.normalizeNonNegativeInt(sampled?.memory?.heapTotalBytes, defaultSignals.memory.heapTotalBytes),
            freeBytes: config.normalizeNonNegativeInt(sampled?.memory?.freeBytes, defaultSignals.memory.freeBytes),
            totalBytes: config.normalizeNonNegativeInt(sampled?.memory?.totalBytes, defaultSignals.memory.totalBytes),
            rssUtilization: config.normalizeRatio(sampled?.memory?.rssUtilization, defaultSignals.memory.rssUtilization, { min: 0, max: 1 }),
            heapUtilization: config.normalizeRatio(sampled?.memory?.heapUtilization, defaultSignals.memory.heapUtilization, { min: 0, max: 1 }),
            freeRatio: config.normalizeRatio(sampled?.memory?.freeRatio, defaultSignals.memory.freeRatio, { min: 0, max: 1 })
          };
          const sampledFdTokenCap = config.normalizePositiveInt(
            sampled?.fd?.tokenCap,
            defaultSignals.fd.tokenCap
          );
          const sampledFdMaxTokenCap = Math.max(
            defaultSignals.fd.minTokenCap,
            config.normalizePositiveInt(sampled?.fd?.maxTokenCap, defaultSignals.fd.maxTokenCap)
              || defaultSignals.fd.maxTokenCap
          );
          defaultSignals.fd = {
            softLimit: config.normalizeNonNegativeInt(sampled?.fd?.softLimit, defaultSignals.fd.softLimit),
            reserveDescriptors: config.normalizeNonNegativeInt(sampled?.fd?.reserveDescriptors, defaultSignals.fd.reserveDescriptors),
            descriptorsPerToken: Math.max(
              1,
              config.normalizePositiveInt(sampled?.fd?.descriptorsPerToken, defaultSignals.fd.descriptorsPerToken)
                || defaultSignals.fd.descriptorsPerToken
            ),
            minTokenCap: Math.max(
              1,
              config.normalizePositiveInt(sampled?.fd?.minTokenCap, defaultSignals.fd.minTokenCap) || defaultSignals.fd.minTokenCap
            ),
            maxTokenCap: sampledFdMaxTokenCap,
            tokenCap: Math.max(
              1,
              Math.min(sampledFdMaxTokenCap, sampledFdTokenCap || defaultSignals.fd.tokenCap)
            ),
            pressureScore: config.normalizeRatio(
              sampled?.fd?.pressureScore,
              defaultSignals.fd.pressureScore,
              { min: 0, max: 2 }
            )
          };
          return defaultSignals;
        }
      } catch {}
    }
    const cpuCount = typeof os.availableParallelism === 'function'
      ? Math.max(1, os.availableParallelism())
      : Math.max(1, os.cpus().length || 1);
    const loadAvg = typeof os.loadavg === 'function' ? os.loadavg() : null;
    const loadRatio = Array.isArray(loadAvg) && Number.isFinite(loadAvg[0]) && cpuCount > 0
      ? Math.max(0, Math.min(2, Number(loadAvg[0]) / cpuCount))
      : 0;
    let rssBytes = 0;
    let heapUsedBytes = 0;
    let heapTotalBytes = 0;
    try {
      const usage = process.memoryUsage();
      rssBytes = Number(usage?.rss) || 0;
      heapUsedBytes = Number(usage?.heapUsed) || 0;
      heapTotalBytes = Number(usage?.heapTotal) || 0;
    } catch {}
    const totalBytes = Number(os.totalmem()) || 0;
    const freeBytes = Number(os.freemem()) || 0;
    const rssUtilization = totalBytes > 0 ? Math.max(0, Math.min(1, rssBytes / totalBytes)) : null;
    const heapUtilization = heapTotalBytes > 0 ? Math.max(0, Math.min(1, heapUsedBytes / heapTotalBytes)) : null;
    const freeRatio = totalBytes > 0 ? Math.max(0, Math.min(1, freeBytes / totalBytes)) : null;
    const freePressure = Number.isFinite(freeRatio) ? (1 - freeRatio) : 0;
    const memoryPressureScore = Math.max(
      memTokenUtilization,
      Number.isFinite(rssUtilization) ? rssUtilization : 0,
      Number.isFinite(heapUtilization) ? heapUtilization : 0,
      freePressure
    );
    let gcPressureScore = 0;
    if (state.lastMemorySignals && Number(state.lastMemorySignals.heapUsedBytes) > 0) {
      const priorHeap = Number(state.lastMemorySignals.heapUsedBytes) || 0;
      const delta = priorHeap - heapUsedBytes;
      if (delta > 0) {
        gcPressureScore = Math.max(0, Math.min(1, delta / Math.max(1, priorHeap)));
      }
    }
    state.lastMemorySignals = { heapUsedBytes };
    return {
      cpu: {
        tokenUtilization: Math.max(cpuTokenUtilization, ioTokenUtilization),
        loadRatio
      },
      memory: {
        rssBytes,
        heapUsedBytes,
        heapTotalBytes,
        freeBytes,
        totalBytes,
        rssUtilization,
        heapUtilization,
        freeRatio,
        pressureScore: memoryPressureScore,
        gcPressureScore
      },
      fd: defaultFdSignals
    };
  };

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

  const maybeAdaptTokens = () => {
    if (!config.adaptiveEnabled || state.shuttingDown) return;
    const now = config.nowMs();
    if ((now - state.lastAdaptiveAt) < state.adaptiveCurrentIntervalMs) return;
    state.lastAdaptiveAt = now;
    maybeAdaptSurfaceControllers(now);
    const fdTokenCapSignal = Number(state.lastSystemSignals?.fd?.tokenCap);
    const fdTokenCap = Number.isFinite(fdTokenCapSignal) && fdTokenCapSignal > 0
      ? Math.max(1, Math.floor(fdTokenCapSignal))
      : null;
    if (fdTokenCap != null) {
      state.tokens.io.total = Math.max(state.tokens.io.used, Math.min(state.tokens.io.total, fdTokenCap));
    }
    let totalPending = 0;
    let totalPendingBytes = 0;
    let totalRunning = 0;
    let totalRunningBytes = 0;
    let starvedQueues = 0;
    for (const queue of config.queueOrder) {
      totalPending += queue.pending.length;
      totalPendingBytes += config.normalizeByteCount(queue.pendingBytes);
      totalRunning += queue.running;
      totalRunningBytes += config.normalizeByteCount(queue.inFlightBytes);
      if (queue.pending.length > 0 && queue.running === 0) {
        starvedQueues += 1;
      }
    }
    let floorCpu = 0;
    let floorIo = 0;
    let floorMem = 0;
    for (const queue of config.queueOrder) {
      if ((queue.pending.length + queue.running) <= 0) continue;
      floorCpu = Math.max(floorCpu, Number(queue.floorCpu) || 0);
      floorIo = Math.max(floorIo, Number(queue.floorIo) || 0);
      floorMem = Math.max(floorMem, Number(queue.floorMem) || 0);
    }
    const cpuFloor = Math.max(config.baselineLimits.cpu, floorCpu);
    const ioBaselineFloor = Math.max(config.baselineLimits.io, floorIo);
    const ioFloor = fdTokenCap == null
      ? ioBaselineFloor
      : Math.max(1, Math.min(ioBaselineFloor, fdTokenCap));
    const memFloor = Math.max(config.baselineLimits.mem, floorMem);
    const tokenBudget = Math.max(1, state.tokens.cpu.total + state.tokens.io.total);
    const memoryTokenBudgetBytes = Math.max(1, state.tokens.mem.total) * config.adaptiveMemoryPerTokenMb * 1024 * 1024;
    const pendingBytePressure = totalPendingBytes > Math.max(
      4 * 1024 * 1024,
      Math.floor(memoryTokenBudgetBytes * 0.2)
    );
    const runningBytePressure = totalRunningBytes > Math.max(
      8 * 1024 * 1024,
      Math.floor(memoryTokenBudgetBytes * 0.35)
    );
    const bytePressure = pendingBytePressure || runningBytePressure;
    const pendingDemand = totalPending > 0;
    const pendingPressure = totalPending > Math.max(1, Math.floor(tokenBudget * 0.35));
    const mostlyIdle = totalPending === 0 && totalRunning === 0 && totalRunningBytes === 0;
    const cpuUtilization = state.tokens.cpu.total > 0 ? (state.tokens.cpu.used / state.tokens.cpu.total) : 0;
    const ioUtilization = state.tokens.io.total > 0 ? (state.tokens.io.used / state.tokens.io.total) : 0;
    const memUtilization = state.tokens.mem.total > 0 ? (state.tokens.mem.used / state.tokens.mem.total) : 0;
    const utilization = Math.max(cpuUtilization, ioUtilization, memUtilization);
    const smooth = (prev, next, alpha = 0.25) => (
      prev == null ? next : ((prev * (1 - alpha)) + (next * alpha))
    );
    state.smoothedUtilization = smooth(state.smoothedUtilization, utilization);
    state.smoothedPendingPressure = smooth(
      state.smoothedPendingPressure,
      Math.max(totalPending / Math.max(1, tokenBudget), totalPendingBytes / Math.max(1, memoryTokenBudgetBytes))
    );
    state.smoothedStarvation = smooth(
      state.smoothedStarvation,
      config.queueOrder.length > 0 ? (starvedQueues / config.queueOrder.length) : 0
    );
    const smoothedUtilizationValue = state.smoothedUtilization ?? utilization;
    const smoothedStarvationValue = state.smoothedStarvation ?? 0;
    const smoothedUtilizationDeficit = smoothedUtilizationValue < config.adaptiveTargetUtilization;
    const severeUtilizationDeficit = utilization < (config.adaptiveTargetUtilization * 0.7);
    const starvationScore = starvedQueues + Math.round(smoothedStarvationValue * 2);
    if (pendingPressure || bytePressure || starvationScore > 0) {
      state.adaptiveCurrentIntervalMs = Math.max(50, Math.floor(config.adaptiveMinIntervalMs * 0.5));
    } else if (mostlyIdle) {
      state.adaptiveCurrentIntervalMs = Math.min(2000, Math.max(config.adaptiveMinIntervalMs, Math.floor(config.adaptiveMinIntervalMs * 2)));
    } else {
      state.adaptiveCurrentIntervalMs = config.adaptiveMinIntervalMs;
    }
    const totalMem = Number(os.totalmem()) || 0;
    const freeMem = Number(os.freemem()) || 0;
    const freeRatio = totalMem > 0 ? (freeMem / totalMem) : null;
    const headroomBytes = Number.isFinite(totalMem) && Number.isFinite(freeMem)
      ? Math.max(0, freeMem)
      : 0;
    const memoryLowHeadroom = Number.isFinite(freeRatio) && freeRatio < 0.15;
    const memoryHighHeadroom = !Number.isFinite(freeRatio) || freeRatio > 0.25;
    let memoryTokenHeadroomCap = config.maxLimits.mem;
    if (Number.isFinite(freeMem) && freeMem > 0) {
      const reserveBytes = config.adaptiveMemoryReserveMb * 1024 * 1024;
      const bytesPerToken = config.adaptiveMemoryPerTokenMb * 1024 * 1024;
      const availableBytes = Math.max(0, freeMem - reserveBytes);
      const headroomTokens = Math.max(1, Math.floor(availableBytes / Math.max(1, bytesPerToken)));
      memoryTokenHeadroomCap = Math.max(
        config.baselineLimits.mem,
        Math.min(config.maxLimits.mem, headroomTokens)
      );
      if (state.tokens.mem.total > memoryTokenHeadroomCap) {
        state.tokens.mem.total = Math.max(state.tokens.mem.used, memoryTokenHeadroomCap);
      }
    }

    if (memoryLowHeadroom) {
      state.adaptiveMode = 'steady';
      state.tokens.cpu.total = Math.max(cpuFloor, state.tokens.cpu.used, state.tokens.cpu.total - config.adaptiveStep);
      state.tokens.io.total = Math.max(ioFloor, state.tokens.io.used, state.tokens.io.total - config.adaptiveStep);
      state.tokens.mem.total = Math.max(
        memFloor,
        state.tokens.mem.used,
        Math.min(memoryTokenHeadroomCap, state.tokens.mem.total - config.adaptiveStep)
      );
      return;
    }

    if (memoryHighHeadroom && pendingDemand && smoothedUtilizationDeficit) {
      state.burstModeUntilMs = Math.max(state.burstModeUntilMs, now + 1500);
    }
    const burstMode = now < state.burstModeUntilMs;
    const queueStarvation = starvationScore > 0;
    const shouldScaleFromHeadroom = memoryHighHeadroom
      && pendingDemand
      && (smoothedUtilizationDeficit || queueStarvation || burstMode)
      && (totalRunning > 0 || queueStarvation || severeUtilizationDeficit);
    const shouldScale = memoryHighHeadroom && (
      pendingPressure
      || bytePressure
      || queueStarvation
      || burstMode
      || shouldScaleFromHeadroom
      || (pendingDemand && smoothedUtilizationDeficit)
    );
    if (shouldScale) {
      state.adaptiveMode = burstMode ? 'burst' : 'steady';
      const pressureScale = pendingPressure || bytePressure;
      const scaleStep = (pressureScale && (queueStarvation || severeUtilizationDeficit))
        ? config.adaptiveStep + 2
        : ((pressureScale || queueStarvation) ? config.adaptiveStep + 1 : config.adaptiveStep);
      const effectiveScaleStep = burstMode ? (scaleStep + 1) : scaleStep;
      const nextCpu = Math.min(config.maxLimits.cpu, state.tokens.cpu.total + effectiveScaleStep);
      const ioCeiling = fdTokenCap == null ? config.maxLimits.io : Math.min(config.maxLimits.io, fdTokenCap);
      const nextIo = Math.min(ioCeiling, state.tokens.io.total + effectiveScaleStep);
      const nextMem = Math.min(config.maxLimits.mem, memoryTokenHeadroomCap, state.tokens.mem.total + config.adaptiveStep);
      state.tokens.cpu.total = nextCpu;
      state.tokens.io.total = nextIo;
      state.tokens.mem.total = nextMem;
      return;
    }
    const settleMode = !mostlyIdle
      && !pendingDemand
      && !bytePressure
      && now >= state.burstModeUntilMs
      && utilization >= config.adaptiveTargetUtilization
      && (
        state.tokens.cpu.total > config.baselineLimits.cpu
        || state.tokens.io.total > config.baselineLimits.io
        || state.tokens.mem.total > config.baselineLimits.mem
      );
    if (settleMode) {
      state.adaptiveMode = 'settle';
      state.tokens.cpu.total = Math.max(cpuFloor, state.tokens.cpu.used, state.tokens.cpu.total - config.adaptiveStep);
      state.tokens.io.total = Math.max(ioFloor, state.tokens.io.used, state.tokens.io.total - config.adaptiveStep);
      state.tokens.mem.total = Math.max(memFloor, state.tokens.mem.used, state.tokens.mem.total - config.adaptiveStep);
      return;
    }

    if (
      memoryHighHeadroom
      && headroomBytes > (config.adaptiveMemoryReserveMb * 1024 * 1024)
      && (totalPending > 0 || totalPendingBytes > 0)
      && state.tokens.mem.total < memoryTokenHeadroomCap
    ) {
      state.tokens.mem.total = Math.min(memoryTokenHeadroomCap, state.tokens.mem.total + config.adaptiveStep);
    }

    if (mostlyIdle) {
      state.adaptiveMode = 'steady';
      state.tokens.cpu.total = Math.max(cpuFloor, state.tokens.cpu.used, state.tokens.cpu.total - config.adaptiveStep);
      state.tokens.io.total = Math.max(ioFloor, state.tokens.io.used, state.tokens.io.total - config.adaptiveStep);
      state.tokens.mem.total = Math.max(memFloor, state.tokens.mem.used, state.tokens.mem.total - config.adaptiveStep);
    }
    if (fdTokenCap != null) {
      state.tokens.io.total = Math.max(state.tokens.io.used, Math.min(state.tokens.io.total, fdTokenCap));
    }
  };

  return {
    buildAdaptiveSurfaceSnapshotByName,
    buildAdaptiveSurfaceSnapshots,
    readSystemSignals,
    maybeAdaptSurfaceControllers,
    maybeAdaptTokens
  };
}
