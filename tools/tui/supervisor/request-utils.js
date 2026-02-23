import path from 'node:path';
import { clampInt } from '../../../src/shared/limits.js';

/** @returns {string} */
export const nowIso = () => new Date().toISOString();

/**
 * Sleep for a bounded delay.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normalize mixed newline sequences to LF.
 *
 * @param {string} text
 * @returns {string}
 */
export const normalizeLineBreaks = (text) => String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

/**
 * Resolve execution command from either explicit command/args or CLI argv.
 *
 * @param {object} request
 * @param {{root:string}} input
 * @returns {{command:string,args:string[],cwd:string}}
 */
export const resolveRunRequest = (request, { root }) => {
  if (typeof request?.command === 'string' && request.command.trim()) {
    const command = request.command.trim();
    const args = Array.isArray(request?.args) ? request.args.map((entry) => String(entry)) : [];
    const cwd = request?.cwd ? path.resolve(String(request.cwd)) : process.cwd();
    return { command, args, cwd };
  }
  const argv = Array.isArray(request?.argv)
    ? request.argv.map((entry) => String(entry))
    : [];
  if (!argv.length) {
    throw new Error('job:run requires non-empty argv array.');
  }
  const cwd = request?.cwd ? path.resolve(String(request.cwd)) : process.cwd();
  const command = process.execPath;
  const args = [path.join(root, 'bin', 'pairofcleats.js'), ...argv];
  return { command, args, cwd };
};

/**
 * Normalize result capture policy from modern `resultPolicy` or legacy fields.
 *
 * @param {object} request
 * @returns {{captureStdout:'none'|'text'|'json',maxBytes:number}}
 */
export const resolveResultPolicy = (request) => {
  const fallbackPolicy = request && typeof request === 'object' ? request : {};
  const policy = request?.resultPolicy && typeof request.resultPolicy === 'object'
    ? request.resultPolicy
    : fallbackPolicy;
  const rawCaptureStdout = policy.captureStdout;
  const captureStdout = ['none', 'text', 'json'].includes(rawCaptureStdout)
    ? rawCaptureStdout
    : (rawCaptureStdout === true ? 'text' : 'none');
  const maxBytes = clampInt(policy.maxBytes, 1024, 64 * 1024 * 1024, 1_000_000);
  return { captureStdout, maxBytes };
};

/**
 * Resolve retry policy with defensive clamping for untrusted request values.
 *
 * @param {object} request
 * @returns {{maxAttempts:number,delayMs:number}}
 */
export const resolveRetryPolicy = (request) => {
  const retry = request?.retry && typeof request.retry === 'object' ? request.retry : {};
  return {
    maxAttempts: clampInt(retry.maxAttempts, 1, 5, 1),
    delayMs: clampInt(retry.delayMs, 0, 60_000, 0)
  };
};

/**
 * Parse subprocess stdout according to configured capture policy.
 *
 * `json` mode falls back to raw text when payload parsing fails.
 *
 * @param {string} stdoutText
 * @param {{captureStdout:'none'|'text'|'json'}} policy
 * @returns {object|string|null}
 */
export const parseResultFromStdout = (stdoutText, policy) => {
  if (policy.captureStdout === 'none') return null;
  const text = String(stdoutText || '').trim();
  if (!text) return null;
  if (policy.captureStdout === 'text') {
    return text;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
