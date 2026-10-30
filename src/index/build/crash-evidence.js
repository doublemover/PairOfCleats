import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWriteJsonSync } from '../../shared/io/atomic-write.js';
import { redactDiagnosticText } from '../../shared/diagnostic-text.js';

const token = value => String(value || 'unscoped').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_EVENT_NODES = 512;
const describeWriteError = (error, fallbackCode) => ({
  code: error?.code || fallbackCode,
  ...(typeof error?.causeCode === 'string' ? { causeCode: error.causeCode } : {}),
  message: redactDiagnosticText(error?.message || error)
});
const safeValue = (value, depth, seen, budget) => {
  if (--budget.nodes < 0 || budget.bytes < 16) { budget.truncated = true; return '[truncated]'; }
  const admit = scalar => {
    const bytes = Buffer.byteLength(JSON.stringify(scalar) ?? 'null', 'utf8');
    if (bytes > budget.bytes) { budget.truncated = true; return '[truncated]'; }
    budget.bytes -= bytes;
    return scalar;
  };
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return admit(value);
  if (typeof value === 'string') return admit(redactDiagnosticText(value, 8192));
  if (typeof value !== 'object') return admit(redactDiagnosticText(value, 256));
  if (depth >= 6 || seen.has(value)) return admit('[truncated]');
  seen.add(value);
  budget.bytes -= 2;
  try {
    if (Array.isArray(value)) {
      const result = [];
      for (let index = 0; index < Math.min(value.length, 64); index += 1) {
        result.push(safeValue(value[index], depth + 1, seen, budget)); budget.bytes -= 1;
        if (budget.truncated) break;
      }
      return result;
    }
    const result = {};
    const keys = Object.keys(value).slice(0, 64);
    // Capture original root diagnostic fields before a large payload exhausts
    // the shared traversal allowance. Fallback must never inspect them again.
    const primary = depth === 0 ? ['message', 'code'].filter(key => Object.prototype.propertyIsEnumerable.call(value, key)) : [];
    for (const key of [...primary, ...keys.filter(key => !primary.includes(key))].slice(0, 64)) {
      if (key.length > 1024 || budget.nodes < 1 || budget.bytes < 16) { budget.truncated = true; break; }
      admit(key); budget.bytes -= 2;
      if (budget.truncated) break;
      if (/password|secret|api[_-]?key|access[_-]?token|authorization|^token$/i.test(key)) result[key] = admit('[redacted]');
      else {
        try { result[key] = safeValue(value[key], depth + 1, seen, budget); }
        catch { result[key] = admit('[unavailable]'); }
      }
      if (budget.truncated) break;
    }
    return result;
  } finally { seen.delete(value); }
};

export const boundedCrashEvent = value => {
  let event;
  const budget = { nodes: MAX_EVENT_NODES, bytes: MAX_EVENT_BYTES - 1024, truncated: false };
  try { event = safeValue(value, 0, new Set(), budget) ?? {}; }
  catch { return { message: 'Diagnostic value unavailable.', truncated: true }; }
  if (!budget.truncated && Buffer.byteLength(JSON.stringify(event), 'utf8') <= MAX_EVENT_BYTES) return event;
  return { message: redactDiagnosticText(typeof event?.message === 'string' ? event.message : 'Diagnostic event exceeded its byte allowance.', 4096),
    code: redactDiagnosticText(typeof event?.code === 'string' ? event.code : '', 128), truncated: true };
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
          writeError: describeWriteError(writeError, 'ERR_CRASH_EVIDENCE_WRITE') };
      }
      const result = { written: true, evidencePath, ...identity };
      // Latest paths are conveniences only; failures cannot invalidate history.
      for (const latest of [paths.terminalPath, path.join(repoCacheRoot, 'logs', 'index-crash-terminal.json')]) {
        try { atomicWriteJsonSync(latest, { ...payload, evidencePath }, { spaces: 2, newline: false }); }
        catch (writeError) { result.latestWriteError = describeWriteError(writeError, 'ERR_CRASH_LATEST_WRITE'); }
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
