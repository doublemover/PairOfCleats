import path from 'node:path';
import { withStorageDirectory } from '../../../src/shared/storage/directory.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { observeServiceBuildStateSnapshot } from './build-state-observation.js';
import { isRuntimeExecutionBinding, RUNTIME_EXECUTION_BINDING_KIND }
  from '../../../src/shared/runtime-envelope/execution-binding.js';

export const PROGRESS_DISCOVERY_PAGE_SIZE = 64;
export const PROGRESS_DISCOVERY_INTERVAL_MS = 5000;
const owners = new Map();

// Retain identity hints only, never a page of potentially megabyte-sized states.
const identityHint = (buildRoot, state) => {
  const latestAttemptId = state?.runtime?.latestAttemptId;
  const attempt = Array.isArray(state?.runtime?.attempts)
    ? state.runtime.attempts.find(row => row?.attemptId === latestAttemptId) : null;
  if (!attempt || !isRuntimeExecutionBinding({ kind: RUNTIME_EXECUTION_BINDING_KIND, schemaVersion: 1,
    pid: 1, repoRoot: state.repoRoot, buildRoot: state.buildRoot, buildId: state.buildId,
    attemptId: attempt.attemptId, correlationId: attempt.correlationId, stage: attempt.stage ?? null })) return null;
  return Object.freeze({ buildRoot, state: { buildRoot: state.buildRoot, repoRoot: state.repoRoot,
    buildId: state.buildId, runtime: { latestAttemptId, attempts: [{ attemptId: attempt.attemptId,
      buildId: attempt.buildId, stage: attempt.stage, correlationId: attempt.correlationId }] } } });
};

/** Repository-owned compatibility enumeration, shared across waiting monitors.
 * Each page reads at most 64 entries and state files, with no stats or sorting.
 * The original directory owner spans incremental pages and confirms its close.
 */
export const createBuildProgressDiscovery = ({ repoCacheRoot, now = Date.now } = {}) => {
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  let directory = null, inFlight = null, closed = false, closePromise = null, failure = null;
  let hints = Object.freeze([]), nextAt = 0, backoff = PROGRESS_DISCOVERY_INTERVAL_MS;
  const work = { cycles: 0, pages: 0, entries: 0, stateReads: 0, knownReadBytes: 0,
    jsonDecodes: 0, unknownReadAttempts: 0, coalesced: 0, backoffs: 0 };
  const statuses = { ok: 0, missing: 0, oversized: 0, corrupt: 0, unsafe: 0, transient: 0 };
  const closeDirectory = async () => {
    if (!directory) return;
    const original = directory;
    original.finish.resolve();
    try { await original.completion; }
    catch (error) {
      // Never replace an unconfirmed original directory with a new cursor.
      observeStorageResource(error, { phase: 'service-progress-discovery-close' }).requireSettled();
      directory = null;
      throw error;
    }
    directory = null;
  };
  const openDirectory = async () => {
    const ready = Promise.withResolvers(), finish = Promise.withResolvers();
    const record = { finish, completion: null, reader: null };
    directory = record;
    record.completion = withStorageDirectory(buildsRoot, async reader => {
      ready.resolve(reader);
      await finish.promise;
    });
    record.completion.catch(error => ready.reject(error));
    try { record.reader = await ready.promise; }
    catch (error) {
      observeStorageResource(error, { phase: 'service-progress-discovery-open' }).requireSettled();
      directory = null;
      throw error;
    }
    work.cycles++;
  };
  const scan = async () => {
    const page = [];
    work.pages++;
    try {
      if (!directory) await openDirectory();
      for (let seen = 0; seen < PROGRESS_DISCOVERY_PAGE_SIZE; seen++) {
        const entry = await directory.reader.read();
        if (!entry) {
          await closeDirectory();
          nextAt = now() + backoff;
          backoff = Math.min(30000, backoff * 2);
          hints = Object.freeze(page);
          return hints;
        }
        work.entries++;
        if (!entry.isDirectory()) continue;
        const buildRoot = path.join(buildsRoot, entry.name);
        const observation = await observeServiceBuildStateSnapshot(buildRoot);
        work.stateReads++;
        statuses[observation.status]++;
        work.jsonDecodes += observation.jsonDecodes;
        if (observation.bytes === null) work.unknownReadAttempts++;
        else work.knownReadBytes += observation.bytes;
        if (observation.status === 'ok') {
          const hint = identityHint(buildRoot, observation.state);
          if (hint) page.push(hint);
        }
      }
      nextAt = now() + PROGRESS_DISCOVERY_INTERVAL_MS;
      hints = Object.freeze(page);
      return hints;
    } catch (error) {
      if (directory) {
        try { await closeDirectory(); }
        catch (secondary) { throw addStorageFailureContext(error, {}, secondary); }
      }
      observeStorageResource(error, { phase: 'service-progress-discovery-read' }).requireSettled();
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      hints = Object.freeze([]);
      nextAt = now() + backoff;
      backoff = Math.min(30000, backoff * 2);
      return hints;
    }
  };
  const discover = () => {
    if (closed) return Promise.resolve(Object.freeze([]));
    if (failure) return Promise.reject(failure);
    if (inFlight) { work.coalesced++; return inFlight; }
    if (now() < nextAt) { work.backoffs++; return Promise.resolve(hints); }
    inFlight = scan().catch(error => { failure = error; throw error; }).finally(() => { inFlight = null; });
    return inFlight;
  };
  const close = () => {
    if (!closePromise) {
      closed = true;
      closePromise = (async () => {
        let primary = null;
        try { await inFlight; } catch (error) { primary = error; }
        try { await closeDirectory(); }
        catch (error) { throw primary ? addStorageFailureContext(primary, {}, error) : error; }
        if (primary) throw primary;
      })();
      closePromise.catch(() => {});
    }
    return closePromise;
  };
  return Object.freeze({ discover, close, getDiagnostics: () => Object.freeze({ ...work,
    statuses: Object.freeze({ ...statuses }), nextAt, retainedHints: hints.length, cursorOpen: Boolean(directory) }) });
};

export const acquireBuildProgressDiscovery = ({ repoCacheRoot }) => {
  const key = path.resolve(repoCacheRoot);
  let entry = owners.get(key);
  if (entry?.closing) {
    if (!entry.failure) throw new Error('Repository progress discovery is closing.');
    observeStorageResource(entry.failure, { phase: 'service-progress-discovery-reacquire' }).requireSettled();
    owners.delete(key);
    entry = null;
  }
  if (!entry) {
    entry = { owner: createBuildProgressDiscovery({ repoCacheRoot: key }), refs: 0, closing: null, failure: null };
    owners.set(key, entry);
  }
  entry.refs++;
  let released = null;
  return Object.freeze({ discover: entry.owner.discover, getDiagnostics: entry.owner.getDiagnostics,
    release: () => {
      if (!released) released = (async () => {
        if (--entry.refs) return;
        entry.closing = entry.owner.close();
        try { await entry.closing; owners.delete(key); }
        catch (error) { entry.failure = error; throw error; }
      })();
      return released;
    } });
};
