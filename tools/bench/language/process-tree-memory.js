import { performance } from 'node:perf_hooks';
import { readWindowsProcessSnapshot, projectOwnedProcessTree } from './process-tree-snapshot.js';
import { redactDiagnosticText } from '../../../src/shared/diagnostic-text.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';

/** Phase-local sampled resident bytes, including discovered descendants and
 * observed orphans. Snapshot scans are not atomic instantaneous high-water marks.
 * Every gap/cap/refusal stays visible; ordinary observation failure is not zero.
 */
export const createBenchProcessTreeSampler = ({ platform = process.platform, rootPid = process.pid,
  snapshot = readWindowsProcessSnapshot, now = () => performance.now(), intervalMs = 1000,
  automatic = true, maxSamples = 128, maxProcesses = 256, maxEvents = 2048 } = {}) => {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0 || rootPid > 0xffffffff
    || !Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 30000
    || !Number.isSafeInteger(maxProcesses) || maxProcesses < 1 || maxProcesses > 4096
    || !Number.isSafeInteger(maxSamples) || maxSamples < 1 || maxSamples > 1024
    || !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 8192) throw new TypeError('Invalid process-tree sampler bounds.');
  const phases = [], samples = [], events = [], knownIdentities = new Set(), activeEvents = new Map(), lifetimes = new Map();
  let phase = null, timer = null, inFlight = null, closed = false, rootCreatedAtTicks = null;
  let pendingFailure = null, hasPendingFailure = false, samplesCapped = false, eventsCapped = false;
  const cancelTimer = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const retainFailure = error => {
    if (hasPendingFailure && pendingFailure === error) return;
    pendingFailure = hasPendingFailure ? addStorageFailureContext(pendingFailure, {}, error, { secondaryPresent: true }) : error;
    hasPendingFailure = true;
  };
  const schedule = () => {
    if (!automatic || closed || !phase || platform !== 'win32' || hasPendingFailure || samplesCapped) return;
    timer = setTimeout(() => { timer = null; void sample('interval').catch(retainFailure).finally(schedule); }, intervalMs);
    timer.unref?.();
  };
  const sample = async (reason = 'requested') => {
    if (hasPendingFailure) throw pendingFailure;
    if (inFlight) return inFlight;
    if (closed || !phase || platform !== 'win32') return null;
    if (samples.length >= maxSamples) { samplesCapped = true; cancelTimer(); return null; }
    const sampledPhase = phase, startedAtMs = now();
    inFlight = (async () => {
      let result;
      try {
        const selected = projectOwnedProcessTree({ snapshot: await snapshot(), rootPid, rootCreatedAtTicks, knownIdentities, maxProcesses });
        rootCreatedAtTicks = selected.rootCreatedAtTicks;
        if (knownIdentities.size + selected.identities.filter(id => !knownIdentities.has(id)).length > 4096) {
          throw Object.assign(new Error('Process incarnation observation budget exceeded.'), { code: 'ERR_BENCH_PROCESS_TREE_CAP' });
        }
        for (const identity of selected.identities) knownIdentities.add(identity);
        const observedAtMs = now(), present = new Set(selected.identities);
        for (const row of selected.processes) {
          const identity = `${row.pid}:${row.createdAtTicks}`;
          if (!present.has(identity)) continue;
          const prior = lifetimes.get(identity);
          if (prior) {
            if (prior.currentlyMissing) prior.reappearedObservations++;
            prior.lastObservedAtMs = observedAtMs; prior.currentlyMissing = false;
          }
          else lifetimes.set(identity, { pid: row.pid, createdAtTicks: row.createdAtTicks,
            firstObservedAtMs: observedAtMs, lastObservedAtMs: observedAtMs, missingAtMs: null,
            lastMissingAtMs: null, missingObservations: 0, reappearedObservations: 0, currentlyMissing: false });
        }
        if (selected.status === 'complete-snapshot') for (const [identity, lifetime] of lifetimes) {
          if (!present.has(identity)) {
            lifetime.missingAtMs ??= observedAtMs; lifetime.lastMissingAtMs = observedAtMs;
            lifetime.missingObservations++; lifetime.currentlyMissing = true;
          }
        }
        for (const row of selected.processes) {
          const event = activeEvents.get(row.pid);
          if (event) {
            event.observations++;
            if (row.rssBytes !== null && present.has(`${row.pid}:${row.createdAtTicks}`)) event.samples++;
            else event.incompleteSamples++;
            if (!event.observedCreationTimes.includes(row.createdAtTicks)) event.observedCreationTimes.push(row.createdAtTicks);
          }
        }
        const { identities: ignoredIdentities, ...projection } = selected;
        result = projection;
      } catch (error) {
        // An unsettled observer is still a live resource owned by the runner;
        // the benchmark cannot downgrade it to an unavailable numeric sample.
        try { observeStorageResource(error, { phase: 'benchmark-process-tree-observer' }).requireSettled(); }
        catch (unsettled) { retainFailure(unsettled); throw unsettled; }
        result = { status: 'unavailable', rssBytes: null, errorCode: String(error?.code || 'UNKNOWN'),
          message: redactDiagnosticText(error?.message || error, 512), processes: [] };
      }
      const row = { phase: sampledPhase.id, reason, startedAtMs, finishedAtMs: now(), ...result };
      samples.push(row); return row;
    })();
    try { return await inFlight; } finally { inFlight = null; }
  };
  const endPhase = async () => {
    if (!phase) return;
    cancelTimer();
    try { if (inFlight) await inFlight; await sample('phase-end'); }
    catch (error) { retainFailure(error); }
    phase.finishedAtMs = now(); phase = null; cancelTimer();
    if (hasPendingFailure) throw pendingFailure;
  };
  const report = () => {
    const complete = samples.filter(row => row.status === 'complete-snapshot');
    const missedWorkerLifetimes = events.filter(event => event.type === 'process-start' && event.closedAtMs !== null && !event.samples).length;
    const gaps = phases.flatMap(entry => {
      const rows = samples.filter(row => row.phase === entry.id);
      const values = [], end = entry.finishedAtMs ?? now(); let previous = entry.startedAtMs;
      for (const row of rows) { values.push(Math.max(0, row.startedAtMs - previous)); previous = row.finishedAtMs; }
      values.push(Math.max(0, end - previous)); return values;
    });
    return { version: 1, status: platform !== 'win32' ? 'unsupported-platform' : !complete.length ? 'unavailable' : 'sampled-with-gaps',
      method: platform === 'win32' ? 'windows-cim-process-incarnations-working-set-bytes' : 'unsupported-platform', rootPid, rootCreatedAtTicks,
      peakIsLowerBound: true, atomicSnapshot: false, sharedPagesMayBeCountedPerProcess: true,
      unobservedBetweenSnapshotsPossible: true, sampledPeakBytes: complete.length ? Math.max(...complete.map(row => row.rssBytes)) : null,
      sampleCount: samples.length, incompleteSamples: samples.length - complete.length,
      missedWorkerLifetimes, eventCoverageComplete: !eventsCapped, samplesCapped, eventsCapped,
      unclosedWorkerLifetimes: events.filter(event => event.closedAtMs === null).length,
      eventIncarnationConflicts: events.filter(event => (event.observedCreationTimes?.length || 0) > 1).length,
      maxSamplingGapMs: gaps.length ? Math.max(...gaps) : null,
      observerCostMs: samples.reduce((sum, row) => sum + Math.max(0, row.finishedAtMs - row.startedAtMs), 0),
      intervalMs, lifetimes: structuredClone([...lifetimes.values()]),
      lifetimeAbsenceMeans: 'not-observed-in-later-complete-scan-not-exact-exit-time',
      phases: structuredClone(phases), events: structuredClone(events), samples: structuredClone(samples) };
  };
  return Object.freeze({ sample, endPhase, report,
    async beginPhase(id) {
      if (closed || phase || typeof id !== 'string' || !id || id.length > 128 || phases.length >= 16
        || phases.some(entry => entry.id === id)) throw new Error('Invalid process-tree observation phase.');
      phase = { id, startedAtMs: now(), finishedAtMs: null }; phases.push(phase);
      await sample('phase-start'); schedule();
    },
    observeEvent(event) {
      if (closed || !phase || !Number.isSafeInteger(event?.pid) || event.pid <= 0) return;
      if (event.type === 'process-start') {
        if (events.length === maxEvents) { eventsCapped = true; return; }
        const row = { type: 'process-start', phase: phase.id, pid: event.pid, startedAtMs: now(), closedAtMs: null,
          samples: 0, observations: 0, incompleteSamples: 0, observedCreationTimes: [] };
        events.push(row); activeEvents.set(event.pid, row);
      } else if (event.type === 'process-close') {
        const row = activeEvents.get(event.pid);
        if (row) { row.closedAtMs = now(); activeEvents.delete(event.pid); }
      }
    },
    async finish() {
      if (!closed) { try { await endPhase(); } finally { cancelTimer(); closed = true; } }
      if (hasPendingFailure) throw pendingFailure;
      return report();
    }
  });
};
