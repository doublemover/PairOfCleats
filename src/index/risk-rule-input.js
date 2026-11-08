import path from 'node:path';
import { readVerifiedContainedFileSync } from '../shared/contained-file.js';
import { describeStorageFailure } from '../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../shared/storage/operation-error.js';
import { throwIfAborted } from '../shared/abort.js';

const MAX_BYTES = 4 * 1024 * 1024, MAX_RULES = 4096, MAX_PATTERNS = 16384;
const roles = ['sources', 'sinks', 'sanitizers'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message, code = 'ERR_RISK_RULES_SCHEMA', cause) => Object.assign(new Error(message, { cause }), { code });

const validateBundle = bundle => {
  if (!object(bundle) || !roles.some(role => Object.hasOwn(bundle, role))
    || bundle.version !== undefined && typeof bundle.version !== 'string') throw fail('External risk rules require an object with rule arrays.');
  let rules = 0, patterns = 0;
  for (const role of roles) {
    if (bundle[role] === undefined) continue;
    if (!Array.isArray(bundle[role])) throw fail(`External risk ${role} must be an array.`);
    rules += bundle[role].length;
    if (rules > MAX_RULES) throw fail('External risk rule count allowance exceeded.', 'ERR_RISK_RULES_BUDGET');
    for (const rule of bundle[role]) {
      if (!object(rule) || typeof rule.name !== 'string' || !rule.name.trim() || !Array.isArray(rule.patterns)
        || !rule.patterns.length || rule.patterns.some(pattern => typeof pattern !== 'string' || !pattern)
        || rule.requires !== undefined && typeof rule.requires !== 'string'
        || ['id', 'type', 'category', 'severity'].some(key => rule[key] !== undefined && typeof rule[key] !== 'string')
        || ['tags', 'languages'].some(key => rule[key] !== undefined && (!Array.isArray(rule[key]) || rule[key].some(value => typeof value !== 'string')))
        || rule.confidence !== undefined && (typeof rule.confidence !== 'number' || !Number.isFinite(rule.confidence))) {
        throw fail(`Malformed external risk ${role} entry.`);
      }
      patterns += rule.patterns.length + (rule.requires ? 1 : 0);
      if (patterns > MAX_PATTERNS || rule.patterns.some(pattern => pattern.length > 65536) || (rule.requires?.length || 0) > 65536) {
        throw fail('External risk pattern allowance exceeded.', 'ERR_RISK_RULES_BUDGET');
      }
    }
  }
  return bundle;
};

/** An explicit configured input must succeed. Its original descriptor and byte
 * receipt remain the authority for both compilation and downstream reuse. */
export const readRiskRuleInput = (rootDir, requestedPath, { signal = null } = {}) => {
  if (requestedPath === undefined || requestedPath === null) {
    throwIfAborted(signal);
    return { bundle: null, receipt: Object.freeze({ schemaVersion: 1, requested: false, requestedPath: null, sourcePath: null,
      outcome: 'not-configured', byteLength: 0, byteHash: null, hashAlgorithm: 'sha256' }) };
  }
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) throw fail('Requested risk rules path must be a nonempty string.');
  const sourcePath = path.resolve(rootDir, requestedPath);
  const identity = { schemaVersion: 1, requested: true, requestedPath, sourcePath };
  try {
    throwIfAborted(signal);
    const snapshot = readVerifiedContainedFileSync(path.dirname(sourcePath), sourcePath, { maxBytes: MAX_BYTES, signal });
    let text, parsed;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.buffer); }
    catch (cause) { throw fail('External risk rules are not valid UTF-8.', 'ERR_RISK_RULES_ENCODING', cause); }
    try { parsed = JSON.parse(text); }
    catch (cause) { throw fail('External risk rules are not valid JSON.', 'ERR_RISK_RULES_JSON', cause); }
    const bundle = validateBundle(parsed);
    throwIfAborted(signal);
    return { bundle, receipt: Object.freeze({ ...identity, outcome: 'complete', byteLength: snapshot.buffer.length,
      byteHash: snapshot.hash, hashAlgorithm: 'sha256' }) };
  } catch (error) {
    let diagnostic;
    try { diagnostic = describeStorageFailure(error, { phase: 'risk-rule-acquisition' }); }
    catch (pending) { throw addStorageFailureContext(pending, { riskRuleInput: Object.freeze({ ...identity,
      outcome: 'failed', reason: 'resource-unsettled' }) }); }
    const reasons = { ENOENT: 'missing', EACCES: 'denied', EPERM: 'denied', ERR_FILE_TOO_LARGE: 'oversized',
      ERR_RISK_RULES_SCHEMA: 'invalid-schema', ERR_RISK_RULES_JSON: 'invalid-json', ERR_RISK_RULES_ENCODING: 'invalid-encoding',
      ERR_RISK_RULES_BUDGET: 'rule-budget', ABORT_ERR: 'canceled', ERR_FILE_CHANGED: 'changed', ERR_FILE_INTEGRITY: 'integrity' };
    throw addStorageFailureContext(error, { riskRuleInput: Object.freeze({ ...identity, outcome: 'failed',
      reason: reasons[diagnostic.code] || 'read-failed' }) });
  }
};
