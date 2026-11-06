import { createStorageObservationLedger } from '../../src/shared/storage/failure-observation.js';
import { requireCheckoutMutationSession, retainCheckoutMutationPrerequisite, withCheckoutMutation } from './checkout-mutation.js';

export const BOOTSTRAP_STATUS_OUTPUT_LIMITS = Object.freeze({ pending: 128, lineBytes: 8192, timeoutMs: 10000 });
const outputs = new WeakMap(), checkoutOutputs = new WeakMap();
const failure = (code, message) => Object.assign(new Error(message), { code });

const captureOutput = stream => {
  const prior = outputs.get(stream); if (prior) return prior;
  const write = stream?.write, on = stream?.on, remove = stream?.removeListener;
  if (![write, on, remove].every(method => typeof method === 'function')) throw new TypeError('Bootstrap status requires its original writable transport.');
  const pending = new Set(), errors = [], observations = createStorageObservationLedger();
  let failed = false, listening = false;
  const isSettled = () => pending.size === 0 && observations.isSettled();
  const error = (message = 'Bootstrap status transport failed.') => Object.assign(new AggregateError([...errors], message,
    errors.length ? { cause: errors[0] } : undefined), {
    code: 'ERR_BOOTSTRAP_STATUS_OUTPUT', cacheOwnershipPending: true, cacheOwnershipReleased: isSettled
  });
  const remember = original => {
    failed = true; observations.remember(original);
    if (!errors.includes(original)) {
      if (errors.length < 64) errors.push(original); else observations.markIncomplete();
    }
    for (const entry of pending) {
      entry.checkout?.observations.remember(original);
      if (!entry.callbackReceived) entry.reject(error());
    }
  };
  const closed = () => remember(failure('ERR_BOOTSTRAP_STATUS_CLOSED', 'Bootstrap status transport closed during its original write.'));
  const listen = () => {
    if (listening) return;
    listening = true; on.call(stream, 'error', remember); on.call(stream, 'close', closed);
  };
  const release = () => {
    if (pending.size) return;
    remove.call(stream, 'error', remember); remove.call(stream, 'close', closed); listening = false;
  };
  const state = { write: (text, checkout) => {
    if (failed) return Promise.reject(error());
    if (stream.destroyed || stream.writableEnded) {
      remember(failure('ERR_BOOTSTRAP_STATUS_CLOSED', 'Bootstrap status transport is unavailable before write admission.'));
      release(); return Promise.reject(error());
    }
    if (pending.size >= BOOTSTRAP_STATUS_OUTPUT_LIMITS.pending) {
      remember(failure('ERR_BOOTSTRAP_STATUS_LIMIT', 'Bootstrap status exhausted its finite pending-write allowance.'));
      return Promise.reject(error());
    }
    try { listen(); }
    catch (original) {
      remember(original); try { release(); } catch (cleanup) { remember(cleanup); }
      return Promise.reject(error());
    }
    const result = Promise.withResolvers(), entry = { reject: result.reject, callbackReceived: false, checkout };
    pending.add(entry); checkout?.pending.add(entry);
    const timer = setTimeout(() => remember(failure('ERR_BOOTSTRAP_STATUS_TIMEOUT', 'Bootstrap status write did not receive its original completion callback within 10 seconds.')),
      BOOTSTRAP_STATUS_OUTPUT_LIMITS.timeoutMs);
    const completed = original => {
      if (entry.callbackReceived) { remember(failure('ERR_BOOTSTRAP_STATUS_CALLBACK', 'Bootstrap status received a duplicate completion callback.')); return; }
      entry.callbackReceived = true; clearTimeout(timer);
      if (original !== undefined && original !== null) remember(original);
      // A real Writable may emit its error after calling the write callback.
      // Keep the one original listener through that turn, including concurrent
      // writes, and never close/end/destroy the caller's terminal transport.
      setImmediate(() => {
        pending.delete(entry);
        try { release(); } catch (cleanup) { remember(cleanup); checkout?.observations.remember(cleanup); }
        checkout?.pending.delete(entry);
        if (failed) result.reject(error()); else result.resolve();
      });
    };
    try {
      const accepted = write.call(stream, text, completed);
      if (accepted !== true && accepted !== false) remember(failure('ERR_BOOTSTRAP_STATUS_WRITE', 'Bootstrap status write returned an unknown transport result.'));
    } catch (original) { remember(original); }
    return result.promise;
  } };
  outputs.set(stream, state); return state;
};

const writeOriginalBytes = (bytes, stream, { root, session } = {}) => {
  try {
    if (session) requireCheckoutMutationSession(root, session);
    const output = captureOutput(stream);
    let original;
    if (session) {
      original = checkoutOutputs.get(session);
      if (!original) {
        original = { transports: new Set(), pending: new Set(), observations: createStorageObservationLedger() }; checkoutOutputs.set(session, original);
        retainCheckoutMutationPrerequisite(root, session, () => original.pending.size === 0 && original.observations.isSettled());
      }
      if (original.transports.size >= 16 && !original.transports.has(output)) throw failure('ERR_BOOTSTRAP_STATUS_LIMIT', 'Checkout status requires at most 16 original transports.');
      original.transports.add(output);
    }
    return session ? withCheckoutMutation(root, () => output.write(bytes, original), { session })
      : output.write(bytes);
  }
  catch (error) { return Promise.reject(error); }
};

/** Bounded human status only. Original callback/error observations feed the
 * existing task/root owners; accepted buffering alone is never completion. */
export const writeBootstrapStatus = (line, stream = process.stderr, context) => {
  if (typeof line !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(line) || Buffer.byteLength(line) + 1 > BOOTSTRAP_STATUS_OUTPUT_LIMITS.lineBytes) return Promise.reject(
    failure('ERR_BOOTSTRAP_STATUS_LINE', 'Bootstrap status line exceeds its finite byte allowance.'));
  return writeOriginalBytes(line + '\n', stream, context);
};

/** Preserve already bounded raw diagnostic bytes through the same transport
 * owner. Capture before asynchronous checkout admission; no status projection. */
export const writeBootstrapDiagnosticBytes = (bytes, stream, context) => {
  if (!Buffer.isBuffer(bytes) || bytes.length > BOOTSTRAP_STATUS_OUTPUT_LIMITS.lineBytes) return Promise.reject(
    failure('ERR_BOOTSTRAP_STATUS_BYTES', 'Bootstrap diagnostic writes require a bounded original byte buffer.'));
  return writeOriginalBytes(Buffer.from(bytes), stream, context);
};

/** Exact metadata/help/diagnostic text, chunked through the same callback owner.
 * No total-response truncation or control projection changes its wire bytes. */
export const writeBootstrapText = (text, stream, context) => {
  if (typeof text !== 'string') return Promise.reject(new TypeError('Bootstrap output requires original text.'));
  try {
    const { root, session } = context || {}, captured = Object.freeze({ root, session }), bytes = Buffer.from(text);
    if (session) requireCheckoutMutationSession(root, session);
    captureOutput(stream);
    const write = async () => {
      for (let offset = 0; offset < bytes.length; offset += BOOTSTRAP_STATUS_OUTPUT_LIMITS.lineBytes) {
        await writeBootstrapDiagnosticBytes(bytes.subarray(offset, offset + BOOTSTRAP_STATUS_OUTPUT_LIMITS.lineBytes), stream, captured);
      }
    };
    return session ? withCheckoutMutation(root, write, { session }) : write();
  } catch (error) { return Promise.reject(error); }
};
