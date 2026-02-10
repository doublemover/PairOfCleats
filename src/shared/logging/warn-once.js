const stableSerialize = (value, seen = new WeakSet()) => {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'string') return JSON.stringify(value);
  if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value);
  if (type !== 'object') return JSON.stringify(String(value));
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry, seen)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key], seen)}`).join(',')}}`;
};

export const normalizeWarnOnceKey = (value) => {
  if (value == null) return 'null';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || '""';
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return stableSerialize(value);
  } catch {
    return String(value);
  }
};

export const createWarnOnce = ({
  logger = null,
  formatKey = normalizeWarnOnceKey
} = {}) => {
  const seen = new Set();
  const emit = typeof logger === 'function'
    ? logger
    : ((message) => console.warn(message));

  const warn = (keyOrMessage, message = undefined) => {
    const hasExplicitKey = message !== undefined;
    const resolvedMessage = hasExplicitKey ? message : keyOrMessage;
    if (!resolvedMessage) return false;
    const key = formatKey(hasExplicitKey ? keyOrMessage : resolvedMessage);
    if (seen.has(key)) return false;
    seen.add(key);
    try {
      emit(String(resolvedMessage));
    } catch {}
    return true;
  };

  warn.reset = () => {
    seen.clear();
  };

  return warn;
};

export const warnOnce = createWarnOnce();
