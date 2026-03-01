/**
 * Awaitable delay helper for retry/backoff flows.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
