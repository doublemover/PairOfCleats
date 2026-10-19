import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPublishedSemanticWitness } from '../../helpers/published-semantic-witness.js';
import { resolveSemanticPartPath } from '../../../src/semantic/artifact-store.js';
import { DEFAULT_COMPILER_ADMISSION_POLICY } from '../../../src/index/semantic/compiler-admission.js';
import { readRuntimeReceipt } from '../../../src/shared/runtime-envelope/read-receipt.js';
import { readEffectiveMemory } from '../../../src/shared/effective-memory.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-compiler-single-cpu-'));
const controller = new AbortController();
// Keep the stalled admission alive long enough to expose the ownership error,
// then cancel through the real pipeline within the runner's 30-second bound.
const timer = setTimeout(() => controller.abort(Object.assign(new Error('Single-CPU compiler publication did not settle'),
  { code: 'ERR_SINGLE_CPU_COMPILER_DEADLINE' })), 20000);
try {
  const memoryBefore = readEffectiveMemory();
  // CPU ownership needs real cross-source compiler work. Full Node/SSR graph
  // semantics remain in the dedicated witnesses; keep the 512 MiB product policy.
  const fixture = await createPublishedSemanticWitness({ root, threads: 1, abortSignal: controller.signal,
    sourceFiles: {
      'snapshot.ts': 'export function double(value: number) { return value * 2; }\n',
      'host.ts': "import {double} from './snapshot.js';\nexport const answer = double(21);\n"
    },
    compilerOptions: { types: [], lib: ['ES5'] },
    compilerAdmission: DEFAULT_COMPILER_ADMISSION_POLICY, extraEnv: {
      PAIROFCLEATS_SCHEDULER_CPU: 1, PAIROFCLEATS_SCHEDULER_MAX_CPU: 1,
      PAIROFCLEATS_SCHEDULER_MEM: 1, PAIROFCLEATS_SCHEDULER_MAX_MEM: 1
    } });
  assert.equal(controller.signal.aborted, false);
  const runtime = await readRuntimeReceipt({ buildRoot: path.dirname(fixture.indexDir), requireProducerIdentity: true });
  assert.equal(runtime.evidence, 'persisted-runtime-receipt');
  const completed = runtime.attempts.filter(attempt => attempt.lifecycle === 'succeeded');
  assert.ok(completed.length > 0, 'the real runtime durably records successful scheduler ownership');
  for (const attempt of completed) {
    const scheduler = attempt.runtime.scheduler;
    assert.equal(scheduler.tokens.cpu.total, 1);
    assert.equal(scheduler.tokens.mem.total, 1);
    assert.equal(scheduler.adaptive.max.cpu, 1);
    assert.equal(scheduler.adaptive.max.mem, 1);
    assert.equal(scheduler.adaptive.enabled, true, 'normal adaptive admission remains enabled');
  }
  const admissionSummary = [];
  for (const admission of fixture.manifest.compilerAdmissions || []) {
    const filename = await resolveSemanticPartPath(path.join(fixture.indexDir, 'semantic'), admission.decisionRef);
    const decision = JSON.parse(await fs.readFile(filename, 'utf8'));
    assert.ok(admission.receiptRef, 'admitted compiler work retains its actual execution measurement');
    const receiptPath = await resolveSemanticPartPath(path.join(fixture.indexDir, 'semantic'), admission.receiptRef);
    const measurement = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    assert.equal(measurement.complete, true);
    assert.equal(measurement.inputHash, decision.inputHash);
    assert.ok(measurement.peakRssBytes > 0);
    admissionSummary.push({ admitted: decision.admitted, reason: decision.reason,
      closure: decision.closure, reservation: decision.reservation, request: decision.request, measurement });
  }
  console.log(JSON.stringify({ measurement: 'single-token-compiler-memory', memoryBefore,
    scheduler: completed.map(attempt => ({ maxInFlightBytes: attempt.runtime.scheduler.adaptive.maxInFlightBytes,
      memoryPerTokenMb: attempt.runtime.scheduler.adaptive.memoryPerTokenMb,
      cpu: attempt.runtime.scheduler.tokens.cpu.total, mem: attempt.runtime.scheduler.tokens.mem.total })),
    admissions: admissionSummary }));
  assert.ok(fixture.manifest.contexts.length > 0,
    'the real TypeScript Program supplies compiler context: ' + JSON.stringify(admissionSummary));
  assert.ok(admissionSummary.length > 0, 'actual durable decisions explain compiler admission');
  for (const decision of admissionSummary) {
    assert.equal(decision.admitted, true);
    assert.equal(decision.request.cpu, 1);
    assert.ok(decision.reservation.bytes <= DEFAULT_COMPILER_ADMISSION_POLICY.maxResidentBytes,
      'the CPU-ownership fixture must fit the canonical compiler reservation ceiling');
  }
  assert.ok(fixture.manifest.completedTasks.length > 0, 'admitted compiler work publishes completion receipts');
  assert.ok(fixture.records.some(row => row.kind === 'binding'), 'the compiler emits actual pinned binding facts');
  const expectedSources = new Set([...fixture.sources.values()]
    .filter(source => source.language === 'typescript').map(source => source.sourceUnitId));
  assert.equal(expectedSources.size, 2);
  const completedSources = new Set();
  let crossSourceCalls = 0;
  for (const partition of fixture.manifest.partitions) {
    for await (const row of fixture.store.iterateRows(partition.partitionId, 'semantic_coverage')) {
      if (row.phase === 'bindings' && ['complete', 'partial'].includes(row.state) && row.completedCount > 0) {
        completedSources.add(row.scope.sourceUnitId);
      }
    }
    for await (const edge of fixture.store.iterateRows(partition.partitionId, 'semantic_edges')) {
      if (edge.kind === 'callTarget' && fixture.sourceFor(edge.from)?.path === 'host.ts'
        && fixture.sourceFor(edge.to)?.path === 'snapshot.ts') crossSourceCalls += 1;
    }
  }
  assert.deepEqual(completedSources, expectedSources,
    'both TypeScript sources retain real completed binding work under their declared coverage with one CPU token');
  assert.ok(crossSourceCalls > 0, 'the checker resolves the imported call to its other source, rather than merely publishing an inventory');
  console.log('Single-CPU semantic admission completes real compiler work and durable publication');
} finally {
  clearTimeout(timer);
  await fs.rm(root, { recursive: true, force: true });
}
