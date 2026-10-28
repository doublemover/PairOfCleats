import { randomUUID } from 'node:crypto';
import { TUI_OPERATION_FAILURES as catalog } from '../../../src/contracts/tui-operation-failures.js';

const inspections = new WeakMap();
const own = (object, key, errors) => {
  if (object === null || !['object', 'function'].includes(typeof object)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch (error) { errors.push(error); return undefined; }
};
const knownCode = value => typeof value === 'string' && value.length <= 80 && Object.hasOwn(catalog.codes, value);
const field = value => typeof value === 'string' && catalog.fields.includes(value) ? value : null;
const nativeExit = value => Number.isSafeInteger(value) && [3221225477, 3221226505, -1073741819, -1073740791].includes(value);

/** Only the existing whole JSON failure envelope owns a child cause. Human
 * stderr/messages are never searched or copied. Unknown/truncated frames remain
 * unknown; safe codes select static explanations in both consumers.
 */
export const readTuiSearchChildFailure = error => {
  const errors = [], result = own(error, 'result', errors);
  let code = null, selectedField = null;
  const capture = own(result, 'outputCapture', errors);
  for (const stream of ['stdout', 'stderr']) {
    const text = own(result, stream, errors), stats = own(capture, stream, errors);
    if (typeof text !== 'string' || Buffer.byteLength(text) > 768 * 1024
      || own(stats, 'truncated', errors) === true || own(stats, 'encodingLoss', errors) === true) continue;
    let payload;
    try { payload = JSON.parse(text); } catch { continue; }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.ok !== false || !knownCode(payload.code)) continue;
    code = payload.code; selectedField = field(payload.field); break;
  }
  const resultCode = own(result, 'exitCode', errors);
  return Object.freeze({ code, field: selectedField, nativeFailure: nativeExit(resultCode), inspections: Object.freeze(errors) });
};

export const projectTuiOperationFailure = (error, { cancelled = false, timedOut = false, resourcePending = false,
  diagnosticId = `tui-${randomUUID()}` } = {}) => {
  const errors = [], code = own(error, 'code', errors);
  const reason = resourcePending ? 'resource-pending' : timedOut ? 'timeout' : cancelled ? 'cancelled'
    : own(error, 'tuiNativeSearchFailure', errors) === true ? 'native-failure' : knownCode(code) ? catalog.codes[code] : 'unknown';
  const definition = catalog.reasons[reason];
  if (typeof diagnosticId !== 'string' || !/^tui-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(diagnosticId)) {
    diagnosticId = `tui-${randomUUID()}`;
  }
  const result = Object.freeze({ version: catalog.version, reason, outcome: definition.outcome,
    field: field(own(error, 'tuiField', errors)), diagnosticId, actions: Object.freeze([...definition.actions]) });
  inspections.set(result, Object.freeze(errors)); return result;
};
export const getTuiFailureInspections = value => inspections.get(value) || Object.freeze([]);
export const tuiFailureReason = failure => catalog.reasons[failure?.reason] || catalog.reasons.unknown;
export const tuiFailureCode = error => {
  const errors = [], code = own(error, 'code', errors);
  const value = Object.freeze({ code: knownCode(code) ? code : 'ERR_TUI_OPERATION_FAILED' });
  inspections.set(value, Object.freeze(errors));
  return value;
};
