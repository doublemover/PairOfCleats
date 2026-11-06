import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';
import { assertDirectoryIdentity } from '../../src/shared/io/directory-sync.js';
import { persistenceFileIdentity, assertPersistenceFileIdentity } from '../../src/shared/io/file-identity.js';
import { createContainedFileResource } from '../../src/shared/contained-file-resource.js';
import { readJsonResourceTextSync } from '../../src/shared/file-read-resource.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { createStorageObservationLedger } from '../../src/shared/storage/failure-observation.js';
import { readErrorDataProperty } from '../../src/shared/error-data.js';
import { requireCheckoutMutationSession, withCheckoutMutation } from './checkout-mutation.js';

export const CHECKOUT_JOURNAL_VERSION = 1;
export const CHECKOUT_JOURNAL_STATUS = '.tmp/checkout-bootstrap/journal-status.json';
export const CHECKOUT_JOURNAL_LIMITS = Object.freeze({ stages: 16, events: 128, bytes: 256 * 1024, planBytes: 64 * 1024 });
const journals = new WeakMap();
const failure = message => Object.assign(new Error(message), { code: 'ERR_CHECKOUT_BOOTSTRAP_JOURNAL' });
const ownText = (value, field, max = 1024) => {
  const text = readErrorDataProperty(value, field); return typeof text === 'string' ? text.slice(0, max) : null;
};
const projectedFailure = error => Object.freeze({ type: error === null ? 'null' : typeof error,
  code: ownText(error, 'code', 128), message: ownText(error, 'message'),
  ...(['boolean', 'number', 'string'].includes(typeof error) ? { value: typeof error === 'string' ? error.slice(0, 1024) : error } : {}) });

/** An in-process original owner, not a serialized resume/deletion capability. */
export const getCheckoutStageJournal = session => session && journals.get(session)?.journal || null;

const createJournal = (root, session, plan, { io = fs, publish = atomicWriteJson } = {}) => {
  requireCheckoutMutationSession(root, session); root = session.root;
  const serializedPlan = JSON.stringify(plan);
  if (typeof serializedPlan !== 'string' || Buffer.byteLength(serializedPlan) > CHECKOUT_JOURNAL_LIMITS.planBytes) throw failure('Checkout plan exceeds its journal byte bound.');
  const captured = JSON.parse(serializedPlan), stages = captured.stages;
  const pendingObjects = [captured]; let objects = 0;
  while (pendingObjects.length) {
    const value = pendingObjects.pop();
    if (!value || typeof value !== 'object') continue;
    if (++objects > 4096) throw failure('Checkout plan exceeds its object bound.');
    pendingObjects.push(...Object.values(value)); Object.freeze(value);
  }
  if (!Array.isArray(stages) || !stages.length || stages.length > CHECKOUT_JOURNAL_LIMITS.stages
    || stages.some(stage => typeof stage.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,96}$/.test(stage.id))
    || new Set(stages.map(stage => stage.id)).size !== stages.length) throw failure('Checkout journal requires a bounded ordered stage plan.');
  const parent = path.join(root, '.tmp', 'checkout-bootstrap'), directory = fs.mkdtempSync(path.join(parent, 'j-'));
  const directoryIdentity = fs.lstatSync(directory, { bigint: true }); assertDirectoryIdentity(directoryIdentity);
  const file = path.join(directory, 'stages.jsonl'), statusFile = path.join(root, CHECKOUT_JOURNAL_STATUS);
  const methods = { receiver: io, stat: io.fstatSync, read: io.readSync, close: io.closeSync, write: io.writeSync, sync: io.fsyncSync };
  const fd = io.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0), 0o600);
  const owner = createContainedFileResource({ fd, sync: true, methods, additionalMethods: ['write', 'sync'] });
  let initialIdentity = null;
  const hash = createHash('sha256'), startedAt = Date.now(), outcomes = [], observations = createStorageObservationLedger();
  const pendingWork = new Set(), observedFailures = [];
  const remember = error => {
    observations.remember(error);
    if (observedFailures.length < 128) observedFailures.push(error); else observations.markIncomplete();
  };
  const track = operation => {
    if (pendingWork.size >= 128) return Promise.reject(failure('Checkout journal has too much outstanding original work.'));
    const pending = withCheckoutMutation(root, operation, { session }); pendingWork.add(pending);
    pending.then(() => pendingWork.delete(pending), error => { pendingWork.delete(pending); remember(error); });
    return pending;
  };
  const planId = createHash('sha256').update(serializedPlan).digest('hex');
  let bytes = 0, sequence = 0, activeStage = null, closed = false, generationId = null, lastMetadata = null,
    appendFailed = false, stageFailed = false, fileVerified = false, runError = null;
  const check = () => {
    requireCheckoutMutationSession(root, session);
    assertDirectoryIdentity(fs.lstatSync(directory, { bigint: true }), directoryIdentity);
  };
  const append = event => {
    check(); if (closed || appendFailed) throw failure('Checkout journal no longer admits stage observations.');
    const original = owner.operations.stat({ bigint: true });
    if (original.size !== BigInt(bytes)) throw failure('Checkout journal extent changed before its next observation.');
    assertPersistenceFileIdentity(fs.lstatSync(file, { bigint: true }), persistenceFileIdentity(original));
    const row = Object.freeze({ schemaVersion: CHECKOUT_JOURNAL_VERSION, runId: session.runId, planId,
      sequence: sequence + 1, timestamp: Date.now(), ...event });
    const data = Buffer.from(JSON.stringify(row) + '\n');
    if (sequence >= CHECKOUT_JOURNAL_LIMITS.events || bytes + data.length > CHECKOUT_JOURNAL_LIMITS.bytes) throw failure('Checkout stage journal exhausted its finite event/byte budget.');
    let offset = 0;
    try { while (offset < data.length) {
      const count = owner.operations.write(data, offset, data.length - offset, null);
      if (!Number.isSafeInteger(count) || count < 0 || count > data.length - offset) {
        const unknown = Object.assign(failure('Checkout journal write returned unknown original operation evidence.'), { cacheOwnershipPending: true });
        owner.remember(unknown); throw unknown;
      }
      if (count === 0) throw failure('Checkout journal write did not confirm exact progress.');
      hash.update(data.subarray(offset, offset + count)); bytes += count; offset += count;
    } } catch (error) { appendFailed = true; throw error; }
    sequence++; return row;
  };
  const metadata = state => Object.freeze({ schemaVersion: CHECKOUT_JOURNAL_VERSION, kind: 'checkout-bootstrap-stage-journal', root,
    runId: session.runId, planId, inputId: typeof captured.inputId === 'string' ? captured.inputId : null,
    state, startedAt, finishedAt: state === 'running' ? null : Date.now(), generationId, error: runError,
    originalResources: owner.isSettled() && observations.isSettled() ? 'retired' : 'pending',
    stages: Object.freeze([...outcomes]), file: Object.freeze({ path: path.relative(root, file).replaceAll('\\', '/'), bytes,
      events: sequence, sha256: hash.copy().digest('hex'), complete: fileVerified }), selectedPlan: captured });
  const persist = async state => {
    const record = metadata(state);
    const expectedText = JSON.stringify(record), expectedBytes = Buffer.byteLength(expectedText);
    if (expectedBytes > CHECKOUT_JOURNAL_LIMITS.bytes) throw failure('Checkout status metadata exceeds its byte bound.');
    const actual = await publish(statusFile, record, { mkdir: false, spaces: 0, newline: false, durable: true, beforeCommit: check });
    if (typeof actual !== 'string' || path.resolve(actual) !== path.resolve(statusFile)) throw failure('Checkout journal publication did not confirm its original status path.');
    const identity = persistenceFileIdentity(fs.lstatSync(statusFile, { bigint: true }));
    const text = readJsonResourceTextSync(statusFile, stat => {
      if (stat.size !== expectedBytes) throw failure('Checkout status has a different original byte extent.');
    }, stat => assertPersistenceFileIdentity(stat, identity));
    check(); assertPersistenceFileIdentity(fs.lstatSync(statusFile, { bigint: true }), identity);
    if (text !== expectedText) throw failure('Checkout status differs from its original published record.');
    lastMetadata = Object.freeze(record); return record;
  };
  const journal = Object.freeze({ root, runId: session.runId, planId, file, statusFile,
    snapshot: () => lastMetadata,
    bindVerifiedGeneration: value => {
      check(); if (closed || typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw failure('Checkout verification requires its original active journal and exact generation identity.');
      if (generationId && generationId !== value) throw failure('Checkout journal already identifies a different verified generation.');
      generationId = value;
    },
    runStage: (id, action) => track(async () => {
      check(); if (closed || activeStage || stageFailed || stages[outcomes.length]?.id !== id || typeof action !== 'function') throw failure('Checkout stages must execute exactly once in their admitted order.');
      activeStage = id;
      const began = append({ state: 'stage-started', stageId: id });
      let result, primary, failed = false;
      try { result = await action(); }
      catch (error) { primary = error; failed = true; observations.remember(error); }
      const logicalFailure = !failed && readErrorDataProperty(result, 'ok') === false;
      if (failed || logicalFailure) stageFailed = true;
      const resultOk = readErrorDataProperty(result, 'ok'), resultStatus = readErrorDataProperty(result, 'status') ?? readErrorDataProperty(result, 'exitCode'),
        resultSignal = readErrorDataProperty(result, 'signal');
      const row = Object.freeze({ id, state: failed || logicalFailure ? 'failed' : 'succeeded', startedAt: began.timestamp,
        finishedAt: Date.now(), result: Object.freeze({ ok: typeof resultOk === 'boolean' ? resultOk : null,
          status: Number.isInteger(resultStatus) ? resultStatus : null, signal: typeof resultSignal === 'string' ? resultSignal.slice(0, 64) : null,
          diagnosticsPath: ownText(result, 'diagnosticsPath', 4096) }),
        error: failed ? projectedFailure(primary) : null, originalResources: observations.isSettled() ? 'retired' : 'pending' });
      outcomes.push(row);
      try { append({ state: 'stage-finished', stageId: id, outcome: row }); await persist('running'); }
      catch (error) {
        stageFailed = true;
        throw failed ? addStorageFailureContext(primary, { checkoutJournal: file }, error, { secondaryPresent: true })
          : addStorageFailureContext(error, { checkoutJournal: file, checkoutStageResult: result });
      } finally { activeStage = null; }
      if (failed) throw primary;
      return result;
    })
  });
  const finish = async (primary, failed) => {
    let failureValue = primary, hasFailure = failed;
    try { observations.requireSettled(); }
    catch (pending) {
      if (!hasFailure && observedFailures.length) { failureValue = observedFailures[0]; hasFailure = true; }
      failureValue = hasFailure ? addStorageFailureContext(failureValue, { checkoutJournal: file }, pending, { secondaryPresent: true }) : pending;
      hasFailure = true;
    }
    try {
      if (!failed && (activeStage || outcomes.length !== stages.length || outcomes.some(row => row.state !== 'succeeded'))) throw failure('Checkout journal cannot complete an unfinished or unsuccessful plan.');
      append({ state: failed ? 'run-failed' : 'run-completed', error: failed ? projectedFailure(primary) : null });
    } catch (error) {
      failureValue = hasFailure ? addStorageFailureContext(failureValue, { checkoutJournal: file }, error, { secondaryPresent: true }) : error;
      hasFailure = true;
    }
    try { owner.runSync(descriptor => {
      if (descriptor.sync() !== undefined) throw failure('Checkout journal synchronization did not confirm its standard void result.');
      const stat = descriptor.stat({ bigint: true }), identity = persistenceFileIdentity(stat);
      if (!initialIdentity || identity.dev !== initialIdentity.dev || identity.ino !== initialIdentity.ino || stat.size !== BigInt(bytes)) throw failure('Checkout journal changed outside its original writer.');
      assertPersistenceFileIdentity(fs.lstatSync(file, { bigint: true }), identity);
    }); } catch (error) {
      failureValue = hasFailure ? addStorageFailureContext(failureValue, { checkoutJournal: file }, error, { secondaryPresent: true }) : error;
      hasFailure = true;
    }
    closed = true;
    if (owner.isSettled() && !appendFailed && initialIdentity) {
      try {
        const identity = persistenceFileIdentity(fs.lstatSync(file, { bigint: true }));
        if (['dev', 'ino', 'birthtime'].some(key => identity[key] !== initialIdentity[key])) throw failure('Checkout journal original file changed at close.');
        const text = readJsonResourceTextSync(file, stat => {
          if (stat.size !== bytes || stat.size > CHECKOUT_JOURNAL_LIMITS.bytes) throw failure('Checkout journal closed byte extent changed.');
        }, stat => assertPersistenceFileIdentity(stat, identity));
        check(); assertPersistenceFileIdentity(fs.lstatSync(file, { bigint: true }), identity);
        if (createHash('sha256').update(text).digest('hex') !== hash.copy().digest('hex')) throw failure('Checkout journal differs from its original observation bytes.');
        fileVerified = true;
      } catch (error) {
        failureValue = hasFailure ? addStorageFailureContext(failureValue, { checkoutJournal: file }, error, { secondaryPresent: true }) : error;
        hasFailure = true;
      }
    }
    runError = hasFailure ? projectedFailure(failureValue) : null;
    try { await persist(hasFailure ? 'failed' : 'completed'); }
    catch (error) {
      failureValue = hasFailure ? addStorageFailureContext(failureValue, { checkoutJournal: file }, error, { secondaryPresent: true }) : error;
      hasFailure = true;
    }
    if (hasFailure) throw failureValue;
  };
  return { journal, finish, hasPendingWork: () => pendingWork.size > 0,
    drain: () => Promise.allSettled([...pendingWork]), borrow: operation => track(() => operation(journal, false)),
    start: async () => {
      initialIdentity = persistenceFileIdentity(owner.operations.stat({ bigint: true }));
      append({ state: 'run-started', plan: captured }); await persist('running');
    } };
};

/** Nested mutators share their caller's original journal; only its owner closes
 * the descriptor and publishes the terminal stage evidence. No stage is skipped
 * because an old serialized record says it previously completed.
 */
export const withCheckoutStageJournal = async (root, session, plan, operation, options = {}) => {
  requireCheckoutMutationSession(root, session);
  const borrowed = journals.get(session);
  if (borrowed) return borrowed.borrow(operation);
  const owner = createJournal(root, session, plan, options);
  journals.set(session, owner);
  let result, primary, failed = false;
  try { await owner.start(); result = await operation(owner.journal, true); }
  catch (error) { primary = error; failed = true; }
  if (owner.hasPendingWork()) {
    const unawaited = failure('Checkout journal returned with outstanding original stage or borrowed work.');
    primary = failed ? addStorageFailureContext(primary, { checkoutJournal: owner.journal.file }, unawaited, { secondaryPresent: true }) : unawaited;
    failed = true;
    for (const result of await owner.drain()) if (result.status === 'rejected') primary = addStorageFailureContext(primary, {}, result.reason, { secondaryPresent: true });
  }
  try { await owner.finish(primary, failed); }
  finally { journals.delete(session); }
  return result;
};
