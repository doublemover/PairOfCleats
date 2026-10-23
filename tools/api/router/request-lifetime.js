import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';

/** Own the complete HTTP lifetime, including body and repository preparation.
 * @template T
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {(lifetime: {signal: AbortSignal, closed: () => boolean,
 * closedAfterFailure: (error: unknown) => boolean,
 * prepare: (work: Promise<unknown> | (() => Promise<unknown>)) => Promise<unknown>}) => Promise<T>} operation
 * @returns {Promise<T | true>}
 */
export const withHttpRequestLifetime = async (req, res, operation) => {
  const controller = new AbortController();
  const abort = () => controller.abort(createError(ERROR_CODES.CANCELLED, 'Request cancelled.'));
  const closed = () => controller.signal.aborted || req.aborted || res.destroyed || res.writableEnded;
  const closedAfterFailure = error => {
    // A disconnected client removes response delivery, never the original
    // operation's unsettled descriptor or recovery-session ownership.
    observeStorageResource(error, { phase: 'http-request-lifetime' }).requireSettled();
    return closed();
  };
  req.on('aborted', abort);
  req.on('error', abort);
  res.on('close', abort);
  res.on('error', abort);
  if (closed()) abort();
  try {
    if (closed()) return true;
    return await operation({ signal: controller.signal, closed, closedAfterFailure,
      prepare: async work => {
        // New call sites pass a lazy function so cancelled preparation never
        // starts. An already-started promise must still settle before return.
        if (typeof work === 'function') controller.signal.throwIfAborted();
        const result = await (typeof work === 'function' ? work() : work);
        if (closed()) abort();
        controller.signal.throwIfAborted();
        return result;
      } });
  } catch (error) {
    if (closedAfterFailure(error)) return true;
    throw error;
  } finally {
    req.off('aborted', abort);
    req.off('error', abort);
    res.off('close', abort);
    res.off('error', abort);
  }
};
