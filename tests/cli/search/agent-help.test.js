import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { getSearchHelp, SEARCH_OPTION_NAMES, parseSearchArgs } from '../../../src/retrieval/cli-args.js';
import { runCli } from '../../../src/retrieval/cli/search-entry.js';
const full = getSearchHelp({ full: true });
assert.deepEqual(Object.keys(full.options), SEARCH_OPTION_NAMES);
assert.equal(full.options.top.default, 5);
assert.match(full.semantics.query, /ANN/);
assert.match(full.semantics.pagination, /not offset/);
assert.match(full.semantics.time, /number of days/);
assert.equal(parseSearchArgs(['symbol', '-n', '2', '--no-ann', '--json']).top, 2);
const chunks = [];
assert.equal(await runCli({ rawArgs: ['--help', '--all', '--json'], stdout: { write: value => chunks.push(value) } }), 0);
assert.deepEqual(JSON.parse(chunks.join('')).options, full.options);
for (const args of [
  ['help', 'search', '--json'], ['help', '--json'], ['history', 'help', '--json'],
  ['history', 'help', '--all', '--json'], ['search', '--help', '--all', '--json']
]) {
  const result = spawnSync(process.execPath, ['bin/pairofcleats.js', ...args], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 1048576, windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).version);
}
const unknown = spawnSync(process.execPath, ['bin/pairofcleats.js', 'help', 'not-a-command', '--json'],
  { encoding: 'utf8', timeout: 10000, windowsHide: true });
assert.equal(unknown.status, 1);
assert.equal(JSON.parse(unknown.stdout).ok, false);
console.log('agent help discovery tests passed');
