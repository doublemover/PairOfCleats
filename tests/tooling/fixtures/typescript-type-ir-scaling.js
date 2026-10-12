#!/usr/bin/env node
// Bounded evidence harness, not a broad benchmark or performance acceptance gate.
// Run: node tests/tooling/fixtures/typescript-type-ir-scaling.js > receipt.json
// Each fixed case has its own process and an enforced 29-second parent timeout.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import {
  createTypeIrArena, classifyTypeIr, containsTypeIr, serializeTypeIr, TYPE_IR_DEFAULT_BUDGET
} from '../../../src/index/tooling/typescript/type-ir/index.js';

await requireBootstrap();
const widths = [64, 256, 1024, 4096];
const modes = ['repeated', 'distinct'];
const runtime = { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch };
const hash = value => createHash('sha256').update(value).digest('hex');
const memory = () => {
  const { rss, heapUsed, heapTotal, external, arrayBuffers } = process.memoryUsage();
  return { rss, heapUsed, heapTotal, external, arrayBuffers };
};
if (process.argv[2] === '--case') {
  const mode = process.argv[3];
  const width = Number(process.argv[4]);
  assert.ok(modes.includes(mode) && widths.includes(width), 'only the fixed bounded cases are supported');
  const options = { deadlineAtMs: performance.now() + 20000 };
  const result = { mode, width, denotation: `2^${width}`, denotationBasis: 'independent uniquely delimited binary positions; mathematical fact, not enumerated or computed exact count',
    runtime, limits: TYPE_IR_DEFAULT_BUDGET, processBefore: memory(), phases: {}, failures: [], status: 'running' };
  let arena;
  let phase;
  const measure = (name, action) => {
    phase = name;
    const before = memory();
    const started = performance.now();
    try { return action(); }
    finally { result.phases[name] = { elapsedMs: performance.now() - started, before, after: memory() }; }
  };
  try {
    let root;
    let input;
    measure('construct', () => {
      arena = createTypeIrArena({ contextKey: `scaling-v1:${mode}:${width}` });
      let factors;
      if (mode === 'repeated') {
        const binary = arena.union([arena.literal('0', options), arena.literal('1', options)], options);
        factors = Array(width).fill(binary);
        input = '0'.repeat(width);
      } else {
        factors = Array.from({ length: width }, (_, index) => arena.union([
          arena.literal(`${index}:a;`, options), arena.literal(`${index}:b;`, options)
        ], options));
        input = Array.from({ length: width }, (_, index) => `${index}:a;`).join('');
      }
      root = arena.concat(factors, options);
    });
    result.arena = arena.stats();
    result.queryInputUtf16Length = input.length;
    // Independent phases still run when another phase exhausts its own budget.
    // Every failure and its counters remain visible in the receipt.
    for (const [name, action] of [
      ['serialize', () => {
        const serialized = serializeTypeIr(arena, root, options);
        result.canonicalSerializedUtf8Bytes = Buffer.byteLength(serialized);
        result.serializedSha256 = hash(serialized);
      }],
      ['membership', () => {
        result.membership = containsTypeIr(arena, root, input, options);
        assert.equal(result.membership, true);
      }],
      ['classify', () => {
        const classification = classifyTypeIr(arena, root, options);
        assert.equal(classification.cardinality, 'many');
        result.cardinalityClass = classification.cardinality;
        result.witnesses = classification.witnesses.map(value => ({ utf16Length: value.length, sha256: hash(value) }));
      }]
    ]) {
      try { measure(name, action); } catch (error) {
        result.failures.push({ phase: name, code: error.code || null, name: error.name, message: error.message,
          reason: error.reason || null, operation: error.operation || null, details: error.details || null });
      }
    }
    result.status = result.failures.length ? 'failed' : 'complete';
    if (result.failures.length) process.exitCode = 1;
  } catch (error) {
    result.status = 'failed';
    result.failures.push({ phase, code: error.code || null, name: error.name, message: error.message,
      reason: error.reason || null, operation: error.operation || null, details: error.details || null });
    result.arena = arena?.stats() || null;
    process.exitCode = 1;
  }
  result.processAfter = memory();
  console.log(JSON.stringify(result));
} else {
  assert.equal(process.argv.length, 2, 'this evidence harness takes no user-configured workload');
  const files = ['arena', 'budget', 'queries', 'sequence', 'serialization'];
  const receipt = { schemaVersion: 1, generatedAt: new Date().toISOString(), runtime,
    purpose: 'bounded finite-string kernel scaling evidence',
    serializationWorkAccounting: 'exact escaped UTF-16 output length plus scan and traversal/sort work; conservative allocation admission retained',
    method: 'one fresh process per fixed case, no forced GC, default logical budgets, 20-second cooperative deadline, 29-second subprocess timeout',
    caveats: ['single samples, not a throughput benchmark', 'RSS and heap are process snapshots, not peaks or hard bounds',
      'construction creates the flat operand array once; arbitrary incremental insertion is not claimed linear',
      'membership input lengths are explicit; compressed-word doubling is covered separately by the compact fixture',
      '0/1/many classification does not compute the exact language cardinality'],
    sourceSha256: Object.fromEntries(files.map(name => [name + '.js', hash(readFileSync(
      new URL(`../../../src/index/tooling/typescript/type-ir/${name}.js`, import.meta.url)))])), cases: [] };
  for (const mode of modes) for (const width of widths) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--case', mode, String(width)], {
      encoding: 'utf8', timeout: 29000, maxBuffer: 1024 * 1024, windowsHide: true
    });
    let result;
    try { result = JSON.parse(child.stdout); } catch {
      result = { mode, width, status: 'failed', failure: { message: 'child did not emit a valid receipt',
        stdout: child.stdout, stderr: child.stderr, code: child.error?.code || null } };
    }
    result.processExit = { status: child.status, signal: child.signal, error: child.error?.message || null };
    receipt.cases.push(result);
  }
  receipt.complete = receipt.cases.every(result => result.status === 'complete' && result.processExit.status === 0);
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.complete) process.exitCode = 1;
}
