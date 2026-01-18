export const PROGRESS_EVENTS = new Set(['task:start', 'task:progress', 'task:end', 'log']);

export const formatProgressEvent = (event, payload = {}) => {
  const base = {
    event,
    ts: new Date().toISOString()
  };
  if (!payload || typeof payload !== 'object') return base;
  return { ...base, ...payload };
};

export const writeProgressEvent = (stream, event, payload = {}) => {
  if (!stream || typeof stream.write !== 'function') return null;
  const entry = formatProgressEvent(event, payload);
  const line = `${JSON.stringify(entry)}\n`;
  stream.write(line);
  return entry;
};

export const parseProgressEventLine = (line) => {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.event || typeof parsed.event !== 'string') return null;
  return parsed;
};
