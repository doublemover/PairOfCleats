const { StringDecoder } = require('node:string_decoder');
const path = require('node:path');
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

function apiReadinessFrame(line, expectedRepoRoot = null) {
  let frame;
  try { frame = JSON.parse(line); } catch { return null; }
  if (frame?.ok !== true || !Number.isInteger(frame.port) || frame.port < 1 || frame.port > 65535) return null;
  if (expectedRepoRoot && (typeof frame.repo !== 'string' || !path.isAbsolute(frame.repo)
    || path.resolve(frame.repo) !== path.resolve(expectedRepoRoot))) return null;
  try {
    const url = new URL(frame.baseUrl);
    const host = typeof frame.host === 'string' ? frame.host.trim().toLowerCase() : '';
    if (!host || url.hostname.toLowerCase().replace(/^\[|\]$/g, '') !== host.replace(/^\[|\]$/g, '')) return null;
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || url.pathname !== '/' || Number(url.port || (url.protocol === 'https:' ? 443 : 80)) !== frame.port) return null;
    return url.toString().replace(/\/$/, '');
  } catch { return null; }
}

function describeTask(entry, now = Date.now()) {
  const progress = entry.progress || {};
  const observedUntil = entry.completedAt || progress.completedAt || now;
  return [`${entry.spec.title} • ${entry.repoRoot || ''} • ${entry.sessionId}`,
    `State: ${entry.cleanupUnconfirmed ? 'failed; owned stop unconfirmed' : entry.stopping && !entry.status ? 'stopping' : progress.phase || 'starting'}`,
    `Stage: ${progress.stage || 'indeterminate'}`,
    `Elapsed: ${Math.max(0, observedUntil - (progress.startedAt || observedUntil))} ms; idle: ${Math.max(0, observedUntil - (progress.lastActivityAt || observedUntil))} ms`,
    `Counters: ${progress.current ?? 'unknown'} / ${progress.total ?? 'unknown'}`,
    progress.message || 'No structured progress observed.',
    ...(progress.endpoint ? [`Endpoint (readiness observed): ${progress.endpoint}`] : []),
    ...(entry.observedOnly ? ['Read-only completed task observation; no process/PID authority is retained.'] : []),
    'No percentage or ETA is inferred from unstructured logs.'].join('\n');
}

function boundedLogLine(value, maxBytes = 8192) {
  const bytes = Buffer.from(String(value || ''));
  let end = Math.min(bytes.length, Math.max(0, maxBytes));
  while (end < bytes.length && end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
}

function retainTaskLog(entry, prefix, line) {
  const text = `${prefix}${boundedLogLine(line)}`;
  const row = { text, bytes: Buffer.byteLength(text) };
  entry.logTail ||= [];
  entry.logTailBytes = (entry.logTailBytes || 0) + row.bytes;
  entry.logTail.push(row);
  while (entry.logTail.length > 128 || entry.logTailBytes > 65536) {
    entry.logTailBytes -= entry.logTail.shift().bytes;
    entry.logTailTruncated = true;
  }
  return text;
}

module.exports = { createEditorProgressDecoder, applyProgressEvent, apiReadinessFrame, describeTask,
  boundedLogLine, retainTaskLog };
