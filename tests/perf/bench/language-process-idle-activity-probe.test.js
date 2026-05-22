#!/usr/bin/env node
import assert from 'node:assert/strict';

import { runIdleActivityProbeScenario } from './language-process-fixture.js';

const { captured, expectedOkMessage, label, probeCount, result } = await runIdleActivityProbeScenario({
  label: 'bench-idle-activity-probe',
  expectedOkMessage: 'expected active child CPU or RSS activity to suppress idle timeout',
  makeActivityProbe: (pid, nextProbeCount) => {
    const count = nextProbeCount();
    return {
      alive: true,
      pid,
      cpuMs: 100 + (count * 250),
      rssBytes: (64 + (count * 4)) * 1024 * 1024
    };
  }
});

assert.equal(result.ok, true, expectedOkMessage);
assert.ok(probeCount >= 2, 'expected idle watchdog to consult the activity probe');
assert.equal(
  captured.some((line) => line.includes(`[run] idle timeout: ${label}`)),
  false,
  'expected no idle-timeout warning for CPU-active child'
);

console.log('bench language process idle activity probe test passed');
