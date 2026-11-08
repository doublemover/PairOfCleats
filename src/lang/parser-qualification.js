import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import { throwIfAborted } from '../shared/abort.js';

export const PARSER_QUALIFICATION_VERSION = 1;
const FAMILIES = Object.freeze(['nodes', 'chunks', 'declarations', 'imports', 'exports', 'calls', 'segments']);
const fail = message => Object.assign(new Error(message), { code: 'ERR_PARSER_QUALIFICATION' });
const textBoundary = (text, offset) => offset === 0 || offset === text.length
  || !(text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
    && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);

/** A bounded, source-qualified consumer projection. Parser acceptance alone is
 * deliberately only one compared field, never an assertion of AST parity. */
export const normalizeParserQualification = ({ result, bytes, maxRows = 16384, maxBytes = 4 * 1048576 }) => {
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 65536
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1048576) throw fail('Invalid parser projection bounds.');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const sourceHash = createHash('sha256').update(bytes).digest('hex');
  if (!result || result.sourceHash !== sourceHash || !['accepted', 'recovered', 'rejected', 'unavailable'].includes(result.status)
    || !result.parserIdentity?.family || !result.parserIdentity.version) throw fail('Parser result lacks source/status/observed parser identity.');
  let rows = 0, retainedBytes = 0;
  const projection = { status: result.status, families: {} };
  for (const family of FAMILIES) {
    if (!Array.isArray(result[family])) throw fail(`Parser projection must declare ${family}, including unsupported empty families.`);
    const values = [];
    for (const value of result[family]) {
      if (++rows > maxRows) throw fail('Parser consumer projection row budget exhausted.');
      const span = value.span;
      if (span !== null && (!Array.isArray(span) || span.length !== 2 || span.some(offset => !Number.isSafeInteger(offset) || offset < 0)
        || span[1] < span[0] || span[1] > text.length || !span.every(offset => textBoundary(text, offset)))) throw fail('Parser consumer projection has an inexact source span.');
      if (family === 'segments') {
        if (!span || typeof value.text !== 'string' || text.slice(...span) !== value.text
          || value.mappingQuality !== 'exact') throw fail('Embedded segment mapping does not preserve original source.');
      }
      const canonical = canonicalSemanticJson(value);
      retainedBytes += Buffer.byteLength(canonical);
      if (retainedBytes > maxBytes) throw fail('Parser projection byte budget exhausted.');
      values.push(canonical);
    }
    projection.families[family] = values.sort();
  }
  return { schemaVersion: PARSER_QUALIFICATION_VERSION, sourceHash,
    parserIdentity: JSON.parse(canonicalSemanticJson(result.parserIdentity)), projection, rows, retainedBytes,
    projectionHash: semanticHash('parser.consumer-projection.v1', projection) };
};

/** Exact per-case before/after hashes make intentional changes reviewable;
 * wildcard exclusions cannot hide a changed regression under an older waiver. */
export const compareParserQualification = ({ caseId, before, after, intentionalDifferences = [] }) => {
  if (!caseId || before.sourceHash !== after.sourceHash) throw fail('Parser comparisons require the same named exact source.');
  const differences = [];
  const compare = (family, left, right) => {
    if (canonicalSemanticJson(left) === canonicalSemanticJson(right)) return;
    const beforeHash = semanticHash('parser.consumer-difference.v1', left), afterHash = semanticHash('parser.consumer-difference.v1', right);
    const waiver = intentionalDifferences.find(value => value.caseId === caseId && value.family === family
      && value.beforeHash === beforeHash && value.afterHash === afterHash && typeof value.reason === 'string' && value.reason.trim());
    differences.push({ family, beforeHash, afterHash, before: left, after: right,
      intentional: Boolean(waiver), reason: waiver?.reason || null });
  };
  compare('parse-status', before.projection.status, after.projection.status);
  for (const family of FAMILIES) compare(family, before.projection.families[family], after.projection.families[family]);
  return { schemaVersion: PARSER_QUALIFICATION_VERSION, caseId, sourceHash: before.sourceHash,
    beforeParser: before.parserIdentity, afterParser: after.parserIdentity,
    state: differences.some(value => !value.intentional) ? 'regression' : differences.length ? 'intentional-difference' : 'equivalent', differences };
};

/** Adapters are explicitly supplied qualified parser owners. This runner does
 * not download alternate dependencies, replace native runtimes or bypass their
 * worker/cancellation/patch admission. Disposal is retained on every outcome. */
export const qualifyParserCorpus = async ({ cases, baseline, candidate, intentionalDifferences = [],
  maxCases = 20, maxSourceBytes = 500 * 1024, signal = null }) => {
  if (!Array.isArray(cases) || !Number.isSafeInteger(maxCases) || maxCases < 1 || maxCases > 64 || cases.length > maxCases
    || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1 || maxSourceBytes > 1048576
    || typeof baseline?.inspect !== 'function' || typeof candidate?.inspect !== 'function') throw fail('Invalid parser qualification corpus/adapters.');
  let sourceBytes = 0;
  const results = [], seen = new Set();
  for (const entry of cases) {
    throwIfAborted(signal);
    if (!entry || typeof entry.id !== 'string' || !entry.id || seen.has(entry.id) || !(entry.bytes instanceof Uint8Array)) throw fail('Corpus cases require unique IDs and original bytes.');
    seen.add(entry.id); sourceBytes += entry.bytes.byteLength;
    if (sourceBytes > maxSourceBytes) throw fail('Parser qualification source corpus budget exhausted.');
    let left, right;
    try {
      left = await baseline.inspect(entry, { signal });
      throwIfAborted(signal);
      right = await candidate.inspect(entry, { signal });
      throwIfAborted(signal);
      const before = normalizeParserQualification({ result: left, bytes: entry.bytes });
      const after = normalizeParserQualification({ result: right, bytes: entry.bytes });
      results.push(compareParserQualification({ caseId: entry.id, before, after, intentionalDifferences }));
    } finally {
      try { await right?.dispose?.(); } finally { await left?.dispose?.(); }
    }
  }
  return { schemaVersion: PARSER_QUALIFICATION_VERSION, status: results.some(value => value.state === 'regression') ? 'regression' : 'qualified-corpus',
    sourceBytes, results };
};
