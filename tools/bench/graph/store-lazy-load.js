#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const { isDirectExecution } = await import('../../../src/shared/direct-execution.js');
const { fileURLToPath } = await import('node:url');
const { spawnSubprocess } = await import('../../../src/shared/subprocess/runner.js');
const { stableStringify } = await import('../../../src/shared/stable-json.js');
const {
  normalizeCompareMode,
  parseGraphIndexBenchCli,
  printBaselineCurrentSummary,
  summarizeValues
} = await import('./shared.js');

const runWorker = async input => {
  const result = await spawnSubprocess(process.execPath, [fileURLToPath(new URL('./store-lazy-load-worker.js', import.meta.url)), JSON.stringify(input)], {
    timeoutMs: 30000, maxOutputBytes: 256 * 1024, outputEncoding: 'utf8', outputMode: 'string',
    captureStdout: true, captureStderr: true, rejectOnNonZeroExit: true, killTree: true
  });
  if (result.outputCapture?.stdout?.truncated || result.outputCapture?.stderr?.truncated || result.stderr?.trim()) {
    throw new Error('Graph-store sample emitted unexpected/truncated diagnostics.');
  }
  return { ...JSON.parse(result.stdout), childWallMs: result.durationMs };
};
const summarize = samples => {
  const cold = samples.map(value => value.coldTotalMs), warm = samples.map(value => value.warmHitMs);
  const totalMs = cold.reduce((sum, value) => sum + value, 0);
  return { iterations: samples.length, completedOperations: samples.length, totalMs,
    timingMs: summarizeValues(cold), throughput: totalMs > 0 ? samples.length / (totalMs / 1000) : 0,
    cold: { scope: 'manifest-signature-and-artifact-admission-build;excludes-process-startup', rawSampleDurationsMs: cold },
    warm: { scope: 'one-existing-index-cache-hit', rawSampleDurationsMs: warm, timingMs: summarizeValues(warm) }, samples };
};

export async function runGraphStoreBench({ indexDir, repoRoot, iterations, mode }, { sample = runWorker } = {}) {
  if (!Number.isSafeInteger(iterations) || iterations < 1) throw new RangeError('Positive integral graph-store sample count required.');
  const normalizedMode = normalizeCompareMode(mode);
  const samples = { baseline: [], current: [] }, order = [];
  let identity = null, baselineShape = null;
  for (let index = 0; index < iterations; index++) {
    const arms = normalizedMode === 'compare' ? index % 2 ? ['current', 'baseline'] : ['baseline', 'current'] : [normalizedMode];
    for (const arm of arms) {
      const observed = await sample({ indexDir, repoRoot, arm });
      order.push(arm);
      if (observed.state === 'unavailable') return { schemaVersion: 2, mode: normalizedMode, state: 'unavailable', reason: observed.reason, order, observed };
      if (observed.state !== 'observed' || observed.arm !== arm || observed.completedColdOperations !== 1 || observed.completedWarmOperations !== 1
        || observed.indexBuildsObserved !== 1 || !observed.witness?.occurrences || !observed.indexSignature
        || typeof observed.manifestIdentity !== 'string' || !/^[a-f0-9]{64}$/u.test(observed.manifestIdentity)
        || !Array.isArray(observed.artifactsUsed) || !observed.artifactsUsed.includes('symbol_edges')
        || arm === 'current' && (observed.artifactsUsed.length !== 1 || observed.artifactsUsed[0] !== 'symbol_edges')
        || observed.coldStats?.cache?.index?.hits !== 0 || observed.coldStats?.cache?.index?.builds !== 1
        || observed.warmStats?.cache?.index?.hits !== 1 || observed.warmStats?.cache?.index?.builds !== 1
        || [observed.setupMs, observed.admissionBuildMs, observed.coldTotalMs, observed.warmHitMs].some(value => !Number.isFinite(value) || value < 0)) {
        throw new Error('Graph-store sample lacks qualified phase/work evidence.');
      }
      const nextIdentity = stableStringify({ source: observed.indexSignature, manifest: observed.manifestIdentity,
        symbolBytes: observed.artifactBytes?.symbol_edges, task: observed.witness });
      if (identity !== null && identity !== nextIdentity) throw new Error('Graph-store samples changed selected source or symbol task.');
      if (arm === 'baseline') {
        const shape = stableStringify({ graph: observed.coldStats.lastBuild.graph, bytes: observed.artifactBytes });
        if (baselineShape !== null && baselineShape !== shape) throw new Error('Graph-store samples changed omitted relation workload.');
        baselineShape = shape;
      }
      identity = nextIdentity; samples[arm].push(observed);
    }
  }
  if (normalizedMode === 'compare' && !samples.baseline.every(value => value.omittedGraphNodes > 0
    && value.artifactsUsed.includes('graph_relations') && value.artifactBytes.graph_relations > 0)) {
    return { schemaVersion: 2, mode: normalizedMode, state: 'unavailable', reason: 'no-meaningful-omitted-relation-work', order, samples };
  }
  const results = {};
  for (const arm of ['baseline', 'current']) if (samples[arm].length) results[arm] = summarize(samples[arm]);
  return { schemaVersion: 2, mode: normalizedMode, state: normalizedMode === 'compare' ? 'qualified-inputs' : 'observed',
    comparison: 'eager-all-artifacts-versus-symbol-edge-only-admission-for-the-same-symbol-task',
    applicationCachePolicy: 'fresh-node-process-per-arm-per-sample', osCachePolicy: 'uncontrolled-shared-filesystem-cache',
    orderPolicy: 'serial-alternating-arms', order, ...results };
}

export async function runGraphStoreBenchCli(rawArgs = process.argv.slice(2)) {
  const { argv, repoRoot, indexDir } = parseGraphIndexBenchCli(rawArgs, {
    scriptName: 'graph-store-lazy-load',
    options: {
      iterations: { type: 'number', default: 3 },
      mode: { type: 'string', default: 'compare' }
    }
  });
  const iterations = argv.iterations;
  const mode = argv.mode || 'compare';

  const result = await runGraphStoreBench({ indexDir, repoRoot, iterations, mode });

  printBaselineCurrentSummary(result);

  console.log(JSON.stringify({ ok: true, result }, null, 2));
  return result;
}

if (isDirectExecution(import.meta.url)) {
  runGraphStoreBenchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
