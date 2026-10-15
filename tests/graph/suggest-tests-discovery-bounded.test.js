import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSuggestTestsReport } from '../../src/graph/suggest-tests.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bounded-test-discovery-'));
const originalOpen = fs.opendirSync;
const originalRead = fs.readdirSync;
let opens = 0;
let reads = 0;
let active = 0;
const write = (relative) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'test');
};
try {
  write('app.test.js');
  for (let i = 0; i < 200; i += 1) {
    write(`tests/dir-${i}/app.test.js`);
  }
  fs.opendirSync = (...args) => {
    opens += 1;
    active += 1;
    const directory = originalOpen(...args);
    const read = directory.readSync.bind(directory);
    const close = directory.closeSync.bind(directory);
    directory.readSync = () => { reads += 1; return read(); };
    directory.closeSync = () => { active -= 1; return close(); };
    return directory;
  };
  fs.readdirSync = () => { throw new Error('Discovery must not materialize a whole directory'); };
  const build = (options = {}) => {
    opens = 0;
    reads = 0;
    const report = buildSuggestTestsReport({
      repoRoot: root, changed: ['src/app.js'], indexSignature: 'generation-1',
      caps: { maxCandidates: 1 }, now: () => '2026-10-12T00:00:00.000Z', ...options
    });
    assert.ok(opens <= 64, `directory opens must be bounded: ${opens}`);
    assert.ok(reads <= 128, `stream reads must be bounded: ${reads}`);
    assert.equal(active, 0, 'all directory streams must close');
    assert.ok(report.suggestions.length <= 1, 'retained candidates must be bounded');
    assert.equal(report.fidelity.graph.candidateTruncated, true);
    assert.equal(report.truncation.find((row) => row.cap === 'maxCandidates').omitted, null);
    return report;
  };
  const cold = build();
  assert.equal(cold.suggestions[0].testPath, 'app.test.js');
  assert.deepEqual(build(), cold, 'warm cache must retain bounded discovery and fidelity');
  fs.unlinkSync(path.join(root, 'app.test.js'));
  write('app-new.test.js');
  const refreshed = build();
  assert.equal(refreshed.suggestions[0].testPath, 'app-new.test.js', 'same-generation edits must be live');
  assert.deepEqual(build().truncation, refreshed.truncation);
  assert.equal(build({ indexSignature: 'generation-2' }).suggestions[0].testPath, 'app-new.test.js');
  // A broad directory with no matching files must also stop, rather than scan
  // indefinitely while waiting for the first candidate.
  fs.unlinkSync(path.join(root, 'app-new.test.js'));
  assert.equal(build({ testPatterns: ['missing/**/*.js'] }).suggestions.length, 0);
  assert.equal(build({ caps: { maxCandidates: 0 } }).suggestions.length, 0);

  // Legal directory iteration orders must produce the same partial result.
  // Sorting a bounded prefix alone would select different files here.
  const wideFiles = Array.from({ length: 100 }, (_, i) => ({
    name: `app-${String(i).padStart(3, '0')}.test.js`, directory: false
  }));
  const runOrder = (inventory, reverse) => {
    const visited = [];
    fs.opendirSync = (directoryPath) => {
      opens += 1;
      active += 1;
      const relative = path.relative(root, directoryPath);
      visited.push(relative);
      const entries = [...inventory.get(relative)];
      if (reverse) entries.reverse();
      return {
        readSync: () => {
          reads += 1;
          const entry = entries.shift();
          return entry ? {
            name: entry.name,
            isFile: () => !entry.directory,
            isDirectory: () => entry.directory
          } : null;
        },
        closeSync: () => { active -= 1; }
      };
    };
    return { report: build(), visited };
  };
  const flatInventory = new Map([['', wideFiles]]);
  const flatForward = runOrder(flatInventory, false);
  assert.deepEqual(runOrder(flatInventory, true), flatForward);
  assert.deepEqual(flatForward.report.suggestions, [], 'partial directories must not admit candidates');

  const nestedInventory = new Map([
    ['', [{ name: 'app.test.js', directory: false }, { name: 'wide', directory: true }]],
    ['wide', wideFiles]
  ]);
  const nestedForward = runOrder(nestedInventory, false);
  assert.deepEqual(runOrder(nestedInventory, true), nestedForward);
  assert.equal(nestedForward.report.suggestions[0].testPath, 'app.test.js',
    'partial child discovery must preserve candidates from complete parent inventories');

  const mixedInventory = new Map([['', wideFiles.map((entry, i) => ({
    ...entry, directory: i % 2 === 0
  }))]]);
  const mixedForward = runOrder(mixedInventory, false);
  assert.deepEqual(runOrder(mixedInventory, true), mixedForward);
  assert.deepEqual(mixedForward.visited, [''], 'partial directories must not queue any child traversal');
  assert.deepEqual(mixedForward.report.suggestions, []);
} finally {
  fs.opendirSync = originalOpen;
  fs.readdirSync = originalRead;
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('suggest tests bounded live discovery test passed');
