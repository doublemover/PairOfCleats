import { BENCH_TERMINAL_RECEIPT_VERSION } from './runner-contract.js';

/** A whole-benchmark skip is the last stdout record, from the selected
 * benchmark, with an explicit suite policy. Incidental log words grant nothing. */
export const readBenchSkipReceipt = (stdout, id) => {
  const text = typeof stdout === 'string' ? stdout.trimEnd() : '';
  const start = text.lastIndexOf('\n') + 1;
  if (text.length - start > 1024) return null;
  const line = text.slice(start);
  if (!line) return null;
  let value;
  try { value = JSON.parse(line); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 5
    || value.schemaVersion !== BENCH_TERMINAL_RECEIPT_VERSION || value.kind !== 'bench-terminal'
    || value.status !== 'skipped' || value.benchmark !== id
    || typeof value.reason !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value.reason)) return null;
  return value;
};

export const classifyBenchOutcome = ({ result, id, expect = null, allowSkip = false, suiteMode = false }) => {
  const errors = [];
  if (expect?.json === true && (!result.json || result.json.kind === 'bench-terminal')) errors.push('missing json output');
  for (const key of ['baseline', 'current', 'delta']) {
    if (expect?.[key] === true && !result.parsed?.[key]) errors.push(`missing ${key} bench line`);
  }
  const processOk = result.exitCode === 0 && !result.timedOut && !result.signal && !result.processFailure;
  const receipt = readBenchSkipReceipt(result.stdout, id);
  let status = result.timedOut ? 'timeout' : !processOk ? 'error' : 'ok';
  let skipReason = null;
  if (processOk && receipt) {
    if (suiteMode && allowSkip && errors.length) { status = 'skipped'; skipReason = receipt.reason; }
    else { status = 'error'; errors.push(suiteMode && allowSkip
      ? 'terminal skip conflicts with completed benchmark output' : 'terminal skip is not allowed for this entry'); }
  } else if (processOk && suiteMode && errors.length) status = 'error';
  return { status, processOk, ok: status === 'ok', skipped: status === 'skipped', skipReason,
    parsedOk: !errors.length, errors };
};

export const summarizeBenchOutcomes = results => results.reduce((summary, entry) => {
  if (!Object.hasOwn(summary, entry.status)) throw new TypeError('Unknown terminal benchmark outcome.');
  summary[entry.status]++;
  return summary;
}, { ok: 0, error: 0, timeout: 0, skipped: 0 });
