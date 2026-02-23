import os from 'node:os';

/**
 * Build a deterministic NUMA assignment plan for worker slots.
 *
 * This is an advisory policy layer for worker-thread pools: it computes stable
 * node assignments and emits node hints in worker metadata/stats. On unsupported
 * hosts it degrades to an explicit inactive reason.
 *
 * @param {{config?:object,maxWorkers:number}} input
 * @returns {{enabled:boolean,active:boolean,reason:string|null,strategy:string,nodeCount:number,assignments:number[]}}
 */
export const resolveNumaPinningPlan = ({ config, maxWorkers }) => {
  const policy = config?.numaPinning && typeof config.numaPinning === 'object'
    ? config.numaPinning
    : { enabled: false };
  if (policy.enabled !== true) {
    return {
      enabled: false,
      active: false,
      reason: 'disabled',
      strategy: 'interleave',
      nodeCount: 1,
      assignments: []
    };
  }
  if (process.platform !== 'linux') {
    return {
      enabled: true,
      active: false,
      reason: 'unsupported-platform',
      strategy: policy.strategy || 'interleave',
      nodeCount: 1,
      assignments: []
    };
  }
  const cpuCount = Array.isArray(os.cpus()) ? os.cpus().length : 0;
  const minCpuCores = Number.isFinite(Number(policy.minCpuCores))
    ? Math.max(1, Math.floor(Number(policy.minCpuCores)))
    : 24;
  if (!Number.isFinite(cpuCount) || cpuCount < minCpuCores) {
    return {
      enabled: true,
      active: false,
      reason: 'insufficient-cpu-cores',
      strategy: policy.strategy || 'interleave',
      nodeCount: 1,
      assignments: []
    };
  }
  const requestedNodes = Number.isFinite(Number(policy.nodeCount))
    ? Math.max(1, Math.floor(Number(policy.nodeCount)))
    : null;
  const inferredNodes = Number.isFinite(cpuCount)
    ? Math.max(1, Math.floor(cpuCount / 16))
    : 1;
  const nodeCount = Math.max(1, Math.min(requestedNodes || inferredNodes, maxWorkers));
  if (nodeCount <= 1) {
    return {
      enabled: true,
      active: false,
      reason: 'single-node-topology',
      strategy: policy.strategy || 'interleave',
      nodeCount: 1,
      assignments: []
    };
  }
  const strategy = policy.strategy === 'compact' ? 'compact' : 'interleave';
  const workers = Math.max(1, Math.floor(Number(maxWorkers) || 1));
  const assignments = new Array(workers);
  if (strategy === 'compact') {
    const workersPerNode = Math.max(1, Math.ceil(workers / nodeCount));
    for (let slot = 0; slot < workers; slot += 1) {
      assignments[slot] = Math.min(nodeCount - 1, Math.floor(slot / workersPerNode));
    }
  } else {
    for (let slot = 0; slot < workers; slot += 1) {
      assignments[slot] = slot % nodeCount;
    }
  }
  return {
    enabled: true,
    active: true,
    reason: null,
    strategy,
    nodeCount,
    assignments
  };
};
