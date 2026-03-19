import crypto from 'node:crypto';

export const OBSERVABILITY_ENVELOPE_VERSION = 1;
export const OBSERVABILITY_CONTEXT_ENV = 'PAIROFCLEATS_OBSERVABILITY_CONTEXT';

const toTrimmedString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const cloneObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value))
    : {}
);

const normalizeCorrelation = (input = {}) => {
  const correlationId = toTrimmedString(
    input.correlationId
    || input.id
    || input.runId
  );
  const parentCorrelationId = toTrimmedString(
    input.parentCorrelationId
    || input.parentId
    || input.parentRunId
  );
  const requestId = toTrimmedString(input.requestId || input.request || input.toolCallId);
  const result = {
    correlationId: correlationId || createCorrelationId('pc')
  };
  if (parentCorrelationId) result.parentCorrelationId = parentCorrelationId;
  if (requestId) result.requestId = requestId;
  return result;
};

export const createCorrelationId = (prefix = 'pc') => {
  const normalizedPrefix = toTrimmedString(prefix) || 'pc';
  return `${normalizedPrefix}-${crypto.randomUUID()}`;
};

export const createObservabilityEnvelope = ({
  surface,
  operation,
  phase = null,
  correlation = {},
  context = {},
  at = null
} = {}) => ({
  version: OBSERVABILITY_ENVELOPE_VERSION,
  at: toTrimmedString(at) || new Date().toISOString(),
  surface: toTrimmedString(surface) || 'unknown',
  operation: toTrimmedString(operation) || 'unknown',
  phase: toTrimmedString(phase),
  correlation: normalizeCorrelation(correlation),
  context: cloneObject(context)
});

export const normalizeObservability = (
  input = null,
  {
    surface,
    operation,
    phase = null,
    context = {}
  } = {}
) => {
  const base = input && typeof input === 'object' && !Array.isArray(input)
    ? input
    : {};
  const baseContext = cloneObject(base.context);
  const nextContext = {
    ...baseContext,
    ...cloneObject(context)
  };
  return createObservabilityEnvelope({
    surface: base.surface || surface,
    operation: base.operation || operation,
    phase: base.phase || phase,
    correlation: {
      ...(base.correlation && typeof base.correlation === 'object' ? base.correlation : {}),
      correlationId: base.correlationId || base?.correlation?.correlationId || null,
      parentCorrelationId: base.parentCorrelationId || base?.correlation?.parentCorrelationId || null,
      requestId: base.requestId || base?.correlation?.requestId || null
    },
    context: nextContext,
    at: base.at || null
  });
};

export const attachObservability = (payload, observability) => {
  if (!observability || typeof observability !== 'object') return payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      value: payload,
      observability
    };
  }
  return {
    ...payload,
    observability
  };
};

export const parseObservabilityContextEnv = (env = process.env) => {
  const rawValue = env?.[OBSERVABILITY_CONTEXT_ENV];
  if (typeof rawValue !== 'string' || !rawValue.trim()) return null;
  try {
    const parsed = JSON.parse(rawValue);
    return normalizeObservability(parsed);
  } catch {
    return null;
  }
};

export const applyObservabilityContextEnv = (env = process.env, observability = null) => {
  const nextEnv = { ...(env || {}) };
  if (!observability || typeof observability !== 'object') {
    delete nextEnv[OBSERVABILITY_CONTEXT_ENV];
    return nextEnv;
  }
  nextEnv[OBSERVABILITY_CONTEXT_ENV] = JSON.stringify(observability);
  return nextEnv;
};

export const buildObservabilityHeaders = (observability = null) => {
  if (!observability || typeof observability !== 'object') return {};
  const correlationId = toTrimmedString(observability?.correlation?.correlationId);
  const parentCorrelationId = toTrimmedString(observability?.correlation?.parentCorrelationId);
  const requestId = toTrimmedString(observability?.correlation?.requestId);
  return {
    ...(correlationId ? { 'X-Correlation-Id': correlationId } : {}),
    ...(parentCorrelationId ? { 'X-Parent-Correlation-Id': parentCorrelationId } : {}),
    ...(requestId ? { 'X-Request-Id': requestId } : {})
  };
};

export const buildChildObservability = (
  parent = null,
  {
    surface,
    operation,
    phase = null,
    context = {}
  } = {}
) => {
  const normalizedParent = normalizeObservability(parent, {
    surface: parent?.surface || 'unknown',
    operation: parent?.operation || 'unknown'
  });
  return createObservabilityEnvelope({
    surface,
    operation,
    phase,
    correlation: {
      correlationId: normalizedParent?.correlation?.correlationId || null,
      parentCorrelationId: normalizedParent?.correlation?.parentCorrelationId || null,
      requestId: normalizedParent?.correlation?.requestId || null
    },
    context: {
      ...(normalizedParent?.context || {}),
      ...cloneObject(context)
    }
  });
};
