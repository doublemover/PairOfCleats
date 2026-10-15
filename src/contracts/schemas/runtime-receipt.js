const text = { type: 'string', maxLength: 2048 };
const nullableText = { anyOf: [text, { type: 'null' }] };
const boundedObject = { type: 'object', maxProperties: 64, additionalProperties: true };
export const RUNTIME_ATTEMPT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['runtimeReceiptVersion', 'attemptId', 'buildId', 'parentAttemptId', 'stage', 'mode', 'startedAt', 'updatedAt', 'finishedAt', 'lifecycle', 'producer', 'inputs', 'paths', 'runtime', 'embeddings', 'persistence'],
  properties: {
    runtimeReceiptVersion: { const: 1 }, attemptId: { type: 'string', minLength: 1, maxLength: 128 },
    buildId: text, parentAttemptId: nullableText, correlationId: nullableText,
    stage: nullableText, mode: nullableText, executionClass: nullableText,
    startedAt: text, updatedAt: text, finishedAt: nullableText,
    lifecycle: { enum: ['resolved', 'initializing', 'running', 'succeeded', 'failed', 'aborted', 'unknown'] },
    producer: boundedObject, inputs: boundedObject, paths: boundedObject,
    runtime: boundedObject, embeddings: boundedObject,
    persistence: {
      type: 'object', additionalProperties: false, required: ['status', 'lastErrorCode'],
      properties: { status: { enum: ['pending', 'durable', 'degraded'] }, lastErrorCode: nullableText }
    },
    error: boundedObject
  }
};
export const BUILD_RUNTIME_RECEIPT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'latestAttemptId', 'attempts'],
  properties: {
    schemaVersion: { const: 1 }, latestAttemptId: nullableText,
    prunedAttemptCount: { type: 'integer', minimum: 0 },
    attempts: { type: 'array', maxItems: 16, items: RUNTIME_ATTEMPT_SCHEMA }
  }
};
