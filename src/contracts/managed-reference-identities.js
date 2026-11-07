import { createHash } from 'node:crypto';

export const MANAGED_REFERENCE_VERSION = 1;
export const MANAGED_REFERENCE_LANGUAGES = Object.freeze(['dockerfile', 'graphql', 'handlebars', 'proto', 'mustache', 'jinja']);
export const MANAGED_REFERENCE_KINDS = Object.freeze(['dependency', 'type-reference', 'fragment-reference', 'lookup', 'section-test', 'helper-invocation']);
export const MANAGED_REFERENCE_MAX_OCCURRENCES = 65536;
const languages = new Set(MANAGED_REFERENCE_LANGUAGES), kinds = new Set(MANAGED_REFERENCE_KINDS);
const MAX_REFERENCES = MANAGED_REFERENCE_MAX_OCCURRENCES;
const admittedFacts = new WeakSet();
const referenceIndexes = new WeakMap();
const digest = text => createHash('sha256').update(text, 'utf16le').digest('hex');
export const isManagedReferenceLanguage = id => languages.has(id);
export const enforceManagedReferenceCallKind = (relations, languageId) => languages.has(languageId)
  ? { ...relations, calls: [], callDetails: [], callDetailsWithRange: [], callCoverage: 'partial-reference-language-no-invocation-owner' }
  : relations;
const range = (value, length) => Number.isSafeInteger(value?.start) && Number.isSafeInteger(value?.end)
  && value.start >= 0 && value.end > value.start && value.end <= length;
const validValue = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Sorted source intervals retain syntax ownership without display-name joins.
 * Overlapping non-nested scopes never acquire an invented parent. */
export const createManagedReferenceFacts = ({ languageId, text, references, owners = [] }) => {
  if (!languages.has(languageId) || typeof text !== 'string' || !Array.isArray(references)) throw new TypeError('Invalid reference producer.');
  const scopes = owners.slice(0, MAX_REFERENCES).filter(owner => validValue(owner.name) && range(owner, text.length))
    .map(owner => ({ id: `${languageId}:${owner.start}:${owner.end}:${owner.name}`, name: owner.name, start: owner.start, end: owner.end }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const admitted = references.slice(0, MAX_REFERENCES).filter(entry => validValue(entry.value) && kinds.has(entry.kind))
    .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
  const stack = [], entries = [];
  let next = 0;
  for (const entry of admitted) {
    const source = range(entry, text.length) ? { start: entry.start, end: entry.end,
      range: entry.range === 'instruction' ? 'instruction' : 'token' } : null;
    if (source) {
      while (next < scopes.length && scopes[next].start <= source.start) {
        const scope = scopes[next++];
        while (stack.length && stack.at(-1).end <= scope.start) stack.pop();
        if (!stack.length || scope.end <= stack.at(-1).end) stack.push(scope);
      }
      while (stack.length && stack.at(-1).end <= source.start) stack.pop();
    }
    const owner = source ? stack.findLast(scope => source.start >= scope.start && source.end <= scope.end) || null : null;
    entries.push({ kind: entry.kind, value: entry.value, source, owner });
  }
  const facts = freeze({ schemaVersion: MANAGED_REFERENCE_VERSION, languageId,
    source: { textHash: digest(text), length: text.length, encoding: 'utf16le-js-string' },
    scope: 'static-reference-occurrences-not-call-edges', references: entries,
    coverage: { state: 'partial', observed: references.length, retained: entries.length,
      omitted: references.length - entries.length, unattributed: entries.filter(entry => !entry.owner).length } });
  admittedFacts.add(facts);
  return facts;
};

export const admitManagedReferenceFacts = (facts, languageId, { text = null, retain = true } = {}) => {
  if (facts && admittedFacts.has(facts) && facts.languageId === languageId) {
    return text === null || typeof text === 'string' && text.length === facts.source.length && digest(text) === facts.source.textHash ? facts : null;
  }
  if (!keys(facts, ['schemaVersion', 'languageId', 'source', 'scope', 'references', 'coverage'])
    || !keys(facts.source, ['textHash', 'length', 'encoding'])
    || facts.schemaVersion !== MANAGED_REFERENCE_VERSION || facts.languageId !== languageId || !languages.has(languageId)
    || facts.scope !== 'static-reference-occurrences-not-call-edges' || facts.source?.encoding !== 'utf16le-js-string'
    || !/^[a-f0-9]{64}$/u.test(facts.source?.textHash || '') || !Number.isSafeInteger(facts.source.length) || facts.source.length < 0
    || !Array.isArray(facts.references) || facts.references.length > MAX_REFERENCES) return null;
  if (text !== null && (typeof text !== 'string' || text.length !== facts.source.length || digest(text) !== facts.source.textHash)) return null;
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const coverage = facts.coverage;
  if (!keys(coverage, ['state', 'observed', 'retained', 'omitted', 'unattributed'])
    || coverage.state !== 'partial' || ![coverage.observed, coverage.retained, coverage.omitted, coverage.unattributed].every(count)
    || coverage.retained !== facts.references.length || coverage.observed !== coverage.retained + coverage.omitted
    || coverage.unattributed !== facts.references.filter(entry => !entry?.owner).length) return null;
  for (const entry of facts.references) {
    if (!keys(entry, ['kind', 'value', 'source', 'owner']) || !kinds.has(entry.kind) || !validValue(entry.value)) return null;
    if (entry.source !== null && (!keys(entry.source, ['start', 'end', 'range'])
      || !range(entry.source, facts.source.length) || !['token', 'instruction'].includes(entry.source.range))) return null;
    if (entry.owner !== null && (!keys(entry.owner, ['id', 'name', 'start', 'end']) || !entry.source
      || !range(entry.owner, facts.source.length) || !validValue(entry.owner.name)
      || entry.owner.id !== `${languageId}:${entry.owner.start}:${entry.owner.end}:${entry.owner.name}`
      || entry.source.start < entry.owner.start || entry.source.end > entry.owner.end)) return null;
  }
  if (retain) { freeze(facts); admittedFacts.add(facts); }
  return facts;
};

export const projectManagedReferences = (facts, languageId, chunk) => {
  const admitted = admitManagedReferenceFacts(facts, languageId);
  if (!admitted || !range(chunk, Number.MAX_SAFE_INTEGER)) return { state: 'unavailable', details: [] };
  // A reference can be displayed inside an instruction/header chunk while its
  // semantic owner has a larger source range. Never join on a display title.
  let index = referenceIndexes.get(admitted);
  if (!index) {
    index = admitted.references.filter(entry => entry.source).sort((a, b) => a.source.start - b.source.start);
    referenceIndexes.set(admitted, index);
  }
  let low = 0, high = index.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (index[middle].source.start < chunk.start) low = middle + 1; else high = middle;
  }
  const details = [];
  for (let cursor = low; cursor < index.length && index[cursor].source.start < chunk.end; cursor++) {
    const entry = index[cursor];
    if (entry.source.end <= chunk.end) details.push({ ...entry, source: { ...entry.source }, owner: entry.owner ? { ...entry.owner } : null });
  }
  return { state: 'partial', coverage: admitted.coverage, details };
};
