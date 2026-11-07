import { readEffectiveCpu } from '../../../shared/effective-cpu.js';
import { readEffectiveMemory } from '../../../shared/effective-memory.js';
import { sha1 } from '../../../shared/hash.js';
import { stableStringify } from '../../../shared/stable-json.js';

const positive = value => Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : null;

export const projectSqliteThreadLimits = envelope => ({
  cpuCount: envelope.concurrency.cpuCount,
  totalMemBytes: envelope.concurrency.totalMemBytes,
  totalMemGiB: envelope.concurrency.totalMemGiB,
  maxConcurrencyCap: envelope.concurrency.maxConcurrencyCap,
  threads: envelope.concurrency.threads.value,
  fileConcurrency: envelope.concurrency.fileConcurrency.value,
  importConcurrency: envelope.concurrency.importConcurrency.value,
  ioConcurrency: envelope.concurrency.ioConcurrency.value,
  cpuConcurrency: envelope.concurrency.cpuConcurrency.value,
  procConcurrency: envelope.queues?.proc?.concurrency ?? null,
  source: envelope.concurrency.threads.source,
  sourceDetail: envelope.concurrency.threads.detail
});

/** The resolved producer owns CPU capacity. File windows are not CPU grants.
 * Missing legacy observations fall back conservatively to effective resources;
 * a complete envelope may already admit deliberate explicit CPU overcommit. */
export const resolveBundleProducerBudget = (threadLimits = {}) => {
  const cpuBounds = [threadLimits.cpuConcurrency, threadLimits.threads, threadLimits.maxConcurrencyCap]
    .map(positive).filter(value => value != null);
  const cpu = cpuBounds.length ? Math.min(...cpuBounds)
    : Math.min(readEffectiveCpu().cpuCount, positive(threadLimits.fileConcurrency) || 1);
  const fd = positive(threadLimits.fdConcurrency);
  const configuredMemoryBytes = positive(threadLimits.totalMemBytes);
  const effectiveMemory = readEffectiveMemory({ configuredLimitBytes: configuredMemoryBytes });
  const limit = Math.min(16, cpu, fd || cpu);
  const policy = { version: 2, cpu, fd, configuredMemoryBytes, totalMemoryBytes: effectiveMemory.totalBytes };
  return { ...policy, limit, resourceIdentity: sha1(stableStringify(policy)),
    limitingReason: limit === 16 && cpu > 16 ? 'bundle-worker-ceiling'
      : fd != null && fd < cpu ? 'fd-budget' : 'cpu-envelope' };
};
