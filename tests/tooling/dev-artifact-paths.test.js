import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveDevelopmentArtifactPath } from '../../tools/shared/dev-artifacts.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

const root = process.cwd();
const expected = {
  'test-cache': ['tests', 'cache'],
  'test-coverage': ['tests', 'coverage'],
  'bench-cache': ['benchmarks'],
  'ci-cache': ['ci', 'cache'],
  'ci-home': ['ci', 'home']
};
for (const [category, suffix] of Object.entries(expected)) {
  const base = path.join(root, 'temp', 'dev', ...suffix);
  assert.equal(resolveDevelopmentArtifactPath(root, category, 'fixture', 'input.js'),
    path.join(base, 'fixture', 'input.js'));
  assert.throws(() => resolveDevelopmentArtifactPath(root, category, '..', '..', '..', 'outside'),
    /stay inside/);
  assert.throws(() => resolveDevelopmentArtifactPath(root, category, path.resolve(root, 'outside')),
    /stay inside/);
}
assert.throws(() => resolveDevelopmentArtifactPath(root, 'unknown'), /Unknown/);
assert.equal(resolveTestCachePath(root, 'fixture'),
  path.join(root, 'temp', 'dev', 'tests', 'cache', 'fixture'));

const generated = ['temp/dev/tests/cache/probe.js', 'temp/dev/tests/coverage/probe.json',
  'temp/dev/benchmarks/probe.json', '.testLogs/probe.log', '.tmp/probe.tmp',
  '.cache/probe.js', '.testCache/probe.js', '.benchCache/probe.js', '.c8/probe.json', 'tests/.cache/probe.js',
  '.ci-cache/probe.json', '.ci-home/probe.json'];
const ignored = spawnSync('git', ['check-ignore', '--stdin'], {
  cwd: root, input: generated.join('\n') + '\n', encoding: 'utf8'
});
assert.equal(ignored.status, 0, ignored.stderr);
assert.deepEqual(ignored.stdout.trim().split(/\r?\n/).sort(), [...generated].sort(),
  'all current and legacy development artifact roots must remain ignored');
console.log('Development artifact ownership, containment and Git ignore checks passed');
