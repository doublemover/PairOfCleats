import { createHash } from 'node:crypto';
import { TASK_SPAN_TRACE_VERSION } from '../../src/contracts/schemas/task-span-trace.js';
import { taskTraceSourceKey } from '../../src/retrieval/evaluation/task-span-trace.js';

export const taskTraceFixtureHash = value => createHash('sha256').update(value).digest('hex');
export const TASK_TRACE_FIXTURE_QUERY = 'saved task fixture';
export const makeTaskSpanTrace = ({ repoId = 'repository-a', task = 'task-a', run = 'baseline' } = {}) => {
  const generation = taskTraceFixtureHash(`${repoId}:${run}:generation`);
  const sources = ['first/shared.ts', 'second/shared.ts'].map(file => {
    const original = `${file}:`.padEnd(100, 'x');
    const source = { repoId, mode: 'code', file, contentDigest: taskTraceFixtureHash(original), generation, byteLength: Buffer.byteLength(original) };
    return { key: taskTraceSourceKey(source), ...source };
  });
  const span = (file, start, end) => ({ sourceKey: sources[file].key, generation, start, end, unit: 'utf8-byte' });
  const event = (sequence, stage, value, options = {}) => ({ id: `event-${sequence}`, sequence, stage,
    adapter: 'saved-fixture', status: 'observed', span: value, rank: null, attribution: null, referenceId: null, ...options });
  return { schemaVersion: TASK_SPAN_TRACE_VERSION, kind: 'retrieval-task-span-trace',
    identity: { taskKey: taskTraceFixtureHash(`${repoId}:${task}`), inputKey: taskTraceFixtureHash(`${repoId}:${task}:frozen-input`),
      runKey: taskTraceFixtureHash(`${repoId}:${task}:${run}`), repoId, familyId: repoId, generation,
      queryDigest: taskTraceFixtureHash(TASK_TRACE_FIXTURE_QUERY) }, status: 'complete', terminalSequence: 7, outcome: 'succeeded', sources,
    judgmentPolicyKey: taskTraceFixtureHash('independent-fixture-overlap-and-atomic-label-rubric-v1'),
    stages: { retrieved: 'complete', explored: 'complete', delivered: 'complete', used: 'complete' },
    events: [event(0, 'retrieved', span(0, 0, 10), { rank: 1 }), event(1, 'retrieved', span(0, 5, 20), { rank: 2 }),
      event(2, 'retrieved', span(0, 0, 10), { rank: 3 }), event(3, 'explored', span(1, 0, 10)),
      event(4, 'delivered', span(0, 0, 8)), event(5, 'delivered', span(0, 5, 10)),
      event(6, 'used', span(0, 0, 5), { attribution: 'claim', referenceId: 'claim-a' })],
    gold: [span(0, 0, 20), span(1, 0, 20)],
    claims: [{ id: 'claim-a', statementDigest: taskTraceFixtureHash('independently labeled atomic statement'), citations: [span(0, 0, 5)],
      label: 'supported', judge: { kind: 'human', identityKey: taskTraceFixtureHash('fixture-labeler-and-policy') } }] };
};
