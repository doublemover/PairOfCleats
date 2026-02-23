/**
 * Build the execute-search payload consumed by `executeSearchAndEmit`.
 *
 * Centralizing this large object assembly keeps `plan-runner` focused on
 * orchestration and enables isolated tests for payload wiring.
 *
 * @param {object} input
 * @returns {object}
 */
export const buildRunSearchExecutionInput = (input) => ({ ...input });
