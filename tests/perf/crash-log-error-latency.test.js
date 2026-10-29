import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createCrashLogger, readCrashEvidenceState } from '../../src/index/build/crash-log.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('perf/crash-log-error-latency/')[1];
assert.ok(['small-log', 'long-log'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`crash-log-error-latency-${selected}`);
const warmups = 3, sampleCount = 20;
const logBytes = selected === 'long-log' ? 2 * 1024 * 1024 : 0;
const syncP95LimitMs = 250, settledP95LimitMs = 1000;
const warnings = [], warn = console.warn, samples = [];
console.warn = (...values) => warnings.push(values.join(' '));
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const tail = async file => {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    const bytes = Buffer.alloc(Math.min(stat.size, 16 * 1024));
    const result = await handle.read(bytes, 0, bytes.length, stat.size - bytes.length);
    return bytes.subarray(0, result.bytesRead).toString('utf8');
  } finally { await handle.close(); }
};
try {
  for (let index = -warmups; index < sampleCount; index++) {
    const message = `original latency failure ${selected} ${index}`;
    const secret = 'private-latency-credential';
    const error = Object.freeze(Object.assign(new Error(`${message} token=${secret}`), { code: 'LATENCY_ORIGINAL' }));
    const logger = await createCrashLogger({ repoCacheRoot: dir, enabled: true,
      buildId: 'serial-latency', attemptId: selected, mode: 'code' });
    let evidence, syncMs, settledMs;
    const files = [path.join(dir, 'logs', 'index-crash.log'), logger.paths.logPath];
    assert.equal(new Set(files).size, 2, 'measure both independent append sinks');
    const identities = new Map();
    try {
      await logger.flush();
      for (const file of files) {
        if (logBytes) await fs.appendFile(file, Buffer.alloc(logBytes, 'x'));
        identities.set(file, await fs.stat(file, { bigint: true }));
      }
      logger.updatePhase(`before-${index}`);
      await logger.flush();
      const started = performance.now();
      evidence = logger.logError(error);
      syncMs = performance.now() - started;
      await logger.flush();
      settledMs = performance.now() - started;
      assert.equal(evidence.written, true);
      logger.updatePhase(`after-${index}`);
    } finally { await logger.close(); }
    const state = await readCrashEvidenceState(logger.paths);
    assert.equal(state.phase, 'error');
    assert.equal(state.error.code, 'LATENCY_ORIGINAL');
    assert.ok(state.error.message.includes(message));
    assert.ok(!JSON.stringify(state).includes(secret));
    const terminalBytes = await fs.readFile(evidence.evidencePath);
    assert.equal(JSON.parse(terminalBytes).error.code, 'LATENCY_ORIGINAL');
    for (const file of files) {
      const after = await fs.stat(file, { bigint: true }), before = identities.get(file);
      assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino);
      const text = await tail(file);
      const admitted = [`phase before-${index}`, message, `phase after-${index}`].map(value => text.indexOf(value));
      assert.ok(admitted.every(offset => offset >= 0), 'every sample must retain all original positive witnesses');
      assert.ok(admitted[0] < admitted[1] && admitted[1] < admitted[2]);
      assert.ok(!text.includes(secret));
      // This private fixture reuses only fully closed files, keeping disk use
      // independent of sample count; no live descriptor or author cache is reset.
      if (index !== sampleCount - 1) await fs.truncate(file, 0);
    }
    if (index >= 0) samples.push({ syncMs, settledMs,
      terminalSha256: createHash('sha256').update(terminalBytes).digest('hex') });
  }
  assert.deepEqual(warnings, []);
  const syncP95Ms = percentile(samples.map(sample => sample.syncMs), 0.95);
  const settledP95Ms = percentile(samples.map(sample => sample.settledMs), 0.95);
  console.log(JSON.stringify({ measurement: 'serial-crash-log-error-ms', selected,
    node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch,
    warmups, sampleCount, logBytesPerSink: logBytes, appendSinks: 2, samples,
    syncP95Ms, settledP95Ms, syncP95LimitMs, settledP95LimitMs,
    scope: 'warm local-filesystem terminal persistence; excludes logger construction and forensic bundle export' }));
  assert.ok(syncP95Ms <= syncP95LimitMs, `synchronous error p95 ${syncP95Ms}ms exceeds ${syncP95LimitMs}ms`);
  assert.ok(settledP95Ms <= settledP95LimitMs, `settled error p95 ${settledP95Ms}ms exceeds ${settledP95LimitMs}ms`);
} finally { console.warn = warn; }
console.log(`Serial crash-log ${selected} latency and original terminal/append witnesses passed`);
