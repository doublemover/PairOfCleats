import { pathToFileURL } from 'node:url';
import {
  createRecordWriter, measureJsonRecord, protocolFailure, readRecords,
  resolveProtocolLimits, TYPESCRIPT_RUNTIME_PROTOCOL_VERSION
} from './protocol.js';
import { writeProviderResult } from './result.js';

export const readProviderRequest = async (stream, limits) => {
  let header = null, ended = false, targetsStarted = false;
  const documents = [], targets = [];
  for await (const record of readRecords(stream, limits, limits.maxInputBytes)) {
    if (ended) throw protocolFailure('request-after-end');
    if (!header) {
      if (record.type !== 'init' || record.version !== TYPESCRIPT_RUNTIME_PROTOCOL_VERSION
        || !record.context || typeof record.context.repoRoot !== 'string'
        || !Number.isSafeInteger(record.documents) || record.documents < 0
        || !Number.isSafeInteger(record.targets) || record.targets < 0
        || record.documents + record.targets + 2 > limits.maxRecords) throw protocolFailure('invalid-request-start');
      header = record;
    } else if (record.type === 'document') {
      if (targetsStarted || documents.length >= header.documents) throw protocolFailure('invalid-document-order');
      documents.push(record.value);
    } else if (record.type === 'target') {
      if (documents.length !== header.documents || targets.length >= header.targets) throw protocolFailure('invalid-target-order');
      targetsStarted = true; targets.push(record.value);
    } else if (record.type === 'end') {
      if (documents.length !== header.documents || targets.length !== header.targets) throw protocolFailure('request-count-mismatch');
      ended = true;
    } else throw protocolFailure('unknown-request-record');
  }
  if (!ended) throw protocolFailure('missing-request-end');
  return { context: header.context, inputs: { documents, targets } };
};

export const runTypeScriptRuntimeEntry = async ({ input = process.stdin, output = process.stdout, limits } = {}) => {
  limits = resolveProtocolLimits(limits);
  const write = createRecordWriter(output, limits, limits.maxOutputBytes);
  let logBytes = 0, logCount = 0, droppedLogs = 0;
  const flushLogs = async () => {
    if (droppedLogs) {
      await write({ type: 'log', value: {
        level: 'warn', message: `[tooling] TypeScript subprocess omitted ${droppedLogs} telemetry records at its bounded log queue.`
      } });
      droppedLogs = 0;
    }
  };
  try {
    const { context, inputs } = await readProviderRequest(input, limits);
    // Admit synchronous phase telemetry immediately so a hung checker does not
    // hide its last phase. Pending writes and cumulative telemetry are bounded;
    // only logs can be omitted, with an explicit count at the next safe boundary.
    const logger = value => {
      const record = { type: 'log', value };
      try {
        const bytes = measureJsonRecord(record, limits);
        if (logBytes + bytes > 65536 || logCount >= 256 || !write.tryWrite(record, 65536)) { droppedLogs += 1; return; }
        logBytes += bytes; logCount += 1;
      } catch { droppedLogs += 1; }
    };
    const { createTypeScriptProvider } = await import('../../typescript-provider.js');
    const result = await createTypeScriptProvider({ subprocessChild: true }).run({ ...context, logger }, inputs);
    await flushLogs();
    await writeProviderResult(result, write);
  } catch (error) {
    try {
      await flushLogs();
      let failure = { type: 'failure', reason: typeof error?.reason === 'string' ? error.reason : 'provider-exception',
        operation: error?.operation || 'typescript-subprocess', message: String(error?.message || error).slice(0, 2000),
        details: error?.details ?? { code: error?.code || null } };
      try { measureJsonRecord(failure, limits); }
      catch {
        failure = { type: 'failure', reason: 'failure-details-byte-limit',
          details: { originalReason: failure.reason } };
      }
      await write(failure);
    } catch { /* The parent also requires completion and successful child exit. */ }
    throw error;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runTypeScriptRuntimeEntry({ limits: JSON.parse(process.argv[2] || '{}') });
  } catch { process.exitCode = 1; }
}
