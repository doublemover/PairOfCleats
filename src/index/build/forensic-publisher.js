import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../../shared/hash.js';
import { atomicWriteJson, atomicWriteText } from '../../shared/io/atomic-write.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import { runWithIndependentSchedulerOwner } from '../../shared/concurrency/scheduler-task-scope.js';

const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
const MAX_PENDING_BYTES = 8 * 1024 * 1024;
const MAX_ACCEPTED_BYTES = 32 * 1024 * 1024;
const MAX_PENDING = 32;
const MAX_ATTEMPTS = 512;
const fail = reason => Object.assign(new Error(`Forensic publication refused: ${reason}`), {
  code: 'ERR_CRASH_FORENSIC_PUBLICATION', reason
});

/** One logger's existing forensic publication owner. The shared PQueue serializes
 * atomic payload/index writes; per-call policy never changes a coalesced outcome.
 * Byte limits cover retained serialized payloads, not stringify peak or OS quota.
 */
export const createForensicPublisher = ({ directory, indexPath, sanitizeToken, getContext, appendLine, warnIo }) => {
  const committed = new Map(), inFlight = new Map(), requiredFailures = new Map(), pending = new Set(), calls = new Set(), observations = [];
  let accepting = true, queuePromise = null, pendingBytes = 0, acceptedBytes = 0, attempts = 0, callers = 0, observationOverflow = false;
  const remember = (value, phase) => {
    const observation = observeStorageResource(value, { phase: `forensic-${phase}` });
    if (observation.hasResourceObservation) {
      if (observations.length >= 4096) { observationOverflow = true; throw Object.assign(fail('observation-history'), { cacheOwnershipPending: true }); }
      observations.push(observation);
    }
    observation.requireSettled(); return value;
  };
  const requireOriginals = () => {
    if (observationOverflow) throw Object.assign(fail('observation-history'), { cacheOwnershipPending: true });
    for (const observation of observations) observation.requireSettled();
  };
  const getQueue = () => queuePromise ||= import('p-queue').then(({ default: PQueue }) => new PQueue({ concurrency: 1 }));
  const publish = async job => {
    requireOriginals();
    remember(await fs.mkdir(directory, { recursive: true }), 'directory-create');
    requireOriginals();
    remember(await atomicWriteText(job.path, job.text), 'payload-write');
    requireOriginals();
    const next = new Map(committed); next.set(job.key, job.entry);
    remember(await atomicWriteJson(indexPath, { ts: new Date().toISOString(), entries: [...next.values()].sort(
      (left, right) => left.signature.localeCompare(right.signature) || left.kind.localeCompare(right.kind)) }, { spaces: 2 }), 'index-write');
    requireOriginals();
    remember(await appendLine(`forensic bundle persisted (${job.entry.kind})`, { signature: job.entry.signature, path: job.path }), 'append-result');
    requireOriginals();
    // Only a fully settled publication can supply an in-memory dedup receipt.
    committed.set(job.key, job.entry); requiredFailures.delete(job.key);
    return job.path;
  };
  const start = job => {
    pendingBytes += job.bytes; acceptedBytes += job.bytes; attempts++;
    job.promise = runWithIndependentSchedulerOwner(async () => {
      try { return await (await getQueue()).add(() => publish(job)); }
      catch (error) {
        if (job.required) requiredFailures.set(job.key, error);
        remember(error, 'original-publication-error'); throw error;
      } finally {
        pendingBytes -= job.bytes; inFlight.delete(job.key); pending.delete(job.promise);
        job.text = null;
      }
    });
    // An intentionally ignored diagnostic promise remains observed by this owner;
    // awaiting callers and flush/close still see its real outcome.
    job.promise.catch(() => {});
    inFlight.set(job.key, job); pending.add(job.promise);
    return job;
  };
  const persistImpl = async (input = {}) => {
    if (!accepting) throw fail('logger-closed');
    if (callers >= MAX_PENDING) throw fail('accepted-work-budget');
    callers++;
    let required = false;
    const originals = [];
    const capture = value => {
      const observation = observeStorageResource(value, { phase: 'forensic-request' });
      originals.push(observation); observation.requireSettled(); return value;
    };
    const requireRequest = () => { for (const observation of originals) observation.requireSettled(); };
    try {
      capture(input); required = input.required === true;
      const bundle = capture(input.bundle), meta = capture(input.meta ?? null);
      if (!bundle || typeof bundle !== 'object') return null;
      const kind = sanitizeToken(input.kind ?? 'forensic', 'forensic');
      const signatureHint = input.signature || bundle.signature;
      requireRequest(); requireOriginals();
      const bundleText = JSON.stringify(bundle);
      if (typeof bundleText !== 'string' || Buffer.byteLength(bundleText) > MAX_PAYLOAD_BYTES) throw fail('payload-byte-budget');
      const snapshot = JSON.parse(bundleText);
      const signature = sanitizeToken(signatureHint || sha1(`{"kind":${JSON.stringify(kind)},"bundle":${bundleText}}`).slice(0, 20), 'bundle');
      const key = `${kind}\0${signature}`;
      let job = inFlight.get(key);
      if (!job && committed.has(key)) { requireRequest(); requireOriginals(); return committed.get(key).path; }
      if (!job) {
        const context = getContext(), ts = new Date().toISOString();
        const text = JSON.stringify({ ts, kind, signature, phase: context.phase ?? null, file: context.file ?? null,
          meta, bundle: snapshot }, null, 2);
        const bytes = Buffer.byteLength(text);
        if (bytes > MAX_PAYLOAD_BYTES || pendingBytes + bytes > MAX_PENDING_BYTES || acceptedBytes + bytes > MAX_ACCEPTED_BYTES
          || attempts >= MAX_ATTEMPTS || pending.size >= MAX_PENDING) throw fail('accepted-work-budget');
        requireRequest(); requireOriginals();
        const target = path.join(directory, `${kind}-${signature}.json`);
        job = start({ key, path: target, text, bytes, required, promise: null, entry: Object.freeze({ ts, kind, signature, path: target }) });
      } else if (required) job.required = true;
      for (const observation of originals) if (observation.hasResourceObservation) {
        if (observations.length >= 4096) { observationOverflow = true; throw Object.assign(fail('observation-history'), { cacheOwnershipPending: true }); }
        observations.push(observation);
      }
      const result = await job.promise;
      requireRequest(); requireOriginals(); return result;
    } catch (error) {
      try { remember(error, 'caller-outcome'); requireRequest(); }
      catch (ownership) { throw addStorageFailureContext(error, {}, ownership, { secondaryPresent: true, forceAggregate: true }); }
      if (required) throw error;
      try { remember(await warnIo('persist forensic bundle', error), 'warning-result'); }
      catch (reporting) {
        let retained = reporting;
        try { remember(reporting, 'warning-failure'); } catch (pending) { retained = pending; }
        throw addStorageFailureContext(error, {}, retained, { secondaryPresent: true, forceAggregate: true });
      }
      requireRequest(); requireOriginals();
      return null;
    } finally { callers--; }
  };
  const persist = input => {
    if (!accepting) return Promise.reject(fail('logger-closed'));
    const outcome = runWithIndependentSchedulerOwner(() => persistImpl(input));
    calls.add(outcome);
    outcome.then(() => { calls.delete(outcome); }, () => { calls.delete(outcome); });
    return outcome;
  };
  const flush = async () => {
    // Exact accepted barrier; new calls after this snapshot belong to a later
    // flush. close() first stops intake, so its barrier covers all accepted work.
    const outcomes = await Promise.allSettled([...calls]); requireOriginals();
    const failures = [...new Set([...requiredFailures.values(), ...outcomes.filter(
      outcome => outcome.status === 'rejected').map(outcome => outcome.reason)])];
    if (failures.length) {
      let error = failures[0];
      for (const secondary of failures.slice(1)) error = addStorageFailureContext(error, {}, secondary, { secondaryPresent: true, forceAggregate: true });
      throw error;
    }
  };
  return Object.freeze({ persist, flush, stop: () => { accepting = false; } });
};
