import { canonicalSemanticJson, semanticHash } from '../../semantic/identity.js';
import { createSemanticSourceSnapshot } from '../../semantic/source.js';
import { readSemanticSourceCapability } from '../../semantic/source-capability.js';
import { tokenizeQueryTerms } from '../../../retrieval/query.js';

const owners = new WeakMap();
const key = canonicalSemanticJson;
const text = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0;
const fields = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype
  && !Object.getOwnPropertySymbols(value).length && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), 'value'));
const fail = message => { throw new TypeError('Retained change history: ' + message); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const tokens = value => new Set(tokenizeQueryTerms([value], new Set(), { caseSensitive: false }));

/** Explicit retained snapshots only: no Git invocation, checkout, remote access or mutable-ref resolution. */
export const createRetainedChangeHistory = ({ repositoryNamespace, rangeId, members, episodes,
  coverage, maxBytes = 8 * 1024 * 1024 }) => {
  if (!text(repositoryNamespace) || !text(rangeId) || !Array.isArray(members) || members.length > 1024
    || !Array.isArray(episodes) || episodes.length > 1024 || !['complete-admitted-members', 'partial'].includes(coverage)
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) fail('bounded explicit range required');
  const comparisons = new Set();
  for (const member of members) {
    if (!fields(member, ['afterSnapshot', 'parentSnapshot']) || !hash(member.afterSnapshot)
      || !(member.parentSnapshot === null || hash(member.parentSnapshot)) || comparisons.has(key(member))) fail('immutable parent-specific members required');
    comparisons.add(key(member));
  }
  let sourceBytes = 0, metadataBytes = 0, pairCount = 0;
  const retained = [], identities = new Set();
  const side = value => {
    if (!fields(value, ['availability', 'path', 'blobId', 'snapshot'])
      || !['present', 'absent', 'unavailable', 'binary'].includes(value.availability)) fail('explicit source availability required');
    if (value.availability === 'absent') {
      if (value.path !== null || value.blobId !== null || value.snapshot !== null) fail('absent side cannot contain a source');
      return { availability: 'absent', path: null, blobId: null, manifest: null, source: null };
    }
    if (!text(value.path) || !(value.blobId === null || hash(value.blobId))) fail('qualified historical path/blob required');
    if (value.availability !== 'present') {
      if (value.snapshot !== null) fail('unavailable/binary side cannot substitute decoded source');
      return { availability: value.availability, path: value.path, blobId: value.blobId, manifest: null, source: null };
    }
    const owned = readSemanticSourceCapability(value.snapshot?.sourceCapability), manifest = value.snapshot?.manifest;
    if (!owned || !manifest || manifest.repositoryNamespace !== repositoryNamespace
      || manifest.path !== value.path || value.blobId !== owned.byteHash) fail('exact retained historical source required');
    sourceBytes += owned.byteLength;
    if (sourceBytes > maxBytes) throw new RangeError('Retained history source allowance exceeded.');
    const verified = createSemanticSourceSnapshot({ bytes: Buffer.from(owned.text), repositoryNamespace,
      path: manifest.path, language: manifest.language, dialect: manifest.dialect, mapping: manifest.mapping });
    if (key(verified.manifest) !== key(manifest)) fail('historical source manifest mismatch');
    return { availability: 'present', path: value.path, blobId: value.blobId, manifest: verified.manifest, source: owned.text };
  };
  for (const episode of episodes) {
    if (!fields(episode, ['afterSnapshot', 'parentSnapshot', 'availableAt', 'observedAt', 'intent', 'pairs', 'outcomes', 'links'])
      || !comparisons.has(key({ afterSnapshot: episode.afterSnapshot, parentSnapshot: episode.parentSnapshot }))
      || !time(episode.availableAt) || !time(episode.observedAt) || !Array.isArray(episode.intent) || episode.intent.length > 32
      || !Array.isArray(episode.pairs) || (pairCount += episode.pairs.length) > 4096
      || !Array.isArray(episode.outcomes) || episode.outcomes.length > 128 || !Array.isArray(episode.links) || episode.links.length > 128) fail('invalid admitted episode');
    const episodeId = semanticHash('pairofcleats.retained-change-episode.v1', {
      repositoryNamespace, provider: 'retained-snapshots-v1', afterSnapshot: episode.afterSnapshot, parentSnapshot: episode.parentSnapshot });
    if (identities.has(episodeId)) fail('duplicate episode identity');
    identities.add(episodeId);
    for (const intent of episode.intent) {
      if (!fields(intent, ['id', 'text', 'textHash', 'availableAt', 'observedAt', 'sourceVersion']) || !text(intent.id)
        || typeof intent.text !== 'string' || Buffer.byteLength(intent.text) > 65536 || !hash(intent.textHash)
        || intent.textHash !== semanticHash('pairofcleats.original-intent-text.v1', intent.text)
        || !time(intent.availableAt) || !time(intent.observedAt) || !text(intent.sourceVersion)) fail('versioned original intent required');
    }
    for (const outcome of episode.outcomes) {
      if (!fields(outcome, ['id', 'kind', 'evidenceRef', 'environmentId', 'availableAt', 'observedAt'])
        || !text(outcome.id) || !['passed-observation', 'failed-observation', 'untested', 'reverted', 'superseded'].includes(outcome.kind)
        || !text(outcome.evidenceRef) || !text(outcome.environmentId) || !time(outcome.availableAt) || !time(outcome.observedAt)) fail('qualified historical outcome required');
    }
    for (const link of episode.links) {
      if (!fields(link, ['kind', 'episodeId', 'availableAt', 'observedAt']) || !['reverts', 'supersedes', 'contradicts'].includes(link.kind)
        || !hash(link.episodeId) || !time(link.availableAt) || !time(link.observedAt)) fail('explicit historical linkage required');
    }
    const pairs = episode.pairs.map(pair => {
      if (!fields(pair, ['id', 'changeKind', 'correspondence', 'before', 'after']) || !text(pair.id)
        || !['addition', 'deletion', 'modification', 'rename-candidate', 'copy-candidate'].includes(pair.changeKind)
        || !['explicit-comparison', 'ambiguous', 'not-established'].includes(pair.correspondence)) fail('qualified source comparison required');
      const before = side(pair.before), after = side(pair.after);
      if (pair.changeKind === 'addition' && before.availability !== 'absent'
        || pair.changeKind === 'deletion' && after.availability !== 'absent'
        || pair.changeKind !== 'addition' && before.availability === 'absent'
        || pair.changeKind !== 'deletion' && after.availability === 'absent'
        || episode.parentSnapshot === null && before.availability !== 'absent'
        || before.availability === 'absent' && after.availability === 'absent') fail('addition/deletion availability mismatch');
      return { ...pair, before, after };
    });
    if (new Set(pairs.map(pair => pair.id)).size !== pairs.length) fail('duplicate comparison identity');
    const row = { ...episode, episodeId, pairs };
    metadataBytes += Buffer.byteLength(key(row));
    if (metadataBytes > maxBytes) throw new RangeError('Retained history metadata allowance exceeded.');
    retained.push(freeze(JSON.parse(key(row))));
  }
  if (coverage === 'complete-admitted-members' && retained.length !== members.length) fail('whole-member coverage is not established');
  const identity = { repositoryNamespace, rangeId, provider: 'retained-snapshots-v1', members, coverage, episodes: retained };
  const handle = Object.freeze({ rootId: semanticHash('pairofcleats.retained-change-history.v1', identity),
    repositoryNamespace, rangeId, coverage, episodeCount: retained.length, publication: 'private-unpublished' });
  owners.set(handle, retained);
  return handle;
};

const visible = (value, cutoff) => value.availableAt <= cutoff && value.observedAt <= cutoff;

/** Existing lexical tokenization over a deliberately small retained range; visibility precedes scoring. */
export const searchRetainedChangeHistory = ({ history, query, cutoff, allowedAfterSnapshots, limit = 20 }) => {
  const episodes = owners.get(history);
  if (!episodes || typeof query !== 'string' || Buffer.byteLength(query) > 4096 || !time(cutoff)
    || !(allowedAfterSnapshots instanceof Set) || allowedAfterSnapshots.size > 1024
    || [...allowedAfterSnapshots].some(id => !hash(id)) || !Number.isSafeInteger(limit) || limit < 0 || limit > 100) fail('bounded visibility-qualified query required');
  const wanted = tokens(query), hits = [];
  for (const episode of episodes) {
    if (!allowedAfterSnapshots.has(episode.afterSnapshot) || !visible(episode, cutoff)) continue;
    const intent = episode.intent.filter(row => visible(row, cutoff));
    const retainedTerms = tokens(intent.map(row => row.text).join('\n'));
    const matchedTerms = [...wanted].filter(term => retainedTerms.has(term)).sort();
    if (wanted.size && !matchedTerms.length) continue;
    hits.push({ episodeId: episode.episodeId, afterSnapshot: episode.afterSnapshot, parentSnapshot: episode.parentSnapshot,
      score: matchedTerms.length, matchedTerms, intent, outcomes: episode.outcomes.filter(row => visible(row, cutoff)),
      links: episode.links.filter(row => visible(row, cutoff)), pairIds: episode.pairs.map(row => row.id),
      applicability: 'historicalOnly', currentConditions: 'not-evaluated', actionAuthority: 'none' });
  }
  hits.sort((a, b) => b.score - a.score || (a.episodeId < b.episodeId ? -1 : a.episodeId > b.episodeId ? 1 : 0));
  return freeze({ historyRoot: history.rootId, cutoff, target: 'lexical-intent-token-overlap-v1',
    totalVisibleMatches: hits.length, hits: hits.slice(0, limit), omittedMatches: Math.max(0, hits.length - limit),
    sourceScope: 'explicit-retained-range', ancestryAuthority: 'caller-admitted-snapshot-membership', coverage: history.coverage });
};

/** Hydrate only the selected immutable comparison; never substitutes the current path. */
export const inspectRetainedChangeEpisode = ({ history, episodeId, pairId, cutoff, allowedAfterSnapshots, maxCharacters = 4096 }) => {
  const episodes = owners.get(history), episode = episodes?.find(row => row.episodeId === episodeId);
  if (!episode || !(allowedAfterSnapshots instanceof Set) || !allowedAfterSnapshots.has(episode.afterSnapshot)
    || !time(cutoff) || !visible(episode, cutoff) || !Number.isSafeInteger(maxCharacters)
    || maxCharacters < 0 || maxCharacters > 32768) fail('unavailable or invisible historical episode');
  const pair = episode.pairs.find(row => row.id === pairId);
  if (!pair) fail('unknown historical comparison');
  const preview = side => {
    if (side.source === null) return { availability: side.availability, path: side.path, blobId: side.blobId, sourceRef: null, text: null };
    let end = Math.min(maxCharacters, side.source.length);
    if (end > 0 && end < side.source.length && /[\uD800-\uDBFF]/u.test(side.source[end - 1]) && /[\uDC00-\uDFFF]/u.test(side.source[end])) end--;
    return { availability: 'present', path: side.path, blobId: side.blobId,
      sourceRef: { sourceUnitId: side.manifest.sourceUnitId, span: [0, end], coordinateUnit: 'utf16' },
      text: side.source.slice(0, end), omittedCharacters: side.source.length - end };
  };
  return freeze({ historyRoot: history.rootId, episodeId, pairId, beforeSnapshot: episode.parentSnapshot,
    afterSnapshot: episode.afterSnapshot, changeKind: pair.changeKind, correspondence: pair.correspondence,
    before: preview(pair.before), after: preview(pair.after), applicability: 'historicalOnly', execution: 'none' });
};
