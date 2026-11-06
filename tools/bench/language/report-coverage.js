import path from 'node:path';
import { benchRunProducerState } from '../../../src/contracts/bench-diagnostic-coverage.js';
export { BENCH_PARITY_OBSERVATION_VERSION } from '../../../src/contracts/bench-diagnostic-coverage.js';
const key = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const diagnosticSuffix = '.diagnostics.jsonl';
const sourceStem = file => file.endsWith(diagnosticSuffix) ? file.slice(0, -diagnosticSuffix.length) : file.slice(0, -4);

/** Reuse the one captured stream inventory/read pass. Expected task paths are
 * compared with admitted entries, never opened as new filesystem authority.
 */
const declarations = tasks => {
  const declared = new Map(); let producerIncompleteTasks = 0;
  for (const task of tasks) {
    const producer = task?.diagnostics?.process ?? task?.payload?.diagnostics?.process;
    if (!producer) continue;
    if (!Array.isArray(producer.streamPaths) || !producer.streamPaths.length || producer.streamPaths.length > 1024) { producerIncompleteTasks++; continue; }
    let incompleteProducer = producer.streamWrite?.schemaVersion !== 1 || producer.streamWrite.complete !== true
      || producer.streamWrite.initializedStreams !== producer.streamPaths.length
      || producer.streamWrite.writeFailures !== 0 || producer.streamWrite.flushFailures !== 0;
    for (const file of producer.streamPaths) {
      if (typeof file !== 'string' || !path.isAbsolute(file) || !file.endsWith(diagnosticSuffix)) { incompleteProducer = true; continue; }
      declared.set(key(file), file);
      const log = file.slice(0, -diagnosticSuffix.length) + '.log'; declared.set(key(log), log);
    }
    if (incompleteProducer) producerIncompleteTasks++;
  }
  return { declared, producerIncompleteTasks };
};
const selectLogs = (logFiles, declared) => logFiles.filter(file => !file.endsWith('-footer.log') || declared.has(key(file)));
export const selectBenchParityLogFiles = (logFiles, tasks) => selectLogs(logFiles, declarations(tasks).declared);

export const buildBenchParityCoverage = ({ tasks, logFiles, diagnosticFiles, diagnosticsStream, streamRead, streamProducerEvidence = null }) => {
  const { declared, producerIncompleteTasks } = declarations(tasks);
  const runProducerState = benchRunProducerState(streamProducerEvidence);
  // Canonical footer summaries are not independent raw-event sources. A caller
  // explicitly declaring such a path as its actual log still retains it.
  const logs = selectLogs(logFiles, declared);
  const observed = new Map([...logs, ...diagnosticFiles].map(file => [key(file), file]));
  const expected = new Map([...observed, ...declared]);
  const stems = new Map();
  for (const file of observed.values()) {
    const stem = key(sourceStem(file)); if (!stems.has(stem)) stems.set(stem, { log: false, diagnostics: false });
    stems.get(stem)[file.endsWith(diagnosticSuffix) ? 'diagnostics' : 'log'] = true;
  }
  const missing = [...expected].filter(([id]) => !observed.has(id)).map(([, file]) => file).sort();
  const unpaired = [...stems].filter(([, pair]) => !pair.log || !pair.diagnostics).map(([stem]) => stem).sort();
  const readPaths = new Set(streamRead.files.filter(file => !file.incomplete && file.bytesRead === file.capturedBytes).map(file => key(file.path)));
  const unread = [...observed.keys()].filter(file => !readPaths.has(file));
  const malformedDiagnosticLines = diagnosticsStream.malformedLines;
  const unknownDiagnosticEvents = diagnosticsStream.unknownTypeCount;
  const incompleteStreams = new Set([...streamRead.files.filter(file => file.incomplete).map(file => key(file.path)), ...unread]).size;
  const inventoryErrors = streamRead.errors.length;
  const pairedSources = [...stems.values()].filter(pair => pair.log && pair.diagnostics).length;
  const unobserved = observed.size === 0;
  const complete = !unobserved && pairedSources > 0 && !missing.length && !unpaired.length && !malformedDiagnosticLines
    && !unknownDiagnosticEvents && !incompleteStreams && !inventoryErrors && !producerIncompleteTasks && runProducerState !== 'incomplete';
  return { schemaVersion: 1, state: complete ? 'complete' : unobserved ? 'unobserved' : 'incomplete',
    expectedSourcePolicy: 'captured-log-diagnostic-pairs-and-declared-process-paths-v1',
    logStreams: logs.length, diagnosticStreams: diagnosticFiles.length, pairedSources,
    expectedStreams: expected.size, observedStreams: observed.size, missingStreams: missing.length,
    unpairedSources: unpaired.length, malformedDiagnosticLines, unknownDiagnosticEvents, incompleteStreams,
    inventoryErrors, producerIncompleteTasks, runProducerState, missingSamples: missing.slice(0, 8), missingSamplesOmitted: Math.max(0, missing.length - 8),
    unpairedSamples: unpaired.slice(0, 8), unpairedSamplesOmitted: Math.max(0, unpaired.length - 8) };
};
