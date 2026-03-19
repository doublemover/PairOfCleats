import { resolveQueueAdmissionPolicy } from './admission-policy.js';
import { resolveQueueLeasePolicy } from './lease-policy.js';

const toNonNegativeIntOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.max(0, Math.floor(parsed));
};

export function resolveQueueOperationalEnvelope({
  queueName = null,
  queueConfig = {},
  workerConfig = {}
} = {}) {
  const admission = resolveQueueAdmissionPolicy({
    queueName,
    queueConfig,
    workerConfig
  });
  const retryMaxRetries = toNonNegativeIntOrNull(queueConfig?.maxRetries);
  const workerConcurrency = toNonNegativeIntOrNull(workerConfig?.concurrency) ?? 1;
  const workerMemoryMb = toNonNegativeIntOrNull(workerConfig?.maxMemoryMb);
  return {
    queueName: admission.queueName,
    queueClass: admission.queueClass,
    retry: {
      maxRetries: retryMaxRetries
    },
    worker: {
      concurrency: workerConcurrency,
      maxMemoryMb: admission.queueClass === 'embeddings' ? workerMemoryMb : null
    },
    admission,
    lease: resolveQueueLeasePolicy({
      queueName: admission.queueName
    })
  };
}
