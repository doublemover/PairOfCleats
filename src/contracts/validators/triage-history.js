import { TRIAGE_HISTORY_CURSOR_SCHEMA, TRIAGE_HISTORY_SELECTION_SCHEMA, TRIAGE_HISTORY_SELECTION_VERSION,
  TRIAGE_HISTORY_SELECTION_POLICY, TRIAGE_HISTORY_LIMITS } from '../triage-history.js';
import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';

const selectionValidator = compileSchema(createAjv({ allErrors: false, strict: true }), TRIAGE_HISTORY_SELECTION_SCHEMA, { lazy: true });

const invalid = cause => Object.assign(new Error('Invalid triage history continuation.', cause ? { cause } : undefined), { code: 'ERR_TRIAGE_HISTORY_CURSOR' });
const ownData = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !Object.hasOwn(descriptors, key)
    || !Object.hasOwn(descriptors[key], 'value') || descriptors[key].enumerable !== true)) throw invalid();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
};
export const assertTriageHistoryCursor = value => {
  value = ownData(value, TRIAGE_HISTORY_CURSOR_SCHEMA.required);
  value.after = Object.freeze(ownData(value.after, ['timestamp', 'decisionId']));
  if (value.schemaVersion !== TRIAGE_HISTORY_SELECTION_VERSION || value.policy !== TRIAGE_HISTORY_SELECTION_POLICY
    || ![value.scopeHash, value.snapshotHash].every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/u.test(hash))
    || typeof value.asOf !== 'string' || value.asOf.length > 32 || !Number.isFinite(Date.parse(value.asOf))
    || new Date(value.asOf).toISOString() !== value.asOf || !Number.isSafeInteger(value.after.timestamp)
    || typeof value.after.decisionId !== 'string' || !value.after.decisionId || value.after.decisionId.length > 4096
    || Buffer.byteLength(JSON.stringify(value)) > TRIAGE_HISTORY_LIMITS.cursorBytes) throw invalid();
  return Object.freeze(value);
};

export const parseTriageHistoryCursor = serialized => {
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > TRIAGE_HISTORY_LIMITS.cursorBytes) throw invalid();
  let value;
  try { value = JSON.parse(serialized); } catch (cause) { throw invalid(cause); }
  return assertTriageHistoryCursor(value);
};

export const assertTriageHistorySelection = value => {
  if (!selectionValidator(value)) throw Object.assign(new Error('Invalid triage history selection envelope.'), { code: 'ERR_TRIAGE_HISTORY_SELECTION' });
  const exact = value.items.filter(item => item.relation === 'exactFinding').length;
  if (value.items.length > value.allocation.limit || value.coverage.omitted.exact !== value.coverage.candidates.exact - exact
    || value.coverage.omitted.related !== value.coverage.candidates.related - (value.items.length - exact)
    || value.items.some(item => item.validity.asOf !== value.asOf || item.relation === 'exactFinding'
      && (!item.findingRecordId || !item.matchedFields.includes('findingRecordId') || item.scope !== 'selected-record-namespace'))
    || value.continuation && (value.coverage.countsAreLowerBounds || value.continuation.scopeHash !== value.scopeHash
      || value.continuation.snapshotHash !== value.snapshotHash || value.continuation.asOf !== value.asOf)
    || value.coverage.state === 'complete' && (value.coverage.countsAreLowerBounds || value.coverage.omitted.exact || value.coverage.omitted.related)) {
    throw Object.assign(new Error('Inconsistent triage history coverage.'), { code: 'ERR_TRIAGE_HISTORY_SELECTION' });
  }
  return value;
};
