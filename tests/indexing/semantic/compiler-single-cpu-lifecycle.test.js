import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPublishedSemanticWitness } from '../../helpers/published-semantic-witness.js';
import { resolveSemanticPartPath } from '../../../src/semantic/artifact-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-compiler-single-cpu-'));
const controller = new AbortController();
// Keep the stalled admission alive long enough to expose the ownership error,
// then cancel through the real pipeline within the runner's 30-second bound.
const timer = setTimeout(() => controller.abort(Object.assign(new Error('Single-CPU compiler publication did not settle'),
  { code: 'ERR_SINGLE_CPU_COMPILER_DEADLINE' })), 20000);
try {
  const fixture = await createPublishedSemanticWitness({ root, threads: 1, abortSignal: controller.signal });
  assert.equal(controller.signal.aborted, false);
  const admissionSummary = [];
  if (!fixture.manifest.contexts.length) {
    for (const admission of fixture.manifest.compilerAdmissions || []) {
      const filename = await resolveSemanticPartPath(path.join(fixture.indexDir, 'semantic'), admission.decisionRef);
      const decision = JSON.parse(await fs.readFile(filename, 'utf8'));
      admissionSummary.push({ admitted: decision.admitted, reason: decision.reason,
        closure: decision.closure, reservation: decision.reservation, request: decision.request });
    }
  }
  assert.ok(fixture.manifest.contexts.length > 0,
    'the real TypeScript Program supplies compiler context: ' + JSON.stringify(admissionSummary));
  assert.ok(fixture.manifest.completedTasks.length > 0, 'admitted compiler work publishes completion receipts');
  assert.ok(fixture.records.some(row => row.kind === 'binding'), 'the compiler emits actual pinned binding facts');
  const expectedSources = new Set([...fixture.sources.values()]
    .filter(source => source.language === 'typescript').map(source => source.sourceUnitId));
  assert.equal(expectedSources.size, 2);
  const completedSources = new Set();
  for (const partition of fixture.manifest.partitions) {
    for await (const row of fixture.store.iterateRows(partition.partitionId, 'semantic_coverage')) {
      if (row.phase === 'bindings' && ['complete', 'partial'].includes(row.state) && row.completedCount > 0) {
        completedSources.add(row.scope.sourceUnitId);
      }
    }
  }
  assert.deepEqual(completedSources, expectedSources,
    'both TypeScript sources retain real completed binding work under their declared coverage with one CPU token');
  console.log('Single-CPU semantic admission completes real compiler work and durable publication');
} finally {
  clearTimeout(timer);
  await fs.rm(root, { recursive: true, force: true });
}
