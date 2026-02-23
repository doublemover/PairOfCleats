#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  decayAdaptiveTokenTotals,
  resolveAdaptiveIntervalMs,
  resolveAdaptiveMemoryHeadroom,
  smoothAdaptiveValue
} from '../../../src/shared/concurrency/scheduler-core-token-policy.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

assert.equal(smoothAdaptiveValue(null, 0.8), 0.8);
assert.equal(smoothAdaptiveValue(0.2, 1, 0.5), 0.6);

assert.equal(
  resolveAdaptiveIntervalMs({
    adaptiveMinIntervalMs: 200,
    pendingPressure: true,
    bytePressure: false,
    starvationScore: 0,
    mostlyIdle: false
  }),
  100
);
assert.equal(
  resolveAdaptiveIntervalMs({
    adaptiveMinIntervalMs: 500,
    pendingPressure: false,
    bytePressure: false,
    starvationScore: 0,
    mostlyIdle: true
  }),
  1000
);
assert.equal(
  resolveAdaptiveIntervalMs({
    adaptiveMinIntervalMs: 375,
    pendingPressure: false,
    bytePressure: false,
    starvationScore: 0,
    mostlyIdle: false
  }),
  375
);

const lowHeadroom = resolveAdaptiveMemoryHeadroom({
  signals: {
    memory: {
      totalBytes: 4 * 1024 * 1024 * 1024,
      freeBytes: 512 * 1024 * 1024
    }
  },
  adaptiveMemoryReserveMb: 256,
  adaptiveMemoryPerTokenMb: 128,
  baselineMemLimit: 2,
  maxMemLimit: 32,
  currentMemTotal: 16,
  currentMemUsed: 3
});
assert.equal(lowHeadroom.memoryLowHeadroom, true);
assert.equal(lowHeadroom.memoryHighHeadroom, false);
assert.equal(lowHeadroom.memoryTokenHeadroomCap, 2);
assert.equal(lowHeadroom.nextMemTotal, 3);

const highHeadroom = resolveAdaptiveMemoryHeadroom({
  signals: {
    memory: {
      totalBytes: 4 * 1024 * 1024 * 1024,
      freeBytes: 3 * 1024 * 1024 * 1024
    }
  },
  adaptiveMemoryReserveMb: 256,
  adaptiveMemoryPerTokenMb: 128,
  baselineMemLimit: 2,
  maxMemLimit: 32,
  currentMemTotal: 12,
  currentMemUsed: 4
});
assert.equal(highHeadroom.memoryLowHeadroom, false);
assert.equal(highHeadroom.memoryHighHeadroom, true);
assert.equal(highHeadroom.memoryTokenHeadroomCap, 22);
assert.equal(highHeadroom.nextMemTotal, 12);

const tokens = {
  cpu: { total: 10, used: 4 },
  io: { total: 8, used: 1 },
  mem: { total: 12, used: 6 }
};
decayAdaptiveTokenTotals({
  tokens,
  cpuFloor: 2,
  ioFloor: 2,
  memFloor: 4,
  adaptiveStep: 3,
  memoryTokenHeadroomCap: 8
});
assert.equal(tokens.cpu.total, 7);
assert.equal(tokens.io.total, 5);
assert.equal(tokens.mem.total, 8);

const constrainedTokens = {
  cpu: { total: 2, used: 2 },
  io: { total: 2, used: 2 },
  mem: { total: 6, used: 6 }
};
decayAdaptiveTokenTotals({
  tokens: constrainedTokens,
  cpuFloor: 2,
  ioFloor: 2,
  memFloor: 4,
  adaptiveStep: 10,
  memoryTokenHeadroomCap: 5
});
assert.equal(constrainedTokens.cpu.total, 2);
assert.equal(constrainedTokens.io.total, 2);
assert.equal(constrainedTokens.mem.total, 6);

console.log('scheduler core token policy test passed');
