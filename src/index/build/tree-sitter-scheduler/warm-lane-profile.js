import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readVerifiedContainedFile } from '../../../shared/contained-file.js';
import { TREE_SITTER_CHUNK_VERSION } from '../../../lang/tree-sitter/config.js';
import { canonicalizeBundlePayloadForChecksum } from '../../../shared/bundle-checksum.js';
const checkoutRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const positive = value => Number.isFinite(value) && value > 0;

/** The already-verified bootstrap receipt participates in profiling identity;
 * this read is NOT a readiness check or a substitute for the executable gate. */
export const resolveWarmLaneProfileIdentity = async treeSitterConfig => {
  try {
    const receipt = await readVerifiedContainedFile(checkoutRoot,
      path.join(checkoutRoot, 'node_modules', '.pairofcleats-bootstrap.json'), { maxBytes: 8 * 1024 * 1024 });
    const value = { version: 1, receipt: receipt.hash, chunkProducer: TREE_SITTER_CHUNK_VERSION,
      node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch,
      cpuModel: os.cpus()[0]?.model || null, policy: treeSitterConfig };
    return createHash('sha256').update(JSON.stringify(canonicalizeBundlePayloadForChecksum(value))).digest('hex');
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
};

export const normalizeWarmLaneObservation = value => {
  if (!value || !/^[a-f0-9]{64}$/.test(value.identity || '') || !positive(value.startupMs)
    || !positive(value.memoryBytes) || !positive(value.costPerMs)
    || !Number.isSafeInteger(value.samples) || value.samples < 1
    || !Number.isFinite(Date.parse(value.at))) return null;
  return { identity: value.identity, startupMs: value.startupMs, memoryBytes: value.memoryBytes,
    costPerMs: value.costPerMs, samples: value.samples, at: value.at };
};
export const mergeWarmLaneObservation = (previous, observed) => {
  const next = normalizeWarmLaneObservation(observed); if (!next) return normalizeWarmLaneObservation(previous);
  const prior = normalizeWarmLaneObservation(previous);
  if (!prior || prior.identity !== next.identity) return next;
  return { identity: next.identity, startupMs: Math.max(prior.startupMs, next.startupMs),
    memoryBytes: Math.max(prior.memoryBytes, next.memoryBytes),
    costPerMs: prior.costPerMs * 0.65 + next.costPerMs * 0.35,
    samples: Math.min(1000000, prior.samples + next.samples), at: next.at };
};

/** Evaluate bounded LPT candidates in cost units. Startup contention is charged
 * per additional child; unsplittable waves remain single assignments. */
export const chooseMeasuredWarmLaneCount = ({ costs, history, identity, execConcurrency,
  executionBudget = null, nowMs = Date.now() }) => {
  const observed = normalizeWarmLaneObservation(history);
  if (!observed || observed.identity !== identity || observed.samples < 3
    || nowMs < Date.parse(observed.at) || nowMs - Date.parse(observed.at) > 7 * 86400000
    || !Array.isArray(costs) || !costs.length || costs.length > 4096 || !costs.every(positive)) return null;
  const memoryPerChild = Math.max(observed.memoryBytes, (executionBudget?.perChildMb || 0) * 1024 * 1024);
  const memoryCap = Number.isFinite(executionBudget?.availableMemoryBytes)
    ? Math.floor(executionBudget.availableMemoryBytes / memoryPerChild) : execConcurrency;
  const maximum = Math.max(1, Math.min(16, costs.length, execConcurrency || 1,
    executionBudget?.effective ?? Number.MAX_SAFE_INTEGER, Math.max(1, memoryCap)));
  const ordered = costs.map((cost, index) => ({ cost, index })).sort((a, b) => b.cost - a.cost || a.index - b.index);
  const total = costs.reduce((sum, cost) => sum + cost, 0);
  if (!Number.isFinite(total)) return null;
  const baseline = total / observed.costPerMs + observed.startupMs;
  let best = { laneCount: 1, predictedMs: baseline };
  for (let count = 2; count <= maximum; count++) {
    const loads = Array(count).fill(0);
    for (const wave of ordered) {
      let least = 0; for (let i = 1; i < count; i++) if (loads[i] < loads[least]) least = i;
      loads[least] += wave.cost;
    }
    const predictedMs = Math.max(...loads) / observed.costPerMs + observed.startupMs * count;
    if (predictedMs < best.predictedMs && baseline - predictedMs >= Math.max(observed.startupMs, baseline * 0.1)) {
      best = { laneCount: count, predictedMs };
    }
  }
  return { ...best, reason: 'qualified-cost-startup-memory', predictedSingleLaneMs: baseline,
    maximumLanes: maximum, totalEstimatedCost: total, largestWaveCost: ordered[0].cost,
    observedStartupMs: observed.startupMs, observedMemoryBytes: observed.memoryBytes };
};
