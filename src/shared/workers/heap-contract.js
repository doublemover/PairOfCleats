import { getNodeStartupInputs, observeRuntimeProcess } from '../runtime-envelope/observe.js';
import { resolveNodeHeapSource, sanitizeNodeStartupOptions } from './node-argv.js';

/** V8 startup heap flags are process-global, including Worker isolates. */
export const resolveWorkerHeapLaunchContract = (resourceLimits, startup = getNodeStartupInputs()) => {
  const requestedOldGenerationSizeMb = Number(resourceLimits?.maxOldGenerationSizeMb) || null;
  const parent = resolveNodeHeapSource(startup);
  const options = sanitizeNodeStartupOptions(startup);
  const hasPercentage = [...options.execArgv, ...options.nodeOptions]
    .some((flag) => flag.startsWith('--max-old-space-size-percentage='));
  const supported = requestedOldGenerationSizeMb != null && !hasPercentage
    && parent.source !== 'invalid'
    && (parent.value == null || parent.value <= requestedOldGenerationSizeMb);
  return {
    supported,
    requestedOldGenerationSizeMb,
    parentStartupOldSpaceMb: parent.value,
    parentStartupSource: parent.source,
    enforcement: !supported ? 'not-enforceable' : parent.value != null ? 'parent-startup-cap' : 'worker-resource-limits',
    reason: supported ? null : hasPercentage ? 'parent-heap-percentage-override' : 'parent-heap-overrides-worker-limit',
    fallback: supported ? null : 'inline',
    startupOptions: options
  };
};

export const observeWorkerHeap = () => {
  const observation = observeRuntimeProcess();
  const limits = observation.resourceLimits || {};
  const requestedTotalBytes = (Number(limits.maxOldGenerationSizeMb) + Number(limits.maxYoungGenerationSizeMb)) * 1024 * 1024;
  return {
    ...observation,
    // This compares total heap measurements against V8's reported generation
    // limits. It never relabels total heap bytes as an observed old-space size.
    resourceLimitAcknowledged: Number.isFinite(requestedTotalBytes) && requestedTotalBytes > 0
      && observation.heapSizeLimitBytes <= requestedTotalBytes,
    limitCheckMethod: 'v8-total-heap-versus-reported-generation-limits'
  };
};
