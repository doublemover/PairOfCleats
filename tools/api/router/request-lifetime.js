import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';

/** Own the complete HTTP lifetime, including body and repository preparation. */
export const withHttpRequestLifetime = async (req, res, operation) => {
  const controller = new AbortController();
  const abort = () => controller.abort(createError(ERROR_CODES.CANCELLED, 'Request cancelled.'));
  const closed = () => controller.signal.aborted || req.aborted || res.destroyed || res.writableEnded;
  req.on('aborted', abort);
  res.on('close', abort);
  res.on('error', abort);
  if (closed()) abort();
  try {
    if (closed()) return true;
    return await operation({ signal: controller.signal, closed,
      prepare: async work => {
        controller.signal.throwIfAborted();
        const result = await work;
        if (closed()) abort();
        controller.signal.throwIfAborted();
        return result;
      } });
  } catch (error) {
    if (controller.signal.aborted) return true;
    throw error;
  } finally {
    req.off('aborted', abort);
    res.off('close', abort);
    res.off('error', abort);
  }
};
