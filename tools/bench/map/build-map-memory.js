#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const { isDirectExecution } = await import('../../../src/shared/direct-execution.js');
const { createMapBenchCli, resolveMapBenchInputs, resolveRuns } = await import('./shared.js');
const { runMapMemoryExperiment } = await import('./experiment.js');

export const runBuildMapMemoryBenchCli = async () => {
  const argv = createMapBenchCli({ scriptName: 'bench-map-memory', options: {
    runs: { type: 'number', default: 3 }, json: { type: 'boolean', default: false }
  } });
  const { repoRoot, indexDir, buildOptions } = resolveMapBenchInputs(argv);
  const report = await runMapMemoryExperiment({ repoRoot, indexDir, buildOptions, runs: resolveRuns(argv.runs, 3) });
  if (argv.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.error('Map build memory observations in fresh processes');
    for (const result of report.results) console.error(`- Run ${result.run}: ${result.elapsedMs.toFixed(2)} ms; final-inclusive build boundary heap maximum ${result.buildMetrics.observedBoundaryMax.heapUsed ?? 'unavailable'} bytes; child lifetime RSS high-water ${result.memory.processLifetimeRss.bytes ?? 'unavailable'} bytes`);
  }
  return report;
};
if (isDirectExecution(import.meta.url)) runBuildMapMemoryBenchCli().catch(error => {
  console.error(error?.stack || error); process.exitCode = 1;
});
