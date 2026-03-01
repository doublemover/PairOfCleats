#!/usr/bin/env node
import { runNodeAsync } from '../../../tools/mcp/runner.js';

const controller = new AbortController();
const start = Date.now();
const abortAfterMs = 100;
const maxDurationMs = 2000;

const timer = setTimeout(() => {
  controller.abort();
}, abortAfterMs);

try {
  await runNodeAsync(process.cwd(), ['-e', 'setInterval(() => {}, 1000)'], {
    signal: controller.signal
  });
  throw new Error('Expected runNodeAsync to abort.');
} catch (err) {
  const elapsed = Date.now() - start;
  if (elapsed > maxDurationMs) {
    throw new Error(`Abort took too long (${elapsed}ms).`);
  }
  if (err?.name !== 'AbortError') {
    throw new Error(`Expected AbortError, got ${err?.name || 'unknown'}.`);
  }
} finally {
  clearTimeout(timer);
}

console.log('MCP runner abort kills child ok.');
