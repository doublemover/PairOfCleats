import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { withBenchParitySources } from '../../helpers/bench-parity-sources.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { createProcessRunner } from '../../../tools/bench/language/process.js';
import { validateBenchComparisonInput } from '../../../src/contracts/bench-comparison-input.js';
import { BENCH_PARITY_OBSERVATION_VERSION } from '../../../src/contracts/bench-diagnostic-coverage.js';

ensureTestingEnv(process.env);
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/reports/bench-parity-input-observation/')[1];
assert.ok(['missing-is-unobserved', 'quiet-pair-is-observed', 'malformed-and-invalid-utf8', 'declared-source-remains-unread',
  'real-quiet-producer', 'real-producer-write-failure', 'run-retains-earlier-write-failure', 'footer-summary-is-not-event-source'].includes(mode));
const task = () => ({ language: 'javascript', tier: 'small', repo: 'fixture/source', summary: { backends: ['memory'],
  latencyMsAvg: { memory: 0 }, hitRate: { memory: 1 }, resultCountAvg: { memory: 1 }, memoryRss: { memory: { mean: 1024 } }, buildMs: { index: 0 } } });
await withBenchParitySources(async source => {
  const make = (rows, streamProducerEvidence = null) => buildReportOutput({ configPath: 'fixture-only.json', cacheRoot: null, resultsRoot: source.root,
    results: rows ?? [task()], config: { javascript: { label: 'JavaScript' } }, streamProducerEvidence });
  if (mode === 'missing-is-unobserved') {
    const output = await make();
    assert.equal(output.diagnostics.parity.status, 'error'); assert.equal(output.diagnostics.parity.mismatchCount, 0);
    assert.equal(output.diagnostics.parity.coverage.state, 'unobserved'); assert.equal(output.diagnostics.parity.coverage.observedStreams, 0);
    assert.equal(validateBenchComparisonInput(output).ok, false, 'zero events in absent files are not healthy evidence');
  } else if (mode === 'quiet-pair-is-observed') {
    await source.writeQuiet(); const output = await make(), parity = output.diagnostics.parity;
    assert.equal(parity.schemaVersion, BENCH_PARITY_OBSERVATION_VERSION); assert.equal(parity.status, 'ok'); assert.equal(parity.coverage.state, 'complete');
    assert.equal(parity.coverage.runProducerState, 'not-supplied', 'raw captured inputs do not imply a run-wide producer observation');
    assert.equal(parity.coverage.pairedSources, 1); assert.equal(parity.coverage.observedStreams, 2);
    assert.equal(parity.mismatchCount, 0); assert.equal(output.diagnostics.stream.eventCount, 0);
    assert.equal(output.diagnostics.streamRead.metrics.fileOpens, 2, 'coverage does not scan/read a second inventory');
    assert.equal(validateBenchComparisonInput(output).ok, true); assert.equal(output.overallSummary.buildMs.index, 0);
  } else if (mode === 'malformed-and-invalid-utf8') {
    await source.writeQuiet();
    await fs.writeFile(source.diagnosticPath, '{}\nnot-json\n{"eventType":"unregistered-type"}\n');
    let output = await make(), coverage = output.diagnostics.parity.coverage;
    assert.equal(output.diagnostics.parity.status, 'error'); assert.equal(output.diagnostics.parity.mismatchCount, 0);
    assert.equal(coverage.malformedDiagnosticLines, 2); assert.equal(coverage.unknownDiagnosticEvents, 1);
    assert.equal(output.diagnostics.stream.incomplete, true); assert.equal(output.diagnostics.stream.files[0].malformedLines, 2);
    assert.equal(validateBenchComparisonInput(output).ok, false);
    await fs.writeFile(source.diagnosticPath, Buffer.from([0xff, 10])); output = await make(); coverage = output.diagnostics.parity.coverage;
    assert.equal(coverage.incompleteStreams, 1, 'one bad stream is counted once'); assert.equal(output.diagnostics.parity.status, 'error');
    assert.equal(output.diagnostics.streamRead.files.find(row => row.path === source.diagnosticPath).reason, 'ERR_ENCODING_INVALID_ENCODED_DATA');
  } else if (mode === 'footer-summary-is-not-event-source') {
    await source.writeQuiet(); await fs.writeFile(path.join(source.logsRoot, 'run-fixture-footer.log'), 'using fallback parser\n');
    const output = await make(); assert.equal(output.diagnostics.parity.status, 'ok');
    assert.equal(output.diagnostics.parity.aggregateLogEventCount, 0); assert.equal(output.diagnostics.parity.coverage.logStreams, 1);
    assert.equal(output.diagnostics.streamRead.metrics.fileOpens, 3, 'other reducers retain their original file observation');
  } else if (mode === 'declared-source-remains-unread') {
    await fs.writeFile(source.logPath, 'Quiet fixture\n'); let output = await make();
    assert.equal(output.diagnostics.parity.coverage.unpairedSources, 1); assert.equal(output.diagnostics.parity.status, 'error');
    await source.writeQuiet(); const external = path.join(source.root, 'not-in-report-inventory.diagnostics.jsonl');
    const bytes = Buffer.from('out-of-scope source must not be opened by metadata selection'); await fs.writeFile(external, bytes);
    const row = task(); row.diagnostics = { process: { streamPaths: [external], streamWrite: { schemaVersion: 1, initializedStreams: 1,
      complete: true, writeFailures: 0, flushFailures: 0 } } };
    output = await make([row]);
    assert.equal(output.diagnostics.parity.coverage.missingStreams, 2); assert.equal(output.diagnostics.parity.status, 'error');
    assert.equal(output.diagnostics.streamRead.metrics.fileOpens, 2); assert.deepEqual(await fs.readFile(external), bytes);
  } else {
    await fs.writeFile(source.logPath, '');
    if (mode !== 'real-quiet-producer') await fs.mkdir(source.diagnosticPath);
    const lines = [], append = line => { lines.push(String(line)); fsSync.appendFileSync(source.logPath, String(line) + '\n'); };
    const runner = createProcessRunner({ appendLog: append, writeLog: append, writeLogSync: append,
      logHistory: lines, logPath: source.logPath, getLogPaths: () => [source.logPath] });
    const before = runner.getDiagnosticProducerCoverage();
    assert.equal(before.executionCount, 0); assert.equal(before.complete, false); assert.equal(Object.isFrozen(before), true);
    let completed = await runner.runProcess('quiet-fixture', process.execPath, ['-e', 'process.stdout.write("quiet fixture\\n")'],
      { continueOnError: true, timeoutMs: 5000 });
    assert.equal(completed.ok, true, 'diagnostic delivery cannot replace actual child success');
    if (mode === 'run-retains-earlier-write-failure') {
      assert.equal(completed.diagnostics.streamWrite.complete, false);
      assert.ok(lines.some(line => line.includes('telemetry stream write failures')), 'expected failed first-delivery warning is retained');
      // A separate, successful command is not a retry or proof of first delivery.
      await fs.rmdir(source.diagnosticPath);
      completed = await runner.runProcess('second-quiet-fixture', process.execPath, ['-e', 'process.stdout.write("second quiet fixture\\n")'],
        { continueOnError: true, timeoutMs: 5000 });
      assert.equal(completed.ok, true); assert.equal(completed.diagnostics.streamWrite.complete, true);
    }
    const row = task(); row.diagnostics = { process: completed.diagnostics };
    const producer = runner.getDiagnosticProducerCoverage(), output = await make([row], producer);
    assert.equal(producer.unconfirmedFlushes, 0); assert.equal(producer.observationId, before.observationId);
    assert.equal(before.executionCount, 0, 'prior snapshots remain immutable observations');
    assert.deepEqual(output.diagnostics.streamProducer, producer);
    if (mode === 'real-quiet-producer') {
      assert.equal(producer.complete, true); assert.equal(producer.executionCount, 1);
      assert.equal(completed.diagnostics.streamWrite.complete, true); assert.equal(completed.diagnostics.streamWrite.initializedStreams, 1);
      assert.equal((await fs.stat(source.diagnosticPath)).size, 0, 'quiet producer creates an observed empty stream');
      assert.equal(output.diagnostics.parity.status, 'ok'); assert.equal(validateBenchComparisonInput(output).ok, true);
      assert.equal(output.diagnostics.parity.coverage.runProducerState, 'complete');
    } else if (mode === 'run-retains-earlier-write-failure') {
      assert.equal(producer.executionCount, 2); assert.ok(producer.writeFailures > 0); assert.equal(producer.complete, false);
      assert.equal(output.diagnostics.parity.coverage.producerIncompleteTasks, 0, 'the final command really completed delivery');
      assert.equal(output.diagnostics.parity.coverage.runProducerState, 'incomplete');
      assert.equal(output.diagnostics.parity.coverage.pairedSources, 1);
      assert.equal(output.diagnostics.parity.status, 'error'); assert.equal(validateBenchComparisonInput(output).ok, false);
    } else {
      assert.equal(completed.diagnostics.streamWrite.complete, false); assert.ok(completed.diagnostics.streamWrite.writeFailures > 0);
      assert.ok(lines.some(line => line.includes('telemetry stream write failures')), 'the expected negative-case warning remains visible');
      assert.equal(output.diagnostics.parity.coverage.producerIncompleteTasks, 1); assert.equal(output.diagnostics.parity.status, 'error');
      assert.equal(validateBenchComparisonInput(output).ok, false);
    }
  }
});
console.log('Observed quiet streams retain missing, malformed, out-of-scope and earlier failed delivery evidence.');
