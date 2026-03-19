import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const TRACE_SCHEMA_VERSION = 1;

const normalizeDirection = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'inbound' || normalized === 'outbound' || normalized === 'lifecycle') {
    return normalized;
  }
  return 'lifecycle';
};

const classifyMessageKind = (message) => {
  if (!message || typeof message !== 'object') return 'unknown';
  if (Object.prototype.hasOwnProperty.call(message, 'id')) {
    return message.method ? 'request' : 'response';
  }
  if (message.method) return 'notification';
  return 'unknown';
};

const stableMethodString = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const toTraceEntry = ({
  direction,
  message,
  event,
  providerId = null,
  sessionKey = null,
  method = null
}) => {
  const normalizedDirection = normalizeDirection(direction);
  if (normalizedDirection === 'lifecycle') {
    return {
      schemaVersion: TRACE_SCHEMA_VERSION,
      at: new Date().toISOString(),
      direction: normalizedDirection,
      event: String(event?.kind || event?.event || 'unknown'),
      providerId: stableMethodString(providerId),
      sessionKey: stableMethodString(sessionKey),
      details: event && typeof event === 'object' ? { ...event } : null
    };
  }
  const resolvedMethod = stableMethodString(
    method
      || message?.method
      || message?.meta?.method
  );
  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    at: new Date().toISOString(),
    direction: normalizedDirection,
    kind: classifyMessageKind(message),
    method: resolvedMethod,
    id: Object.prototype.hasOwnProperty.call(message || {}, 'id') ? message.id : null,
    providerId: stableMethodString(providerId),
    sessionKey: stableMethodString(sessionKey),
    hasError: Boolean(message?.error),
    errorCode: message?.error?.code ?? null
  };
};

export const createJsonRpcTraceRecorder = ({
  tracePath = '',
  providerId = null,
  sessionKey = null,
  log = () => {}
} = {}) => {
  const resolvedTracePath = String(tracePath || '').trim();
  if (!resolvedTracePath) {
    return {
      enabled: false,
      tracePath: '',
      recordInbound() {},
      recordOutbound() {},
      recordLifecycle() {}
    };
  }
  try {
    fs.mkdirSync(path.dirname(resolvedTracePath), { recursive: true });
  } catch {}

  const append = (entry) => {
    try {
      fs.appendFileSync(resolvedTracePath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (error) {
      try {
        log(`[lsp] trace append failed: ${error?.message || error}`);
      } catch {}
    }
  };

  return {
    enabled: true,
    tracePath: resolvedTracePath,
    recordInbound(message, options = {}) {
      append(toTraceEntry({
        direction: 'inbound',
        message,
        method: options?.method || null,
        providerId: options?.providerId || providerId,
        sessionKey: options?.sessionKey || sessionKey
      }));
    },
    recordOutbound(message, options = {}) {
      append(toTraceEntry({
        direction: 'outbound',
        message,
        method: options?.method || null,
        providerId: options?.providerId || providerId,
        sessionKey: options?.sessionKey || sessionKey
      }));
    },
    recordLifecycle(event, options = {}) {
      append(toTraceEntry({
        direction: 'lifecycle',
        event,
        providerId: options?.providerId || providerId,
        sessionKey: options?.sessionKey || sessionKey
      }));
    }
  };
};

export const readJsonRpcTrace = async (tracePath) => {
  const resolvedPath = String(tracePath || '').trim();
  if (!resolvedPath) return [];
  const raw = await fsPromises.readFile(resolvedPath, 'utf8');
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

export const replayJsonRpcTrace = (entries) => {
  const events = Array.isArray(entries) ? entries : [];
  const pendingById = new Map();
  const summary = {
    schemaVersion: TRACE_SCHEMA_VERSION,
    eventCount: events.length,
    lifecycleEvents: [],
    outboundRequests: [],
    outboundNotifications: [],
    inboundRequests: [],
    inboundNotifications: [],
    inboundResponses: [],
    methodCounts: Object.create(null),
    unmatchedResponses: 0,
    duplicateRequestIds: 0,
    pendingRequestCount: 0,
    hasProtocolErrors: false
  };

  const bumpMethod = (method) => {
    const normalizedMethod = stableMethodString(method);
    if (!normalizedMethod) return;
    summary.methodCounts[normalizedMethod] = Number(summary.methodCounts[normalizedMethod] || 0) + 1;
  };

  for (const entry of events) {
    const direction = normalizeDirection(entry?.direction);
    if (direction === 'lifecycle') {
      summary.lifecycleEvents.push(String(entry?.event || 'unknown'));
      if (String(entry?.event || '').trim().toLowerCase().includes('protocol_parse_error')) {
        summary.hasProtocolErrors = true;
      }
      continue;
    }
    const kind = String(entry?.kind || 'unknown').trim().toLowerCase();
    const method = stableMethodString(entry?.method);
    bumpMethod(method);
    if (direction === 'outbound') {
      if (kind === 'request') {
        const idKey = entry?.id;
        if (pendingById.has(idKey)) {
          summary.duplicateRequestIds += 1;
          summary.hasProtocolErrors = true;
        }
        pendingById.set(idKey, method || 'unknown');
        summary.outboundRequests.push(method || 'unknown');
      } else if (kind === 'notification') {
        summary.outboundNotifications.push(method || 'unknown');
      }
      continue;
    }
    if (kind === 'response') {
      const idKey = entry?.id;
      const pendingMethod = pendingById.get(idKey) || method || 'unknown';
      if (!pendingById.delete(idKey)) {
        summary.unmatchedResponses += 1;
        summary.hasProtocolErrors = true;
      }
      summary.inboundResponses.push({
        method: pendingMethod,
        hasError: entry?.hasError === true,
        errorCode: entry?.errorCode ?? null
      });
      continue;
    }
    if (kind === 'request') {
      summary.inboundRequests.push(method || 'unknown');
      continue;
    }
    if (kind === 'notification') {
      summary.inboundNotifications.push(method || 'unknown');
    }
  }

  summary.pendingRequestCount = pendingById.size;
  if (summary.pendingRequestCount > 0) {
    summary.hasProtocolErrors = true;
  }
  return summary;
};

export const diffJsonRpcTraceSummaries = (current, baseline) => {
  const currentSummary = current && typeof current === 'object' ? current : {};
  const baselineSummary = baseline && typeof baseline === 'object' ? baseline : {};
  const diff = {
    eventCountDelta: Number(currentSummary.eventCount || 0) - Number(baselineSummary.eventCount || 0),
    unmatchedResponsesDelta: Number(currentSummary.unmatchedResponses || 0) - Number(baselineSummary.unmatchedResponses || 0),
    pendingRequestCountDelta: Number(currentSummary.pendingRequestCount || 0) - Number(baselineSummary.pendingRequestCount || 0),
    methodCountDelta: Object.create(null)
  };
  const methodKeys = new Set([
    ...Object.keys(currentSummary.methodCounts || {}),
    ...Object.keys(baselineSummary.methodCounts || {})
  ]);
  for (const key of [...methodKeys].sort((a, b) => a.localeCompare(b))) {
    diff.methodCountDelta[key] = Number(currentSummary.methodCounts?.[key] || 0) - Number(baselineSummary.methodCounts?.[key] || 0);
  }
  return diff;
};
