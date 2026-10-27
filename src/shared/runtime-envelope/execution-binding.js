import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';

const observers = new AsyncLocalStorage();
const announced = new WeakSet();
export const RUNTIME_EXECUTION_BINDING_KIND = 'pairofcleats.runtime-binding';
let processObserver = null;

/** Internal execution capability: never deserialized from a queue job or CLI. */
export const withRuntimeBindingObserver = (observer, action) => observers.run(
  typeof observer === 'function' ? observer : null, action
);
export const getRuntimeBindingObserver = () => observers.getStore() || processObserver;

/** Only the service's private subprocess preload installs a process sink. */
export const installRuntimeBindingProcessObserver = observer => {
  if (processObserver) throw new Error('Runtime binding process observer is already installed.');
  if (typeof observer !== 'function') throw new TypeError('Runtime binding observer must be a function.');
  processObserver = observer;
};

export const isRuntimeExecutionBinding = value => {
  if (!value || typeof value !== 'object' || value.kind !== RUNTIME_EXECUTION_BINDING_KIND || value.schemaVersion !== 1
    || !Number.isSafeInteger(value.pid) || value.pid <= 0) return false;
  for (const name of ['repoRoot', 'buildRoot', 'buildId', 'attemptId', 'correlationId']) {
    if (typeof value[name] !== 'string' || !value[name] || value[name].length > 4096) return false;
  }
  return path.isAbsolute(value.repoRoot) && path.isAbsolute(value.buildRoot)
    && (value.stage === null || typeof value.stage === 'string' && value.stage.length <= 128);
};

/** Emit once, after the existing required receipt writer confirms durability.
 * Monitoring failure cannot rewrite the build outcome or provenance contract.
 */
export const announceRuntimeExecutionBinding = (buildRoot, attempt) => {
  const observer = getRuntimeBindingObserver();
  if (!observer || announced.has(attempt)) return;
  const binding = Object.freeze({ kind: RUNTIME_EXECUTION_BINDING_KIND, schemaVersion: 1, pid: process.pid,
    repoRoot: attempt.paths?.repo?.absolute || attempt.paths?.repo?.selected,
    buildRoot: path.resolve(buildRoot), buildId: attempt.buildId, attemptId: attempt.attemptId,
    correlationId: attempt.correlationId, stage: attempt.stage ?? null });
  if (!isRuntimeExecutionBinding(binding)) return;
  announced.add(attempt);
  try { observer(binding); } catch { /* Progress is passive; the durable receipt remains authoritative. */ }
};
