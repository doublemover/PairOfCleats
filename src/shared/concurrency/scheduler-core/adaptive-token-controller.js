import os from 'node:os';

export function createAdaptiveTokenController({
  config,
  state,
  maybeAdaptSurfaceControllers
}) {
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

  return { maybeAdaptTokens };
}
