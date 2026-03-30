import { resolveQueueName } from '../queue.js';

const normalizeQueueName = (value) => (
  typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : 'index'
);

export const isEmbeddingsQueueName = (queueName) => {
  const normalized = normalizeQueueName(queueName);
  return normalized === 'embeddings' || normalized.startsWith('embeddings-');
};

export const isMonitoredIndexQueueName = (queueName) => {
  const normalized = normalizeQueueName(queueName);
  return !isEmbeddingsQueueName(normalized)
    && (normalized === 'index' || normalized.startsWith('index-'));
};

export const resolveServiceQueueName = ({
  queueName = 'index',
  reason = null,
  stage = null,
  mode = null
} = {}) => (
  resolveQueueName(queueName, { reason, stage, mode })
  || normalizeQueueName(queueName)
);
