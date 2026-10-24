import { getNodeStartupInputs, observeRuntimeProcess } from '../runtime-envelope/observe.js';
import { resolveNodeHeapSource, sanitizeNodeStartupOptions } from './node-argv.js';

const MIB = 1024 * 1024;
// Node 26's V8 divides the young-generation constraint into three semi-spaces,
// then rounds a scavenger semi-space up to a power of two (minimum 1 MiB).
// This is a total-heap ceiling, never an observed old-generation measurement.
// https://github.com/nodejs/node/blob/v26.12.1/deps/v8/src/heap/heap.cc#L4592-L4634
const youngGenerationCeilingBytes = (youngMb) => Number.isFinite(youngMb) && youngMb > 0
  ? 3 * Math.max(MIB, 2 ** Math.ceil(Math.log2(Math.floor(youngMb * MIB / 3)))) : null;

/** V8 startup heap flags are process-global, including Worker isolates. */
export const resolveWorkerHeapLaunchContract = (resourceLimits, startup = getNodeStartupInputs()) => {
  const requestedOldGenerationSizeMb = Number(resourceLimits?.maxOldGenerationSizeMb) || null;
  const parent = resolveNodeHeapSource(startup);
  const options = sanitizeNodeStartupOptions(startup);
  const hasPercentage = [...options.execArgv, ...options.nodeOptions]
    .some((flag) => flag.startsWith('--max-old-space-size-percentage='));
  const semiSpaceFlags = [...options.nodeOptions, ...options.execArgv]
    .filter((flag) => flag.startsWith('--max-semi-space-size='));
  const semiSpaceMb = semiSpaceFlags.length ? Number(semiSpaceFlags.at(-1).split('=')[1]) : null;
  const youngCeiling = youngGenerationCeilingBytes(Number(resourceLimits?.maxYoungGenerationSizeMb));
  const youngOverridden = semiSpaceMb != null && (youngCeiling == null || semiSpaceMb * 3 * MIB > youngCeiling);
  const supported = requestedOldGenerationSizeMb != null && !hasPercentage
    && !youngOverridden
    && parent.source !== 'invalid'
    && (parent.value == null || parent.value <= requestedOldGenerationSizeMb);
  return {
    supported,
    requestedOldGenerationSizeMb,
    parentStartupOldSpaceMb: parent.value,
    parentStartupSource: parent.source,
    enforcement: !supported ? 'not-enforceable' : parent.value != null ? 'parent-startup-cap' : 'worker-resource-limits',
    reason: supported ? null : hasPercentage ? 'parent-heap-percentage-override'
      : youngOverridden ? 'parent-young-heap-overrides-worker-limit' : 'parent-heap-overrides-worker-limit',
    fallback: supported ? null : 'inline',
    startupOptions: options
  };
};

export const observeWorkerHeap = () => {
  const observation = observeRuntimeProcess();
  const limits = observation.resourceLimits || {};
  const oldBytes = Number(limits.maxOldGenerationSizeMb) * MIB;
  const youngBytes = youngGenerationCeilingBytes(Number(limits.maxYoungGenerationSizeMb));
  const ceiling = oldBytes > 0 && youngBytes != null ? oldBytes + youngBytes : null;
  return {
    ...observation,
    heapSizeLimitCeilingBytes: ceiling,
    resourceLimitAcknowledged: Number.isFinite(ceiling) && ceiling > 0
      && observation.heapSizeLimitBytes <= ceiling,
    limitCheckMethod: 'v8-total-heap-versus-rounded-generation-limits'
  };
};
