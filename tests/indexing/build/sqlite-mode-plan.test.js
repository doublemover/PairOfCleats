import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveSqliteModePlan } from '../../../src/integrations/core/build-index/stages/sqlite-paths.js';
import { PRIMARY_INDEX_MODES } from '../../../src/integrations/core/build-index/stages/modes.js';

const root = path.resolve('temp/dev/tests/cache/sqlite-mode-plan');
const sameGeneration = PRIMARY_INDEX_MODES.map(mode => ({ mode, indexRoot: root }));
assert.deepEqual(resolveSqliteModePlan(sameGeneration), [{ mode: 'all', indexRoot: root }]);
assert.equal(sameGeneration.length, 4, 'batch planning preserves the concrete authority inputs');
const mixedGenerations = sameGeneration.map(entry => entry.mode === 'prose'
  ? { ...entry, indexRoot: path.join(root, 'other-generation') } : entry);
assert.deepEqual(resolveSqliteModePlan(mixedGenerations), mixedGenerations,
  'separately pinned generations must never be collapsed into one all-mode build');
assert.deepEqual(resolveSqliteModePlan(sameGeneration.slice(0, 2)), sameGeneration.slice(0, 2));
assert.deepEqual(resolveSqliteModePlan([sameGeneration[0], sameGeneration[0]]), [sameGeneration[0], sameGeneration[0]],
  'duplicate or partial mode sets do not stand in for all primary modes');
console.log('SQLite batching follows resolved concrete mode authority');
