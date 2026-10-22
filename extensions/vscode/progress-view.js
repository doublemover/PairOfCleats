const { StringDecoder } = require('node:string_decoder');
const EVENTS = new Set(['hello', 'job:start', 'job:spawn', 'job:end', 'job:artifacts',
  'runtime:metrics', 'event:chunk', 'task:start', 'task:progress', 'task:end', 'log']);

/** Consumer of the canonical poc.progress@2 wire protocol. Plain logs are
 * retained as text and never promoted to progress/readiness evidence. */
function createEditorProgressDecoder({ onEvent, onText, maxLineBytes = 65536 }) {
  const decoder = new StringDecoder('utf8');
  let carry = '', overflow = false;
  function line(value) {
    if (!overflow && Buffer.byteLength(value) <= maxLineBytes) {
      let event;
      try { event = JSON.parse(value); } catch {}
      if (event?.proto === 'poc.progress@2' && EVENTS.has(event.event)
        && typeof event.ts === 'string' && Number.isFinite(Date.parse(event.ts))) {
        onEvent?.(event);
        return;
      }
    }
    onText?.(value.slice(0, maxLineBytes), overflow);
  }
  function accept(value) {
    const parts = (carry + value).split(/\r?\n/);
    carry = parts.pop();
    for (const part of parts) { line(part); overflow = false; }
    if (Buffer.byteLength(carry) > maxLineBytes) {
      carry = Buffer.from(carry).subarray(0, maxLineBytes).toString('utf8');
      overflow = true;
    }
  }
  return {
    push(chunk) { accept(decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))); },
    flush() { accept(decoder.end()); if (carry) line(carry); carry = ''; overflow = false; }
  };
}

function applyProgressEvent(state, event, now = Date.now()) {
  if (!event || !EVENTS.has(event.event) || event.proto !== 'poc.progress@2') return state;
  const next = { ...state, lastActivityAt: now };
  next.stage = String(event.stage || event.name || state.stage || 'indeterminate').slice(0, 256);
  next.message = String(event.message || event.text || state.message || '').slice(0, 1024);
  next.current = Number.isFinite(event.current) && event.current >= 0 ? event.current : null;
  next.total = Number.isFinite(event.total) && event.total >= 0 ? event.total : null;
  if (event.event === 'task:start' || event.event === 'task:progress') next.phase = 'indexing';
  if (event.event === 'job:end') next.phase = event.status === 'failed' ? 'failed' : 'settling';
  return next;
}

function apiReadinessFrame(line) {
  let frame;
  try { frame = JSON.parse(line); } catch { return null; }
  if (frame?.ok !== true || !Number.isInteger(frame.port) || frame.port < 1 || frame.port > 65535) return null;
  try {
    const url = new URL(frame.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || url.pathname !== '/' || Number(url.port || (url.protocol === 'https:' ? 443 : 80)) !== frame.port) return null;
    return url.toString().replace(/\/$/, '');
  } catch { return null; }
}

function describeTask(entry, now = Date.now()) {
  const progress = entry.progress || {};
  return [`${entry.spec.title} • ${entry.repoRoot || ''} • ${entry.sessionId}`,
    `State: ${entry.stopping ? 'stopping' : progress.phase || 'starting'}`,
    `Stage: ${progress.stage || 'indeterminate'}`,
    `Elapsed: ${Math.max(0, now - (progress.startedAt || now))} ms; idle: ${Math.max(0, now - (progress.lastActivityAt || now))} ms`,
    `Counters: ${progress.current ?? 'unknown'} / ${progress.total ?? 'unknown'}`,
    progress.message || 'No structured progress observed.',
    ...(progress.endpoint ? [`Endpoint (readiness observed): ${progress.endpoint}`] : []),
    'No percentage or ETA is inferred from unstructured logs.'].join('\n');
}

module.exports = { createEditorProgressDecoder, applyProgressEvent, apiReadinessFrame, describeTask };
