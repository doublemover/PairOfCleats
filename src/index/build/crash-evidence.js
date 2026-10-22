import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWriteJsonSync } from '../../shared/io/atomic-write.js';
import { redactDiagnosticText } from '../../shared/diagnostic-text.js';

const token = value => String(value || 'unscoped').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
const MAX_EVENT_BYTES = 64 * 1024;
const safeValue = (value, depth = 0, seen = new Set()) => {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactDiagnosticText(value, 8192);
  if (typeof value !== 'object') return redactDiagnosticText(value, 256);
  if (depth >= 6 || seen.has(value)) return '[truncated]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.slice(0, 64).map(item => safeValue(item, depth + 1, seen));
    const result = {};
    for (const key of Object.keys(value).slice(0, 64)) {
      if (/password|secret|api[_-]?key|access[_-]?token|authorization/i.test(key)) result[key] = '[redacted]';
      else {
        try { result[key] = safeValue(value[key], depth + 1, seen); }
        catch { result[key] = '[unavailable]'; }
      }
    }
    return result;
  } finally { seen.delete(value); }
};

export const boundedCrashEvent = value => {
  let event;
  try { event = safeValue(value) ?? {}; }
  catch { return { message: 'Diagnostic value unavailable.', truncated: true }; }
  if (Buffer.byteLength(JSON.stringify(event), 'utf8') <= MAX_EVENT_BYTES) return event;
  return { message: redactDiagnosticText(value?.message || 'Diagnostic event exceeded its byte allowance.', 4096),
    code: redactDiagnosticText(value?.code || '', 128), truncated: true };
};

export const resolveConfirmedCrashEvidencePath = reference => {
  if (!reference?.written || typeof reference.evidencePath !== 'string') return null;
  try {
    const stat = fs.statSync(reference.evidencePath);
    if (!stat.isFile() || stat.size > MAX_EVENT_BYTES * 2) return null;
    const payload = JSON.parse(fs.readFileSync(reference.evidencePath, 'utf8'));
    return payload.evidenceOwnerId === reference.evidenceOwnerId
      && payload.attemptId === reference.attemptId ? reference.evidencePath : null;
  } catch { return null; }
};

export const redactCrashArguments = args => {
  let redactNext = false;
  return (Array.isArray(args) ? args : []).slice(0, 128).map(argument => {
    if (redactNext) { redactNext = false; return '[redacted]'; }
    const text = String(argument);
    if (/^--?[\w-]*(?:token|secret|password|api-key|apikey|credential)$/i.test(text)) redactNext = true;
    return redactDiagnosticText(text, 512);
  });
};

/** Immutable per-process/attempt terminal records survive mutable state races. */
export const createCrashEvidenceOwner = ({ repoCacheRoot, buildId = null, attemptId = null,
  parentAttemptId = null, mode = null, stage = null, runtimeReceiptPath = null } = {}) => {
  const evidenceOwnerId = `${process.pid}-${crypto.randomUUID()}`;
  const identity = { buildId, attemptId: attemptId || crypto.randomUUID(), parentAttemptId,
    evidenceOwnerId, mode, stage, pid: process.pid, parentPid: process.ppid, runtimeReceiptPath };
  const directory = path.join(repoCacheRoot, 'logs', 'attempts', token(buildId), token(identity.attemptId), evidenceOwnerId);
  const paths = { directory, logPath: path.join(directory, 'index-crash.log'),
    statePath: path.join(directory, 'index-crash-state.json'),
    tracePath: path.join(directory, 'index-crash-file-trace.ndjson'),
    eventsPath: path.join(directory, 'index-crash-events.json'),
    terminalPath: path.join(directory, 'index-crash-terminal.json') };
  let sequence = 0;
  return {
    identity, paths,
    writeTerminal(error, extra = {}) {
      const payload = { schemaVersion: '1.0.0', ts: new Date().toISOString(), ...identity,
        sequence: ++sequence, phase: 'error', ...boundedCrashEvent(extra), error: boundedCrashEvent(error) };
      const evidencePath = path.join(directory, `${String(sequence).padStart(6, '0')}-${crypto.randomUUID()}.terminal.json`);
      try {
        fs.mkdirSync(directory, { recursive: true });
        atomicWriteJsonSync(evidencePath, payload, { spaces: 2, newline: false });
      } catch (writeError) {
        return { written: false, evidencePath: null, ...identity,
          writeError: { code: writeError?.code || 'ERR_CRASH_EVIDENCE_WRITE', message: redactDiagnosticText(writeError?.message || writeError) } };
      }
      const result = { written: true, evidencePath, ...identity };
      // Latest paths are conveniences only; failures cannot invalidate history.
      for (const latest of [paths.terminalPath, path.join(repoCacheRoot, 'logs', 'index-crash-terminal.json')]) {
        try { atomicWriteJsonSync(latest, { ...payload, evidencePath }, { spaces: 2, newline: false }); }
        catch (writeError) { result.latestWriteError = { code: writeError?.code || 'ERR_CRASH_LATEST_WRITE', message: redactDiagnosticText(writeError?.message || writeError) }; }
      }
      return result;
    }
  };
};

/** Consumers prefer terminal authority over a potentially older phase snapshot. */
export const readCrashEvidenceState = async ({ terminalPath, statePath }) => {
  for (const target of [terminalPath, statePath]) {
    if (!target) continue;
    try {
      const stat = await fs.promises.stat(target);
      if (stat.size > MAX_EVENT_BYTES * 2) throw new Error('Crash state exceeds its read byte allowance.');
      return JSON.parse(await fs.promises.readFile(target, 'utf8'));
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  return null;
};
