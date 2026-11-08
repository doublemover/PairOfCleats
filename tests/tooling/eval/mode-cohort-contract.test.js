#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveEvaluationCohorts, selectEvaluationCohort } from '../../../tools/eval/cohorts.js';
for (const mode of ['code', 'records', 'extracted-prose']) assert.deepEqual(resolveEvaluationCohorts(mode).modes, [mode]);
assert.deepEqual(resolveEvaluationCohorts('prose').modes, ['prose', 'extracted-prose']);
assert.deepEqual(resolveEvaluationCohorts(null).modes, ['code', 'prose', 'extracted-prose']);
assert.equal(resolveEvaluationCohorts('all').modes.length, 4);
assert.throws(() => resolveEvaluationCohorts('all', [{ file: 'ambiguous.js' }]), /explicit mode/);
assert.doesNotThrow(() => resolveEvaluationCohorts('all', [{ mode: 'records', file: 'r.md' }]));
assert.deepEqual(selectEvaluationCohort({ records: [{ id: 1 }] }, 'records'), [{ id: 1 }]);
assert.deepEqual(selectEvaluationCohort({ extractedProse: [{ id: 2 }] }, 'extracted-prose'), [{ id: 2 }]);
