import { authoredEvidenceTask, evidenceTaskHash as hash } from './finite-evidence-task.js';
import { compileEvidenceTask, inspectEvidenceTaskCompilation, evidenceTaskSourceReference } from '../../src/retrieval/evaluation/tasks/compiler.js';
import { assignEvidenceTaskSplits } from '../../src/retrieval/evaluation/tasks/splits.js';
import { compileEvidenceTaskJudgments } from '../../src/retrieval/evaluation/tasks/judgments.js';

export const retrievalTrainingFixture = ({ seeds = ['first', 'second'], split = 'train', alter = null } = {}) => {
  const inputs = seeds.map(seed => {
    const input = authoredEvidenceTask(seed);
    input.sourceSnapshot.push({ path: 'src/rejected.js', language: 'javascript', text: 'export const wrong = "reviewed counterexample ' + seed + '";', availableAt: 10, role: 'source' },
      { path: 'src/unreviewed.js', language: 'javascript', text: 'export const unknown = "' + seed + '";', availableAt: 10, role: 'source' },
      { ...input.sourceSnapshot[0], path: 'src/renamed-main.js' }); return input;
  });
  const tasks = inputs.map(input => compileEvidenceTask(input));
  const policy = { schemaVersion: 1, seed: 'training-fixture', train: 0, dev: 0, calibration: 0, test: 0, [split]: 10000 };
  const manifest = assignEvidenceTaskSplits(tasks, policy);
  const packets = inputs.map((input, index) => {
    const report = inspectEvidenceTaskCompilation(tasks[index]);
    const refs = input.sourceSnapshot.map(source => evidenceTaskSourceReference({ repositoryNamespace: input.spec.worldRef.repositoryNamespace,
      ...source, span: [0, source.text.length] }));
    const row = (i, label, grade, weight, basis) => ({ source: refs[i], label, grade, weight, basis, receiptIds: [hash('explicit-review-' + i)] });
    return { schemaVersion: 1, profile: 'authored-source-relevance-v1', compilationId: report.compilationId, privateOracleId: report.privateOracleId,
      splitManifestId: manifest.manifestId, requirementId: input.spec.publicTaskKey, rawQueryHash: hash(input.spec.problem),
      producerId: hash('fixture-author'), assumptionsId: hash('finite-authored-model'), rightsScopeId: hash('fixture-only'), reviewReceiptIds: [hash('review')],
      judgments: [row(0, 'positive', 3, 1, 'explicit-task-relevance-annotation'), row(1, 'positive', 1, 1, 'explicit-task-relevance-annotation'),
        row(3, 'verified-negative', 0, 1, 'named-requirement-counterexample'), row(4, 'unknown', 0, 0, 'unknown'), row(5, 'unknown', 0, 0, 'unknown')],
      positiveAliases: [{ left: refs[0], right: refs[5], reviewReceiptIds: [hash('rename-review')] }] };
  });
  if (alter) alter({ inputs, tasks, manifest, packets });
  const judgments = tasks.map((task, index) => compileEvidenceTaskJudgments({ task, manifest, input: packets[index] }));
  return { inputs, tasks, manifest, packets, judgments };
};
