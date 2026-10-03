#!/usr/bin/env node
import assert from 'node:assert/strict';

import { runIdleActivityProbeScenario } from './language-process-fixture.js';

const { captured, expectedOkMessage, label, probeCount, result } = await runIdleActivityProbeScenario({
  label: 'bench-idle-activity-probe-async',
  expectedOkMessage: 'expected async activity probe to suppress idle timeout',
  makeActivityProbe: async (pid, nextProbeCount) => {
    const count = nextProbeCount();
    await new Promise((resolve) => setTimeout(resolve, 5));
    return {
      alive: true,
      pid,
      cpuMs: 100 + (count * 250),
      rssBytes: (64 + (count * 4)) * 1024 * 1024
    };
  }
});

assert.equal(result.ok, true, expectedOkMessage);
assert.ok(probeCount >= 2, 'expected idle watchdog to consult the async activity probe');
assert.equal(
  captured.some((line) => line.includes(`[run] idle timeout: ${label}`)),
  false,
  'expected no idle-timeout warning for async CPU-active child'
);

console.log('bench language process idle activity probe async test passed');
