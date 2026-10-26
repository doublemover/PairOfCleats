import { createHash } from 'node:crypto';
import { installedPackageVersion } from './installed-package-version.js';
import { stableStringifyForSignature } from './stable-json.js';

export const IMPORT_EXTRACTION_VERSION = 1;
const receipts = new WeakMap();
const hash = value => createHash('sha256').update(stableStringifyForSignature(value)).digest('hex');
const sourceHash = text => createHash('sha256').update(text, 'utf16le').digest('hex');
const states = new Set(['complete', 'partial', 'unqualified', 'unsupported', 'unavailable', 'invalid', 'cancelled']);
const count = value => Number.isSafeInteger(value) && value >= 0;
const fail = message => Object.assign(new Error(message), { code: 'ERR_IMPORT_EXTRACTION_CONTRACT' });
const entryTokens = entries => entries.map(entry => typeof entry === 'string' ? { specifier: entry, representation: 'string' }
  : { specifier: typeof entry?.specifier === 'string' ? entry.specifier : null,
    import: typeof entry?.import === 'string' ? entry.import : null,
    provenance: entry?.provenance ?? null, collectorHint: entry?.collectorHint ?? null });
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const seal = input => freeze({ ...input, identity: 'ie1:' + hash(input) });

/** Package metadata is an input/readiness identity, never activation evidence. */
export const importExtractionRuntimeVersions = () => Object.fromEntries(['yaml', 'smol-toml', 'protobufjs', 'es-module-lexer', 'cjs-module-lexer']
  .map(name => [name, installedPackageVersion(name)]));

export const createImportExtraction = ({ entries, text, producerId = 'legacy-array', parser = null,
  parserCoverage = null, parserReason = null, parserLimits = null, scope = 'unqualified-array-producer', reasons = [], limits = {},
  admittedLength = null, observedEntries = null, state: requestedState = null } = {}) => {
  if (!Array.isArray(entries) || text !== null && typeof text !== 'string') throw fail('Extraction needs owned text and an entry array.');
  const reasonCounts = Object.create(null);
  for (const reason of new Set([...(parserReason ? [parserReason] : []), ...reasons])) {
    if (typeof reason !== 'string' || !reason || reason.length > 128) continue;
    if (Object.hasOwn(reasonCounts, reason) || Object.keys(reasonCounts).length < 16) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
  if (parserCoverage === 'partial' && !parserReason) reasonCounts.parser_scope_partial = 1;
  const codes = Object.keys(reasonCounts);
  let state = requestedState || (!parser ? 'unqualified' : parserCoverage === 'complete' ? 'complete' : 'partial');
  if (!requestedState) {
    if (codes.includes('cancelled')) state = 'cancelled';
    else if (codes.some(code => /parser-(?:unavailable|load-failed)/u.test(code))) state = 'unavailable';
    else if (codes.some(code => /parser-unsupported|capability-unsupported/u.test(code))) state = 'unsupported';
    else if (codes.some(code => /(?:^|-)invalid-|^invalid-|^parse-failed$/u.test(code))) state = 'invalid';
    else if (codes.some(code => /(?:source|node|depth|time|token|document|line)[-_](?:length-)?(?:limit|bytes)|^scan_/u.test(code))) state = 'partial';
    else if (parserCoverage === 'unavailable' || parserReason) state = 'unavailable';
    else if (codes.length) state = 'partial';
  }
  if (parser?.available === false && !['cancelled', 'unsupported', 'invalid'].includes(state)) state = 'unavailable';
  if (!states.has(state)) throw fail('Unknown import extraction state.');
  const reusableSubset = state === 'partial' && codes.every(code => code === 'parser_scope_partial');
  const completeObservation = state === 'complete' || reusableSubset;
  const identified = parser?.available === true && typeof parser.version === 'string' && parser.version.length > 0;
  return seal({ schemaVersion: IMPORT_EXTRACTION_VERSION,
    producer: { id: producerId, version: '1' }, parser: parser ? { ...parser } : null,
    source: { textHash: text === null ? null : sourceHash(text), encoding: 'utf16le-js-string', length: text === null ? null : text.length,
      admittedLength: text === null ? null : admittedLength === null ? text.length : Math.min(text.length, Math.max(0, admittedLength)), scannedLength: null },
    scope, state, recognition: entries.length ? 'nonempty' : completeObservation && parser?.available === true && text !== null ? 'empty' : 'unknown',
    reasonCounts, limits: { ...limits }, parserLimits: parserLimits ? { ...parserLimits } : null,
    counts: { observed: count(observedEntries) ? observedEntries : null, retained: entries.length, dropped: null },
    steps: [], entriesHash: hash(entryTokens(entries)),
    reusePolicy: completeObservation && identified ? reusableSubset ? 'retain-qualified-static-subset' : 'qualified-scope' : 'refresh-required' });
};

export const admitImportExtraction = (receipt, entries = null, { text = null } = {}) => {
  if (!receipt || typeof receipt.producer?.id !== 'string' || !receipt.producer.id || receipt.producer.version !== '1'
    || typeof receipt.scope !== 'string' || !receipt.scope || !receipt.reasonCounts || Object.keys(receipt.reasonCounts).length > 20
    || Object.keys(receipt.reasonCounts).some(reason => !reason || reason.length > 128)
    || Object.values(receipt.reasonCounts).some(value => !count(value) || value === 0)
    || !receipt.limits || Object.keys(receipt.limits).length > 8
    || Object.values(receipt.limits).some(value => value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))
    || receipt.parserLimits !== null && (!receipt.parserLimits || Object.keys(receipt.parserLimits).length > 16
      || Object.values(receipt.parserLimits).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0))
    || receipt.parser !== null && (!receipt.parser || typeof receipt.parser.id !== 'string' || !receipt.parser.id
      || receipt.parser.version !== null && (typeof receipt.parser.version !== 'string' || !receipt.parser.version)
      || receipt.parser.available !== null && typeof receipt.parser.available !== 'boolean')
    || !['empty', 'nonempty', 'unknown'].includes(receipt.recognition)
    || !receipt.source || receipt.source.encoding !== 'utf16le-js-string'
    || receipt.source.scannedLength !== null
    || receipt.source.textHash !== null && !/^[a-f0-9]{64}$/u.test(receipt.source.textHash)
    || receipt.source.length !== null && !count(receipt.source.length)
    || (receipt.source.textHash === null) !== (receipt.source.length === null)
    || receipt.source.length === null && receipt.source.admittedLength !== null
    || receipt.source.admittedLength !== null && (!count(receipt.source.admittedLength) || receipt.source.admittedLength > receipt.source.length)
    || receipt.schemaVersion !== IMPORT_EXTRACTION_VERSION || !states.has(receipt.state)
    || entries !== null && !Array.isArray(entries) || !Array.isArray(receipt.steps) || receipt.steps.length > 8
    || !count(receipt.counts?.retained) || receipt.counts.observed !== null && (!count(receipt.counts.observed) || receipt.counts.observed < receipt.counts.retained)
    || receipt.counts.dropped !== null || entries !== null && receipt.counts.retained !== entries.length
    || !['qualified-scope', 'retain-qualified-static-subset', 'refresh-required'].includes(receipt.reusePolicy)
    || (receipt.counts.retained > 0) !== (receipt.recognition === 'nonempty')
    || receipt.recognition === 'empty' && (receipt.parser?.available !== true || receipt.source.textHash === null
      || !(receipt.state === 'complete' || receipt.state === 'partial' && Object.keys(receipt.reasonCounts).every(code => code === 'parser_scope_partial')))
    || !/^[a-f0-9]{64}$/u.test(receipt.entriesHash)
    || entries !== null && receipt.entriesHash !== hash(entryTokens(entries)) || !receipt.source
    || text !== null && receipt.source.textHash !== sourceHash(text)) throw fail('Import extraction does not match its source/retained entries.');
  const owners = new Set();
  for (const step of receipt.steps) {
    if (!step || typeof step.owner !== 'string' || !step.owner || step.owner.length > 64 || owners.has(step.owner)
      || !['input', 'retained', 'duplicates', 'invalid', 'omitted'].every(key => count(step[key]))
      || step.input !== step.retained + step.duplicates + step.invalid + step.omitted
      || step.limit !== null && (typeof step.limit !== 'number' || !Number.isFinite(step.limit) || step.limit < 0)) throw fail('Invalid bounded extraction projection receipt.');
    owners.add(step.owner);
  }
  const { identity, ...input } = receipt;
  if (identity !== 'ie1:' + hash(input)) throw fail('Import extraction identity differs from its receipt.');
  return receipt;
};

export const attachImportExtraction = (entries, receipt) => {
  admitImportExtraction(receipt, entries);
  receipts.set(entries, receipt);
  return entries;
};
export const getImportExtraction = entries => {
  const receipt = entries && typeof entries === 'object' ? receipts.get(entries) : null;
  return receipt ? admitImportExtraction(receipt, entries) : null;
};

/** Normalization and projection have separate, exact local accounting. Unknown
 * producer omissions remain unknown; duplicates never become resource loss.
 * Repeated idempotent stages retain earlier losses without growing history. */
export const projectImportExtraction = (receipt, inputEntries, outputEntries, {
  owner, duplicates = 0, invalid = 0, omitted = 0, limit = null
} = {}) => {
  admitImportExtraction(receipt, inputEntries);
  if (typeof owner !== 'string' || !owner || owner.length > 64 || ![duplicates, invalid, omitted].every(count)
    || outputEntries.length + duplicates + invalid + omitted !== inputEntries.length) throw fail('Extraction projection accounting differs.');
  const { identity: _identity, ...base } = receipt;
  const steps = receipt.steps.map(step => ({ ...step }));
  const prior = steps.find(step => step.owner === owner);
  if (prior) {
    if (prior.retained === inputEntries.length) {
      prior.retained = outputEntries.length; prior.duplicates += duplicates; prior.invalid += invalid; prior.omitted += omitted;
    } else if (duplicates || invalid || omitted) throw fail('Repeated projection has an unrelated input.');
  } else steps.push({ owner, input: inputEntries.length, retained: outputEntries.length, duplicates, invalid, omitted, limit });
  if (steps.length > 8) throw fail('Extraction projection history exceeds its bounded owners.');
  const reasonCounts = { ...receipt.reasonCounts };
  if (omitted) reasonCounts.projection_limit = (reasonCounts.projection_limit || 0) + omitted;
  if (invalid) reasonCounts.invalid_entries = (reasonCounts.invalid_entries || 0) + invalid;
  const degraded = invalid > 0 || omitted > 0;
  const state = degraded && ['complete', 'partial'].includes(receipt.state) ? 'partial' : receipt.state;
  return seal({ ...base, state, reasonCounts, steps, counts: { ...receipt.counts, retained: outputEntries.length },
    recognition: outputEntries.length ? 'nonempty' : degraded ? 'unknown' : receipt.recognition,
    entriesHash: hash(entryTokens(outputEntries)), reusePolicy: degraded ? 'refresh-required' : receipt.reusePolicy });
};

export const canReuseImportExtraction = (receipt, entries) => {
  try { admitImportExtraction(receipt, entries); }
  catch { return false; }
  if (receipt.source.textHash === null || receipt.parser?.available !== true || typeof receipt.parser.version !== 'string' || !receipt.parser.version) return false;
  return receipt.state === 'complete' && receipt.reusePolicy === 'qualified-scope'
    || receipt.state === 'partial' && receipt.reusePolicy === 'retain-qualified-static-subset'
      && Object.keys(receipt.reasonCounts).every(code => code === 'parser_scope_partial');
};

/** Per-file producer coverage is independent of resolver success or warning
 * suppression. Missing legacy receipts are unqualified, including empty lists. */
export const summarizeImportExtraction = fileRelations => {
  const result = { schemaVersion: 1, scope: 'provided-file-relations', inputState: fileRelations == null ? 'unavailable' : 'provided',
    state: fileRelations == null ? 'partial' : 'complete', files: 0, partialFiles: 0, states: {}, relationStates: {}, recognizedEmpty: 0,
    reasonCountUnit: 'files', reasonCounts: Object.create(null), omittedReasonObservations: 0,
    samples: [], omittedSamples: 0, sqlUsageFiles: 0, sqlUsageStates: {} };
  let maximumReason = null;
  const increment = (object, name) => { object[name] = (object[name] || 0) + 1; };
  const entries = fileRelations instanceof Map ? fileRelations.entries() : Object.entries(fileRelations || {});
  for (const [file, relations] of entries) {
    result.files++;
    const receipt = relations?.importScanExtraction || relations?.importExtraction;
    const state = states.has(receipt?.state) ? receipt.state : 'unqualified';
    const relationState = states.has(relations?.importExtraction?.state) ? relations.importExtraction.state : 'unqualified';
    increment(result.states, state); increment(result.relationStates, relationState);
    if (receipt?.recognition === 'empty') result.recognizedEmpty++;
    const reasons = new Set([...Object.keys(receipt?.reasonCounts || {}), ...Object.keys(relations?.importExtraction?.reasonCounts || {})]);
    if (!receipt || !relations?.importExtraction) reasons.add('legacy_extraction_unqualified');
    let sqlUsageState = null;
    if (relations?.sqlRelationEvidence) {
      result.sqlUsageFiles++;
      const observed = relations.sqlRelationEvidence.coverage?.state;
      sqlUsageState = states.has(observed) ? observed : 'unqualified';
      increment(result.sqlUsageStates, sqlUsageState);
      if (sqlUsageState !== 'complete') reasons.add('sql_usage_scope_partial');
    }
    for (const reason of reasons) {
      if (typeof reason !== 'string' || !reason || reason.length > 128) continue;
      if (Object.hasOwn(result.reasonCounts, reason)) { result.reasonCounts[reason]++; continue; }
      if (Object.keys(result.reasonCounts).length < 32) {
        result.reasonCounts[reason] = 1;
        maximumReason = maximumReason === null || reason > maximumReason ? reason : maximumReason;
      } else if (reason < maximumReason) {
        result.omittedReasonObservations += result.reasonCounts[maximumReason];
        delete result.reasonCounts[maximumReason]; result.reasonCounts[reason] = 1;
        maximumReason = Object.keys(result.reasonCounts).sort().at(-1);
      } else result.omittedReasonObservations++;
    }
    if (state !== 'complete' || relationState !== 'complete' || sqlUsageState !== null && sqlUsageState !== 'complete') {
      result.state = 'partial'; result.partialFiles++;
      if (typeof file === 'string' && file.length <= 1024 && (result.samples.length < 20 || file < result.samples.at(-1).file)) {
        result.samples.push({ file, state, relationState, sqlUsageState, identity: receipt?.identity || null, reasons: [...reasons].sort().slice(0, 8) });
        result.samples.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
        if (result.samples.length > 20) result.samples.pop();
      }
    }
  }
  result.omittedSamples = result.partialFiles - result.samples.length;
  for (const key of ['states', 'relationStates', 'reasonCounts', 'sqlUsageStates']) result[key] = Object.fromEntries(Object.entries(result[key]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return freeze(result);
};

/** Aggregate arithmetic is part of the artifact contract as well as its shape. */
export const admitImportExtractionSummary = summary => {
  const stateTotal = dictionary => Object.values(dictionary || {}).reduce((total, value) => total + value, 0);
  if (!summary || !count(summary.files) || !count(summary.partialFiles) || summary.partialFiles > summary.files
    || !count(summary.recognizedEmpty) || summary.recognizedEmpty > summary.files
    || !count(summary.sqlUsageFiles) || summary.sqlUsageFiles > summary.files
    || stateTotal(summary.states) !== summary.files || stateTotal(summary.relationStates) !== summary.files
    || stateTotal(summary.sqlUsageStates) !== summary.sqlUsageFiles
    || !Array.isArray(summary.samples) || summary.samples.length > summary.partialFiles
    || summary.omittedSamples !== summary.partialFiles - summary.samples.length
    || Object.values(summary.reasonCounts || {}).some(value => !count(value) || value === 0 || value > summary.files)
    || summary.state !== (summary.inputState === 'provided' && summary.partialFiles === 0 ? 'complete' : 'partial')
    || summary.inputState === 'unavailable' && summary.files !== 0) throw fail('Import extraction aggregate counts disagree.');
  return summary;
};
