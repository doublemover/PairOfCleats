import { createHash } from 'node:crypto';
import { stableStringifyForSignature } from './stable-json.js';

export const FLOW_METADATA_VERSION = '1';
export const FLOW_FIELDS = Object.freeze(['dataflow', 'controlFlow', 'throws', 'awaits', 'yields', 'returnsValue']);
export const FLOW_STATES = Object.freeze(['unknown', 'disabled', 'unavailable', 'partial', 'produced-empty', 'produced-positive', 'conflict']);
export const FLOW_AUTHORITIES = Object.freeze(['none', 'legacy', 'syntax', 'semantic']);
const sources = new WeakMap();
const hash = value => createHash('sha256').update(stableStringifyForSignature(value)).digest('hex');
const fail = message => Object.assign(new Error(message), { code: 'ERR_FLOW_EVIDENCE_CONTRACT' });
const freeze = object => {
  if (object && typeof object === 'object' && !Object.isFrozen(object)) {
    for (const value of Object.values(object)) freeze(value);
    Object.freeze(object);
  }
  return object;
};
export const copyFlowValue = value => value === undefined ? undefined : structuredClone(value);
export const hasFlowValue = (values, field) => Object.hasOwn(values || {}, field) && values[field] != null;
export const flowValueEmpty = value => typeof value === 'boolean' ? !value : typeof value === 'number' ? value === 0
  : Array.isArray(value) ? value.length === 0 : value && typeof value === 'object' ? Object.values(value).every(flowValueEmpty) : false;
const validValue = (field, value) => ['yields', 'returnsValue'].includes(field) ? typeof value === 'boolean'
  : ['throws', 'awaits'].includes(field) ? Array.isArray(value) && value.every(item => typeof item === 'string')
    : value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** Cache only against the invocation's existing context, never a native tree.
 * The string reference does not make a second source copy and dies with context. */
export const flowSourceIdentity = ({ text = null, chunk = null, languageId = null, context = null, generation = null } = {}) => {
  let textHash = null;
  if (typeof text === 'string') {
    const cached = context && typeof context === 'object' ? sources.get(context) : null;
    textHash = cached?.text === text ? cached.hash : createHash('sha256').update(text, 'utf16le').digest('hex');
    if (context && typeof context === 'object' && cached?.text !== text) sources.set(context, { text, hash: textHash });
  }
  const start = chunk?.start, end = chunk?.end;
  const bounded = typeof text === 'string' && Number.isSafeInteger(start) && Number.isSafeInteger(end)
    && start >= 0 && end >= start && end <= text.length;
  return freeze({ textHash, length: typeof text === 'string' ? text.length : null,
    range: bounded ? { start, end } : null, languageId: typeof languageId === 'string' ? languageId : null,
    owner: bounded ? { kind: typeof chunk.kind === 'string' ? chunk.kind : null, name: typeof chunk.name === 'string' ? chunk.name : null } : null,
    generation: typeof generation === 'string' ? generation : null });
};

export const sealFlowEvidence = ({ source, fields, diagnostics = [], omittedDiagnostics = 0 }) => {
  const content = { schemaVersion: 1, source, fields, diagnostics, omittedDiagnostics };
  return freeze({ ...content, identity: 'fm1:' + hash(content) });
};

/** A produced value is qualified only to this producer's stated fact kind/scope.
 * Legacy callers remain partial; false and [] are values, never missing facts. */
export const createFlowEvidence = ({ values = {}, source = flowSourceIdentity(), producer = { id: 'legacy-flow', version: 'unqualified' },
  authority = 'legacy', scope = 'legacy-flow-fields', states = {}, reasons = [], kinds = {} } = {}) => {
  const fields = {};
  for (const field of FLOW_FIELDS) {
    const present = hasFlowValue(values, field);
    if (present && !validValue(field, values[field])) throw fail('Invalid flow value for ' + field);
    const state = states[field] || (present ? authority === 'legacy' ? 'partial' : flowValueEmpty(values[field]) ? 'produced-empty' : 'produced-positive' : 'unknown');
    fields[field] = { state, producer: { ...producer }, authority: present ? authority : 'none', scope,
      kind: kinds[field] || (field === 'controlFlow' ? 'syntactic-control-counts' : authority === 'syntax' ? 'syntactic-effects' : 'semantic-effects'),
      valueHash: present ? hash(values[field]) : null, reasons: [...new Set(reasons)].slice(0, 8) };
  }
  const receipt = sealFlowEvidence({ source, fields });
  return admitFlowEvidence(receipt, values);
};

export const admitFlowEvidence = (receipt, values, { source = null } = {}) => {
  if (!receipt || receipt.schemaVersion !== 1 || !receipt.source || !receipt.fields
    || Object.keys(receipt.fields).length !== FLOW_FIELDS.length || !Array.isArray(receipt.diagnostics)
    || receipt.diagnostics.length > 16 || !Number.isSafeInteger(receipt.omittedDiagnostics) || receipt.omittedDiagnostics < 0
    || source && hash(receipt.source) !== hash(source)) throw fail('Flow evidence differs from its source/owner.');
  if (receipt.source.textHash !== null && !/^[a-f0-9]{64}$/u.test(receipt.source.textHash)
    || (receipt.source.textHash === null) !== (receipt.source.length === null)
    || receipt.source.length !== null && (!Number.isSafeInteger(receipt.source.length) || receipt.source.length < 0)) throw fail('Invalid flow source identity.');
  const range = receipt.source.range;
  if (range !== null && (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
    || range.start < 0 || range.end < range.start || receipt.source.length === null || range.end > receipt.source.length)) throw fail('Invalid flow source range.');
  for (const field of FLOW_FIELDS) {
    const item = receipt.fields[field], present = hasFlowValue(values, field);
    if (!item || !FLOW_STATES.includes(item.state) || !FLOW_AUTHORITIES.includes(item.authority)
      || typeof item.producer?.id !== 'string' || !item.producer.id || item.producer.id.length > 128
      || typeof item.producer.version !== 'string' || !item.producer.version || item.producer.version.length > 128
      || typeof item.scope !== 'string' || !item.scope || item.scope.length > 256 || !['syntactic-control-counts', 'syntactic-effects', 'semantic-effects', 'lexical-hints'].includes(item.kind)
      || !Array.isArray(item.reasons) || item.reasons.length > 8 || item.reasons.some(reason => typeof reason !== 'string' || reason.length > 128)
      || present && (!validValue(field, values[field]) || item.valueHash !== hash(values[field]))
      || !present && item.valueHash !== null
      || ['produced-empty', 'produced-positive', 'conflict'].includes(item.state) && !present
      || ['unknown', 'disabled', 'unavailable'].includes(item.state) && present
      || present && item.authority === 'none'
      || item.authority === 'syntax' && item.kind === 'semantic-effects'
      || ['produced-empty', 'produced-positive'].includes(item.state) && !['syntax', 'semantic'].includes(item.authority)
      || item.state === 'produced-empty' && !flowValueEmpty(values[field])
      || item.state === 'produced-positive' && flowValueEmpty(values[field])
      || ['syntax', 'semantic'].includes(item.authority) && (!receipt.source.textHash || !range)) throw fail('Invalid field-bound flow evidence for ' + field);
  }
  const { identity, ...content } = receipt;
  if (identity !== 'fm1:' + hash(content)) throw fail('Flow metadata identity differs from its fields.');
  return receipt;
};
