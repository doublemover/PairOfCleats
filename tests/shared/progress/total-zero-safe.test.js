#!/usr/bin/env node
import assert from 'node:assert/strict';
import { configureLogger, showProgress } from '../../../src/shared/progress.js';

configureLogger({ enabled: false });

const writes = [];
const originalWrite = process.stderr.write.bind(process.stderr);
const originalIsTTY = process.stderr.isTTY;

process.stderr.write = (chunk) => {
  writes.push(String(chunk));
  return true;
};

try {
  try {
    Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
  } catch {}
  showProgress('Test', 0, 0);
} finally {
  process.stderr.write = originalWrite;
  try {
    Object.defineProperty(process.stderr, 'isTTY', { value: originalIsTTY, configurable: true });
  } catch {}
}

const output = writes.join('');
assert.ok(!output.includes('NaN'), `unexpected NaN in output: ${output}`);
assert.ok(!output.includes('Infinity'), `unexpected Infinity in output: ${output}`);

console.log('progress total zero safe test passed');
