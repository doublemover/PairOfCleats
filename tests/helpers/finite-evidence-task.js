import { createHash } from 'node:crypto';
import { createRepositoryAnswerInput } from './repository-answer-input.js';
import { evidenceTaskSourceReference } from '../../src/retrieval/evaluation/tasks/compiler.js';

export const evidenceTaskHash = value => createHash('sha256').update(value).digest('hex');
export const authoredEvidenceTask = (seed = 'one') => {
  const hash = evidenceTaskHash, worldRef = createRepositoryAnswerInput().queryReceipt.world;
  worldRef.repositoryNamespace = 'authored-task-repository-' + seed;
  const sourceSnapshot = [{ path: 'src/main.js', language: 'javascript', text: 'export const main = 42; // ' + seed, availableAt: 10, role: 'source' },
    { path: 'src/alternative.js', language: 'javascript', text: 'export const alternative = true; // ' + seed, availableAt: 10, role: 'source' },
    { path: 'src/helper.js', language: 'javascript', text: 'export const helper = "😀"; // ' + seed, availableAt: 10, role: 'source' }];
  const units = sourceSnapshot.map((source, index) => ({ id: hash('private-oracle-unit-' + index), source: evidenceTaskSourceReference({
    repositoryNamespace: worldRef.repositoryNamespace, ...source, span: [0, source.text.length] }) }));
  return { schemaVersion: 1, spec: { profile: 'finite-source-evidence-v1', problem: 'Select evidence for the declared visible-source task.',
    publicTaskKey: hash('public-' + seed), worldRef, languageProfile: 'authored-javascript-text-no-execution-v1',
    environmentId: hash('environment'), dependencyLockId: hash('dependency-lock'), cutoffAt: 20, taskAvailableAt: 10,
    historyRegime: 'declared-base-only', allowedActions: ['inspect-visible-source', 'search-visible-source'],
    limits: { maxEvidenceSpans: 32, maxSelectedSourceBytes: 1048576 } }, sourceSnapshot,
  lineage: { repositoryFamilyId: hash('repository-' + seed), cloneFamilyIds: [], issueFixFamilyIds: [], trajectoryFamilyIds: [],
    sourceOriginIds: [hash('origin-' + seed)], synthesisAncestorIds: [] },
  privateOracle: { profile: 'authored-source-interval-coverage-v1', availableAt: 30, labelCoverage: 'complete-in-declared-universe',
    validation: { status: 'authored', receiptIds: [] }, units, alternatives: [
      { id: 'main-plus-helper', groups: [{ id: 'main', require: 1, unitIds: [units[0].id] }, { id: 'helper', require: 1, unitIds: [units[2].id] }] },
      { id: 'alternative', groups: [{ id: 'other', require: 1, unitIds: [units[1].id] }] }], noLocalAnswer: 'not-applicable' } };
};
