#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSummary } from '../run-reporting.js';

let output = '';
const consoleStream = {
  columns: 120,
  isTTY: false,
  write: (chunk) => {
    output += String(chunk || '');
    return true;
  }
};

const results = [
  {
    id: 'suite/a',
    status: 'skipped',
    skipReason: 'excluded tag: perf',
    durationMs: 3
  },
  {
    id: 'suite/b',
    status: 'skipped',
    skipReason: 'excluded tag: perf',
    durationMs: 2
  }
];

renderSummary({
  context: {
    consoleStream,
    useColor: false,
    outputIgnorePatterns: [],
    root: process.cwd(),
    laneLabel: 'tests',
    timeoutMs: 30_000
  },
  summary: {
    total: results.length,
    passed: 0,
    skipped: 2,
    failed: 0,
    timedOut: 0,
    durationMs: 5
  },
  results,
  runLogDir: null,
  border: '='.repeat(40),
  innerPadding: ''
});

assert.ok(
  output.includes('2 Skipped'),
  `expected summary line to include excluded-tag skips, got output:\n${output}`
);

console.log('summary skipped count includes excluded-tag skips test passed');
