import fs from 'node:fs';
import path from 'node:path';
import { spawnSubprocess } from '../../../src/shared/subprocess.js';
import { killProcessTree as killPidTree } from '../../../src/shared/kill-tree.js';
import { createProgressLineDecoder } from '../../../src/shared/cli/progress-stream.js';
import { parseProgressEventLine } from '../../../src/shared/cli/progress-events.js';
import {
  BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION,
  buildBenchDiagnosticEventId,
  buildBenchDiagnosticSignature,
  normalizeBenchDiagnosticText
} from './logging.js';

const SCHEDULER_EVENT_WINDOW = 40;
const SCHEDULER_EVENT_MARKER = '[tree-sitter:schedule]';
const DIAGNOSTIC_STREAM_SUFFIX = '.diagnostics.jsonl';
const DIAGNOSTIC_REPEAT_COUNT = 5;
const DIAGNOSTIC_REPEAT_INTERVAL_MS = 30 * 1000;
const QUEUE_DELAY_HOTSPOT_MS = 250;
const QUEUE_DEPTH_HOTSPOT = 3;

const PARSER_CRASH_PATTERNS = Object.freeze([
  /\bparser\b[\s\S]{0,80}\b(?:crash|crashed|fatal|abort|aborted)\b/i,
  /\btree-sitter\b[\s\S]{0,80}\b(?:crash|crashed|fatal|abort|aborted)\b/i,
  /\b(?:segmentation fault|sigsegv)\b[\s\S]{0,80}\b(?:parser|tree-sitter)\b/i
]);
const SCM_TIMEOUT_PATTERNS = Object.freeze([
  /\b(?:scm|git)\b[\s\S]{0,80}\b(?:timeout|timed out|deadline exceeded)\b/i,
  /\b(?:timeout|timed out|deadline exceeded)\b[\s\S]{0,80}\b(?:scm|git)\b/i
]);
const ARTIFACT_TAIL_STALL_PATTERNS = Object.freeze([
  /\bartifact(?:s)?\b[\s\S]{0,80}\b(?:tail|flush|write)\b[\s\S]{0,80}\b(?:stall|stalled|timeout|timed out|hung|blocked)\b/i,
  /\bartifact(?:s)?\b[\s\S]{0,80}\b(?:stall|stalled)\b[\s\S]{0,80}\b(?:tail|flush|write)\b/i
]);
const FALLBACK_NEGATIVE_PATTERN = /\b(?:no|without)\s+fallback\b|\bfallback\s+(?:disabled|off)\b/i;

const toText = (value) => String(value == null ? '' : value).trim();

const truncateForDisplay = (value, maxChars = 140) => {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const limit = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0
    ? Math.floor(Number(maxChars))
    : 140;
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
};

const normalizeSignatureMessage = (message) => (
  normalizeBenchDiagnosticText(String(message || '').replace(/\b\d+(\.\d+)?\b/g, '#'), { maxLength: 220 })
);

const resolveDiagnosticsStreamPath = (logEntry) => {
  const target = toText(logEntry);
  if (!target) return null;
  if (target.endsWith('.log')) return `${target.slice(0, -4)}${DIAGNOSTIC_STREAM_SUFFIX}`;
  return `${target}${DIAGNOSTIC_STREAM_SUFFIX}`;
};

const appendJsonLineSync = (filePath, payload) => {
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {}
};

const matchesAnyPattern = (text, patterns) => patterns.some((pattern) => pattern.test(text));

const isQueueDelayHotspot = (message) => {
  const text = String(message || '');
  const normalized = text.toLowerCase();
  const hasQueueSignal = normalized.includes('queue') || normalized.includes(SCHEDULER_EVENT_MARKER);
  if (!hasQueueSignal) return false;
  if (normalized.includes('hotspot') || normalized.includes('backlog') || normalized.includes('stalled')) return true;
  const delayMatch = normalized.match(/\bqueue(?:\s|-)?delay\b[^0-9]{0,32}(\d+(?:\.\d+)?)\s*ms\b/i);
  if (delayMatch) {
    const delayMs = Number(delayMatch[1]);
    if (Number.isFinite(delayMs) && delayMs >= QUEUE_DELAY_HOTSPOT_MS) return true;
  }
  const depthMatch = normalized.match(/\bqueue(?:\s|-)?depth\b[^0-9]{0,8}(\d+)\b/i);
  if (depthMatch) {
    const depth = Number(depthMatch[1]);
    if (Number.isFinite(depth) && depth >= QUEUE_DEPTH_HOTSPOT) return true;
  }
  return normalized.includes('queue delay');
};

const resolveDiagnosticType = (message, event = null) => {
  const text = String(message || '');
  if (!text) return null;
  if (matchesAnyPattern(text, PARSER_CRASH_PATTERNS)) return 'parser_crash';
  if (matchesAnyPattern(text, SCM_TIMEOUT_PATTERNS)) return 'scm_timeout';
  if (matchesAnyPattern(text, ARTIFACT_TAIL_STALL_PATTERNS)) return 'artifact_tail_stall';
  if (isQueueDelayHotspot(text)) return 'queue_delay_hotspot';
  const hasFallbackMeta = event && typeof event === 'object' && (
    event?.meta?.fallback === true
    || normalizeBenchDiagnosticText(event?.meta?.decision || '').includes('fallback')
  );
  if ((/\bfallback\b/i.test(text) || hasFallbackMeta) && !FALLBACK_NEGATIVE_PATTERN.test(text)) {
    return 'fallback_used';
  }
  return null;
};

export const createProcessRunner = ({
  appendLog,
  writeLog,
  writeLogSync,
  logHistory,
  logPath,
  getLogPaths,
  onProgressEvent
}) => {
  let activeChild = null;
  let activeLabel = '';
  let exitLogged = false;
  const interactiveDiagnostics = new Map();

  const setActiveChild = (child, label) => {
    activeChild = child;
    activeLabel = label;
  };

  const clearActiveChild = (childOrPid = null) => {
    if (!activeChild) return;
    const targetPid = Number(
      typeof childOrPid === 'number'
        ? childOrPid
        : childOrPid?.pid
    );
    if (!Number.isFinite(targetPid) || Number(activeChild.pid) === targetPid || activeChild === childOrPid) {
      activeChild = null;
      activeLabel = '';
    }
  };

  const killProcessTree = (pid) => {
    if (!Number.isFinite(pid)) return;
    void killPidTree(pid, {
      killTree: true,
      detached: process.platform !== 'win32',
      graceMs: 0
    }).catch(() => {});
  };

  const logExit = (reason, code) => {
    if (exitLogged) return;
    writeLogSync(`[exit] ${reason}${Number.isFinite(code) ? ` code=${code}` : ''}`);
    exitLogged = true;
  };

  const resolveLogPaths = () => {
    try {
      if (typeof getLogPaths === 'function') {
        const resolved = getLogPaths();
        if (Array.isArray(resolved)) return resolved.filter(Boolean);
        if (typeof resolved === 'string' && resolved) return [resolved];
      }
      if (typeof logPath === 'function') {
        const resolved = logPath();
        if (typeof resolved === 'string' && resolved) return [resolved];
      }
      if (typeof logPath === 'string' && logPath) return [logPath];
    } catch {}
    return [];
  };

  const emitLogPaths = (prefix = '[error]') => {
    const paths = resolveLogPaths();
    if (!paths.length) return;
    const names = paths.map((entry) => path.basename(String(entry || ''))).filter(Boolean);
    if (paths.length === 1) {
      const only = paths[0];
      const onlyName = names[0] || 'log';
      appendLog(`[logs] ${onlyName}`, 'info', { fileOnlyLine: `Log: ${only}` });
      writeLog(`${prefix} Log: ${only}`);
      return;
    }
    const joined = paths.join(' ');
    const nameSummary = names.length ? ` (${names.join(', ')})` : '';
    appendLog(`[logs] ${paths.length} files${nameSummary}`, 'info', {
      fileOnlyLine: `Logs: ${joined}`
    });
    writeLog(`${prefix} Logs: ${joined}`);
  };

  const runProcess = async (label, cmd, args, options = {}) => {
    const { continueOnError = false, ...spawnOptionsRest } = options;
    const spawnOptions = {
      ...spawnOptionsRest,
      stdio: ['ignore', 'pipe', 'pipe'],
      rejectOnNonZeroExit: false
    };
    const diagnosticStreams = Array.from(
      new Set(resolveLogPaths().map(resolveDiagnosticsStreamPath).filter(Boolean))
    );
    const schedulerEvents = [];
    let diagnosticEventCount = 0;
    const diagnosticCountByType = new Map();
    const diagnosticCountById = new Map();

    const buildDiagnosticsSummary = () => ({
      schemaVersion: BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION,
      streamPaths: diagnosticStreams,
      eventCount: diagnosticEventCount,
      uniqueEventCount: diagnosticCountById.size,
      countsByType: Object.fromEntries(
        Array.from(diagnosticCountByType.entries())
          .sort(([left], [right]) => String(left).localeCompare(String(right)))
      )
    });

    const maybeEmitInteractiveDiagnostic = ({ eventType, eventId, message }) => {
      const key = String(eventId || '');
      if (!key) return;
      const now = Date.now();
      const prior = interactiveDiagnostics.get(key) || { count: 0, lastEmitMs: 0 };
      const next = {
        count: prior.count + 1,
        lastEmitMs: prior.lastEmitMs
      };
      const shouldEmit = next.count === 1
        || (next.count % DIAGNOSTIC_REPEAT_COUNT === 0)
        || (now - next.lastEmitMs >= DIAGNOSTIC_REPEAT_INTERVAL_MS);
      if (!shouldEmit) {
        interactiveDiagnostics.set(key, next);
        return;
      }
      const repeat = next.count > 1 ? ` x${next.count}` : '';
      const excerpt = truncateForDisplay(message, 110);
      appendLog(`[diagnostics] ${eventType}${repeat} ${eventId} ${excerpt}`, 'warn');
      next.lastEmitMs = now;
      interactiveDiagnostics.set(key, next);
    };

    const emitDiagnostic = ({
      eventType,
      message,
      source = 'stream',
      level = null,
      stage = null,
      taskId = null
    }) => {
      if (!eventType || !message) return;
      const signature = buildBenchDiagnosticSignature({
        eventType,
        stage,
        taskId,
        source,
        message: normalizeSignatureMessage(message)
      });
      const eventId = buildBenchDiagnosticEventId({ eventType, signature });
      const occurrence = (diagnosticCountById.get(eventId) || 0) + 1;
      diagnosticCountById.set(eventId, occurrence);
      diagnosticCountByType.set(eventType, (diagnosticCountByType.get(eventType) || 0) + 1);
      diagnosticEventCount += 1;
      const payload = {
        schemaVersion: BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION,
        ts: new Date().toISOString(),
        eventType,
        eventId,
        occurrence,
        signature,
        label,
        command: toText(cmd) || null,
        source: toText(source) || 'stream',
        message: truncateForDisplay(message, 400),
        level: toText(level) || null,
        stage: toText(stage) || null,
        taskId: toText(taskId) || null
      };
      for (const filePath of diagnosticStreams) {
        appendJsonLineSync(filePath, payload);
      }
      maybeEmitInteractiveDiagnostic({ eventType, eventId, message: payload.message });
    };

    const inspectDiagnostic = ({ line, event, source }) => {
      const text = event && typeof event.message === 'string' && event.message.trim()
        ? event.message
        : line;
      const eventType = resolveDiagnosticType(text, event);
      if (!eventType) return;
      emitDiagnostic({
        eventType,
        message: text,
        source: event ? 'progress-event' : source,
        level: event?.level || null,
        stage: event?.stage || null,
        taskId: event?.taskId || null
      });
    };

    const pushSchedulerEvent = ({ message = '', source = 'stream', level = null, stage = null, taskId = null } = {}) => {
      const resolvedMessage = String(message || '').trim();
      if (!resolvedMessage || !resolvedMessage.includes(SCHEDULER_EVENT_MARKER)) return;
      schedulerEvents.push({
        ts: new Date().toISOString(),
        source,
        message: resolvedMessage,
        ...(typeof level === 'string' && level ? { level } : {}),
        ...(typeof stage === 'string' && stage ? { stage } : {}),
        ...(typeof taskId === 'string' && taskId ? { taskId } : {})
      });
      if (schedulerEvents.length > SCHEDULER_EVENT_WINDOW) schedulerEvents.shift();
    };
    const getSchedulerEvents = () => schedulerEvents.slice();
    setActiveChild({ pid: null }, label);
    writeLog(`[start] ${label}`);
    const handleLine = ({ line, event = null, source = 'stream' }) => {
      const textLine = String(line || '');
      const parsedEvent = event || (textLine ? parseProgressEventLine(textLine, { strict: true }) : null);
      inspectDiagnostic({ line: textLine, event: parsedEvent, source });
      if (parsedEvent) {
        pushSchedulerEvent({
          source: 'progress-event',
          message: parsedEvent?.message || '',
          level: parsedEvent?.level || null,
          stage: parsedEvent?.stage || null,
          taskId: parsedEvent?.taskId || null
        });
      } else {
        pushSchedulerEvent({
          source,
          message: textLine
        });
      }
      if (parsedEvent && typeof onProgressEvent === 'function') {
        onProgressEvent(parsedEvent);
        return;
      }
      appendLog(textLine);
    };
    const stdoutDecoder = createProgressLineDecoder({
      strict: true,
      onLine: ({ line, event }) => handleLine({ line, event, source: 'stdout' }),
      onOverflow: () => writeLog('[warn] truncated oversized stdout progress line')
    });
    const stderrDecoder = createProgressLineDecoder({
      strict: true,
      onLine: ({ line, event }) => handleLine({ line, event, source: 'stderr' }),
      onOverflow: () => writeLog('[warn] truncated oversized stderr progress line')
    });
    try {
      const result = await spawnSubprocess(cmd, args, {
        ...spawnOptions,
        onSpawn: (child) => setActiveChild(child, label),
        onStdout: (chunk) => stdoutDecoder.push(chunk),
        onStderr: (chunk) => stderrDecoder.push(chunk)
      });
      stdoutDecoder.flush();
      stderrDecoder.flush();
      const code = result.exitCode;
      writeLog(`[finish] ${label} code=${code}`);
      clearActiveChild(result.pid);
      if (code === 0) {
        return {
          ok: true,
          schedulerEvents: getSchedulerEvents(),
          diagnostics: buildDiagnosticsSummary()
        };
      }
      appendLog(`[run] failed: ${label}`);
      writeLog(`[error] run failed: ${label}`);
      emitLogPaths('[error]');
      if (logHistory.length) {
        appendLog('[run] tail:');
        logHistory.slice(-10).forEach((line) => appendLog(`- ${line}`));
        logHistory.slice(-10).forEach((line) => writeLog(`[error] ${line}`));   
      }
      if (logHistory.some((line) => line.toLowerCase().includes('filename too long'))) {
        appendLog('[hint] Windows long paths: set `git config --global core.longpaths true` or use a shorter --root.');
        writeLog('[hint] Enable Windows long paths and set `git config --global core.longpaths true` or use a shorter --root path.');
      }
      if (!continueOnError) {
        logExit('failure', code ?? 1);
        process.exit(code ?? 1);
      }
      return {
        ok: false,
        code: code ?? 1,
        schedulerEvents: getSchedulerEvents(),
        diagnostics: buildDiagnosticsSummary()
      };
    } catch (err) {
      stdoutDecoder.flush();
      stderrDecoder.flush();
      const message = err?.message || err;
      writeLog(`[error] ${label} spawn failed: ${message}`);
      clearActiveChild(err?.result?.pid ?? null);
      appendLog(`[run] failed: ${label}`);
      emitLogPaths('[error]');
      if (logHistory.length) {
        appendLog('[run] tail:');
        logHistory.slice(-10).forEach((line) => appendLog(`- ${line}`));
        logHistory.slice(-10).forEach((line) => writeLog(`[error] ${line}`));   
      }
      if (!continueOnError) {
        logExit('failure', err?.exitCode ?? 1);
        process.exit(err?.exitCode ?? 1);
      }
      return {
        ok: false,
        code: err?.exitCode ?? 1,
        schedulerEvents: getSchedulerEvents(),
        diagnostics: buildDiagnosticsSummary()
      };
    }
  };

  return {
    runProcess,
    killProcessTree,
    logExit,
    getActiveChild: () => activeChild,
    getActiveLabel: () => activeLabel
  };
};
