import assert from 'node:assert/strict';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { createRetainedChangeHistory, searchRetainedChangeHistory, inspectRetainedChangeEpisode }
  from '../../../src/index/scm/change-episodes/retained.js';
import { projectPrecedentApplicability } from '../../../src/context-pack/task-evidence/precedent-applicability.js';

const base = 'a'.repeat(64), after = 'b'.repeat(64), future = 'c'.repeat(64), otherParent = 'd'.repeat(64);
const source = (path, value) => {
  const snapshot = createSemanticSourceSnapshot({ bytes: Buffer.from(value), repositoryNamespace: 'repo', path, language: 'javascript' });
  return { availability: 'present', path, blobId: snapshot.manifest.byteHash, snapshot };
};
const intent = (id, value, availableAt, observedAt = availableAt) => ({ id, text: value,
  textHash: semanticHash('pairofcleats.original-intent-text.v1', value), availableAt, observedAt, sourceVersion: 'original-' + id });
const pair = { id: 'reader', changeKind: 'modification', correspondence: 'explicit-comparison',
  before: source('reader\nfile.js', 'const limit = 2;'), after: source('reader\nfile.js', 'const limit = override ?? 2;') };
const episode = { afterSnapshot: after, parentSnapshot: base, availableAt: 10, observedAt: 10,
  intent: [intent('old', 'repair retry limit override', 10), intent('late-edit', 'future secret diagnosis', 30)],
  pairs: [pair], outcomes: [
    { id: 'failed', kind: 'failed-observation', evidenceRef: 'run1', environmentId: 'env1', availableAt: 12, observedAt: 12 },
    { id: 'later-pass', kind: 'passed-observation', evidenceRef: 'run2', environmentId: 'env2', availableAt: 30, observedAt: 30 }
  ], links: [] };
const episodes = [episode, { ...episode, afterSnapshot: future, availableAt: 40, observedAt: 40 },
  { ...episode, parentSnapshot: otherParent, intent: [intent('second-parent', 'retry override alternate parent', 10)] }];
const members = episodes.map(row => ({ afterSnapshot: row.afterSnapshot, parentSnapshot: row.parentSnapshot }));
const history = createRetainedChangeHistory({ repositoryNamespace: 'repo', rangeId: 'explicit-three-comparisons',
  members, episodes, coverage: 'complete-admitted-members' });
const request = { history, query: 'retry override', cutoff: 20, allowedAfterSnapshots: new Set([after, future]) };
const result = searchRetainedChangeHistory(request);
assert.equal(result.totalVisibleMatches, 2, 'future comparison is excluded before ranking');
assert.equal(new Set(result.hits.map(row => row.episodeId)).size, 2, 'merge parents remain distinct comparisons');
const found = result.hits.find(row => row.parentSnapshot === base);
assert.deepEqual(found.intent.map(row => row.id), ['old']);
assert.deepEqual(found.outcomes.map(row => row.id), ['failed']);
assert.equal(found.applicability, 'historicalOnly');
assert.equal(searchRetainedChangeHistory({ ...request, query: 'secret' }).hits.length, 0);
assert.equal(searchRetainedChangeHistory({ ...request, allowedAfterSnapshots: new Set() }).hits.length, 0);
const inspected = inspectRetainedChangeEpisode({ ...request, episodeId: found.episodeId, pairId: 'reader' });
assert.equal(inspected.before.text, 'const limit = 2;');
assert.equal(inspected.after.text, 'const limit = override ?? 2;');
assert.equal(inspected.before.path, 'reader\nfile.js');
assert.notEqual(inspected.before.sourceRef.sourceUnitId, inspected.after.sourceRef.sourceUnitId);
const currentWorld = { generation: { baseBuildId: 'current', semanticRevision: 0 } };
const requirement = { id: 'api-condition', predicateId: 'declared-api-version', predicateVersion: 1,
  worldRef: currentWorld, branchId: 'task', assumptionSetId: 'assumptions', arguments: { version: 'v1' },
  quantifierScope: 'named-api', alternatives: [['declaration']], permittedKinds: ['checked-declaration'] };
const observation = { id: 'api-evidence', predicateId: requirement.predicateId, predicateVersion: 1,
  worldRef: currentWorld, branchId: 'task', assumptionSetId: 'assumptions', arguments: requirement.arguments,
  quantifierScope: requirement.quantifierScope, kind: 'checked-declaration', role: 'declaration', polarity: 'supports',
  validity: 'current', admission: 'checked', checkerReceiptId: 'upstream-check', dependencies: [], foundation: true };
const applicability = { ...request, episodeId: found.episodeId, pairId: 'reader', currentWorld, conditions: [requirement] };
assert.equal(projectPrecedentApplicability({ ...applicability, observations: [observation] }).applicability, 'conditionsSupported');
assert.equal(projectPrecedentApplicability({ ...applicability, observations: [{ ...observation, worldRef: { historical: true } }] }).applicability, 'unknown');
assert.equal(projectPrecedentApplicability({ ...applicability, observations: [{ ...observation, polarity: 'refutes' }] }).applicability, 'contradicted');
assert.equal(projectPrecedentApplicability({ ...applicability, observations: [observation], invalidated: ['api-evidence'] }).applicability, 'unknown');
assert.throws(() => inspectRetainedChangeEpisode({ ...request, cutoff: 0, episodeId: found.episodeId, pairId: 'reader' }), /invisible/);
const lateObservation = { ...episode, intent: [intent('backfill', 'hidden diagnosis', 5, 35)] };
const backfill = createRetainedChangeHistory({ repositoryNamespace: 'repo', rangeId: 'backfill', members: members.slice(0, 1),
  episodes: [lateObservation], coverage: 'complete-admitted-members' });
assert.equal(searchRetainedChangeHistory({ ...request, history: backfill, query: 'diagnosis' }).hits.length, 0);
assert.throws(() => createRetainedChangeHistory({ repositoryNamespace: 'repo', rangeId: 'gap', members,
  episodes: [episode], coverage: 'complete-admitted-members' }), /coverage/);
const unavailable = { ...episode, pairs: [{ ...pair, before: { availability: 'unavailable', path: 'reader.js', blobId: base, snapshot: null } }] };
const missingHistory = createRetainedChangeHistory({ repositoryNamespace: 'repo', rangeId: 'missing', members: members.slice(0, 1),
  episodes: [unavailable], coverage: 'complete-admitted-members' });
const missingHit = searchRetainedChangeHistory({ ...request, history: missingHistory }).hits[0];
assert.equal(inspectRetainedChangeEpisode({ ...request, history: missingHistory, episodeId: missingHit.episodeId,
  pairId: 'reader' }).before.availability, 'unavailable');
const absent = { availability: 'absent', path: null, blobId: null, snapshot: null };
const root = { ...episode, parentSnapshot: null, pairs: [{ ...pair, changeKind: 'addition', before: absent }] };
assert.equal(createRetainedChangeHistory({ repositoryNamespace: 'repo', rangeId: 'root',
  members: [{ afterSnapshot: after, parentSnapshot: null }], episodes: [root], coverage: 'complete-admitted-members' }).episodeCount, 1);
pair.after.snapshot.manifest.sourceUnitId = 'su1:' + '0'.repeat(64);
assert.equal(inspectRetainedChangeEpisode({ ...request, episodeId: found.episodeId, pairId: 'reader' }).after.text, 'const limit = override ?? 2;');
assert.throws(() => createRetainedChangeHistory({ repositoryNamespace: 'repo', rangeId: 'forged',
  members: members.slice(0, 1), episodes: [episode], coverage: 'complete-admitted-members' }), /manifest/);
console.log('retained historical precedent contract passed');
