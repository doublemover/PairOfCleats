import fs from 'node:fs';
import path from 'node:path';
import { acquireFileLock, readLockInfoSync, releaseFileLockOrThrow } from '../../src/shared/locks/file-lock.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { createStorageObservationLedger } from '../../src/shared/storage/failure-observation.js';
import { CHECKOUT_MUTATION_LOCK } from './checkout-bootstrap-paths.js';
import { assertPersistenceFileIdentity } from '../../src/shared/io/file-identity.js';
import { retainPublishedFileLockPrerequisite } from '../../src/shared/locks/file-lock-producer-observations.js';

const sessions = new WeakMap();
const fail = (code, message) => Object.assign(new Error(message), { code });
const canonicalRoot = root => fs.realpathSync(path.resolve(root));
const prepareState = root => {
  let current = root;
  for (const part of ['.tmp', 'checkout-bootstrap']) {
    current = path.join(current, part);
    try { fs.mkdirSync(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('ERR_CHECKOUT_MUTATION_STATE', 'Checkout bootstrap state requires regular application-owned directories.');
  }
};

/** Original session only: serialized metadata and ambient environment values
 * cannot authorize a nested mutator. Exact lock identity is checked at each
 * admission/publication boundary, without claiming path-deletion authority.
 */
export const requireCheckoutMutationSession = (root, session) => {
  const state = session && sessions.get(session);
  if (!state || state.phase !== 'active' || state.root !== canonicalRoot(root)) throw fail('ERR_CHECKOUT_MUTATION_SESSION', 'An original active checkout mutation session is required.');
  assertPersistenceFileIdentity(fs.lstatSync(state.lock.lockPath, { bigint: true }), state.lockIdentity);
  const current = readLockInfoSync(state.lock.lockPath), original = state.lock.payload;
  if (!current || ['lockId', 'pid', 'startedAt'].some(key => current[key] !== original[key])
    || current.resourceSettlementVersion !== 1) throw fail('ERR_CHECKOUT_MUTATION_REPLACED', 'Checkout mutation ownership changed; no successor or readiness publication is admitted.');
  return session;
};

/** Capture an original owner-local prerequisite before native admission. This
 * only retains the existing lock; it cannot create or transfer mutation rights.
 */
export const retainCheckoutMutationPrerequisite = (root, session, isSettled) => {
  requireCheckoutMutationSession(root, session);
  if (typeof isSettled !== 'function') throw new TypeError('Checkout prerequisite requires its original settlement observer.');
  sessions.get(session).ledger.remember(Object.freeze({ cacheOwnershipPending: true, cacheOwnershipReleased: isSettled }));
};

/** Retry only this original lock's release after its captured prerequisites
 * settle. No age/PID inference, child termination, recursive cleanup or stealing.
 */
export const retireCheckoutMutationSession = async session => {
  const state = session && sessions.get(session);
  if (!state || !['retiring', 'retired'].includes(state.phase)) throw fail('ERR_CHECKOUT_MUTATION_SESSION', 'An original retiring checkout mutation session is required.');
  if (state.phase === 'retired') return true;
  try {
    await releaseFileLockOrThrow(state.lock, { workerError: state.releaseFailure ?? state.operationFailure });
    state.phase = 'retired'; return true;
  } catch (error) { state.releaseFailure = error; throw error; }
};

/** Reuse the actual file-lock producer and its original resource prerequisites.
 * One caller spans the transaction; nested owned operations borrow its opaque
 * capability explicitly. A live or orphaned record is never reclaimed here.
 */
export const withCheckoutMutation = async (root, operation, { session = null, signal = null, kind = 'checkout-bootstrap' } = {}) => {
  if (typeof operation !== 'function' || typeof kind !== 'string' || !kind || kind.length > 64) throw new TypeError('Invalid checkout mutation operation.');
  root = canonicalRoot(root); signal?.throwIfAborted();
  if (session) {
    requireCheckoutMutationSession(root, session);
    const state = sessions.get(session);
    if (state.borrowed.size === 128) throw fail('ERR_CHECKOUT_MUTATION_BORROW_LIMIT', 'Checkout mutation has too many outstanding owned operations.');
    const pending = Promise.resolve().then(() => { requireCheckoutMutationSession(root, session); return operation(session); });
    state.borrowed.add(pending);
    pending.then(() => state.borrowed.delete(pending), error => {
      state.ledger.remember(error); state.borrowed.delete(pending);
      if (state.borrowedFailures.length < 128) state.borrowedFailures.push(error); else state.ledger.markIncomplete();
    });
    return pending;
  }
  prepareState(root);
  const lock = await acquireFileLock({ lockPath: path.join(root, CHECKOUT_MUTATION_LOCK), waitMs: 0, createParent: false, signal,
    metadata: { kind, root, resourceSettlementVersion: 1 }, staleRemovalImpl: async () => ({ removed: false, removalMode: 'owner' }) });
  if (!lock) throw fail('ERR_CHECKOUT_MUTATION_BUSY', 'Checkout preparation or retained original work owns this dependency tree. Inspect its owner; age or PID death does not authorize stealing the lock.');
  const actual = Object.freeze({ kind: 'checkout-mutation-session', root, runId: lock.payload.lockId });
  const state = { root, lock, phase: 'active', operationFailure: undefined, releaseFailure: null,
    lockIdentity: Object.freeze(Object.fromEntries(Object.entries(lock.publishedIdentity).map(([key, value]) => [key, String(value)]))),
    borrowed: new Set(), borrowedFailures: [], ledger: createStorageObservationLedger() };
  sessions.set(actual, state);
  let result, operationFailed = false;
  try {
    if (!retainPublishedFileLockPrerequisite(lock, Object.freeze({ cacheOwnershipPending: true,
      cacheOwnershipReleased: state.ledger.isSettled }))) throw fail('ERR_CHECKOUT_MUTATION_PUBLICATION', 'Checkout mutation requires its actual published lock owner.');
    requireCheckoutMutationSession(root, actual); result = await operation(actual); requireCheckoutMutationSession(root, actual);
  }
  catch (error) { operationFailed = true; state.operationFailure = error; state.ledger.remember(error); }
  if (state.borrowed.size) {
    const unawaited = fail('ERR_CHECKOUT_MUTATION_UNAWAITED_OPERATION', 'Checkout mutation returned with outstanding owned operations; their original work must drain.');
    state.operationFailure = operationFailed ? new AggregateError([state.operationFailure, unawaited], unawaited.message, { cause: state.operationFailure }) : unawaited;
    operationFailed = true; state.phase = 'draining';
    await Promise.allSettled([...state.borrowed]);
    if (state.borrowedFailures.length) state.operationFailure = new AggregateError([state.operationFailure, ...state.borrowedFailures],
      'Outstanding checkout work failed while draining.', { cause: state.operationFailure });
  }
  try { state.ledger.requireSettled(); }
  catch (pending) {
    const context = state.borrowedFailures.length ? addStorageFailureContext(new AggregateError([...state.borrowedFailures, pending],
      'Original checkout work retains resources.', { cause: state.borrowedFailures[0] }), {}, pending, { secondaryPresent: true }) : pending;
    state.operationFailure = operationFailed ? addStorageFailureContext(state.operationFailure, {}, context, { secondaryPresent: true }) : context;
    operationFailed = true;
  }
  state.phase = 'retiring';
  try { await retireCheckoutMutationSession(actual); }
  catch (cleanup) {
    let releaseContext = cleanup;
    for (const original of state.borrowedFailures) releaseContext = addStorageFailureContext(releaseContext, {}, original, { secondaryPresent: true });
    throw operationFailed ? addStorageFailureContext(state.operationFailure, { checkoutMutationSession: actual }, releaseContext,
      { secondaryPresent: true, nonEnumerable: ['checkoutMutationSession'] })
      : addStorageFailureContext(releaseContext, { checkoutMutationSession: actual }, null, { nonEnumerable: ['checkoutMutationSession'] });
  }
  if (operationFailed) throw state.operationFailure;
  return result;
};
