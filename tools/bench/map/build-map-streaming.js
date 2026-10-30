#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import { performance } from 'node:perf_hooks';
const { buildCodeMap } = await import('../../../src/map/build-map.js');
const { buildIndexSignature } = await import('../../../src/retrieval/index-cache.js');
const { isDirectExecution } = await import('../../../src/shared/direct-execution.js');
const { stableStringify } = await import('../../../src/shared/stable-json.js');
const { createMapBenchCli, resolveMapBenchInputs, resolveRuns } = await import('./shared.js');
const { runMapSerializationExperiment } = await import('./experiment.js');

export const runBuildMapStreamingBenchCli = async () => {
  const argv = createMapBenchCli({ scriptName: 'bench-map-streaming', options: {
    runs: { type: 'number', default: 3 }, out: { type: 'string', describe: 'Parent directory for exclusively owned disposable fixtures' },
    json: { type: 'boolean', default: false }
  } });
  const { repoRoot, indexDir, buildOptions } = resolveMapBenchInputs(argv), runs = resolveRuns(argv.runs, 3);
  const selectedSource = await buildIndexSignature(indexDir), started = performance.now();
  const model = await buildCodeMap({ repoRoot, indexDir, options: buildOptions });
  const modelBuildMs = performance.now() - started;
  if (stableStringify(await buildIndexSignature(indexDir)) !== stableStringify(selectedSource)) throw new Error('Map source changed while preparing the workload.');
  const report = await runMapSerializationExperiment({ model, outputParent: argv.out, runs,
    source: { repoRoot, indexDir, selectedSource, requestedOptions: buildOptions, modelBuildMs } });
  if (argv.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.error('Map JSON serialization of an already materialized map');
    console.error(`- ${report.workload.serializedBytes} input bytes; ${report.workload.counts.files} files; ${report.workload.counts.members} members; ${report.workload.counts.edges} edges`);
    console.error(`- declared truncation: ${report.workload.truncated}; model build ${modelBuildMs.toFixed(2)} ms`);
    for (const arm of ['baseline', 'streaming']) {
      console.error(`- ${arm}: mean ${report[arm].timings.mean.toFixed(2)} ms; ${report[arm].completedOperations} completed atomic publications`);
      for (const sample of report[arm].samples) console.error(`  child lifetime RSS high-water: ${sample.memory.processLifetimeRss.bytes ?? 'unavailable'} bytes; boundary heap maximum: ${sample.memory.observedBoundaryMax.heapUsed ?? 'unavailable'} bytes`);
    }
  }
  return report;
};
if (isDirectExecution(import.meta.url)) runBuildMapStreamingBenchCli().catch(error => {
  console.error(error?.stack || error);
  if (error?.fixtureRoot) console.error(`[map-benchmark] retained fixture: ${error.fixtureRoot}`);
  process.exitCode = 1;
});
