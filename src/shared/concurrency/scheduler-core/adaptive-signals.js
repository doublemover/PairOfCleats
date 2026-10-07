import os from 'node:os';

export function createAdaptiveSignalReader({ config, state }) {
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

  return { readSystemSignals };
}
