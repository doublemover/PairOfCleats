import os from 'node:os';

/** Process-available parallelism is admission evidence; host count is diagnostic. */
export const readEffectiveCpu = (input = {}) => {
  let available = input.availableParallelism;
  if (available == null) {
    try { available = os.availableParallelism?.(); } catch {}
  }
  const hostCpuCount = Number.isFinite(input.hostCpuCount) && input.hostCpuCount > 0
    ? Math.floor(input.hostCpuCount) : Math.max(1, os.cpus()?.length || 1);
  const cpuCount = Number.isFinite(available) && available > 0 ? Math.floor(available) : hostCpuCount;
  return { cpuCount, hostCpuCount, method: Number.isFinite(available) && available > 0
    ? 'available-parallelism' : 'host-count-fallback' };
};
