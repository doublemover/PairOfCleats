import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTuiSearchSession } from '../../tools/tui/operator/search.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';
import { getTrackedSubprocessCount } from '../../src/shared/subprocess/tracking.js';
import { killProcessTree } from '../../src/shared/kill-tree.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tui/operator-search-lifecycle/')[1];
assert.ok(['cancel', 'supersede', 'dispose', 'invalid-output', 'truncated-output', 'stderr-flood'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`operator-search-lifecycle-${selected}`);
const repo = path.join(dir, 'repository'), fixtureRoot = path.join(dir, 'explicit-fixture-cli');
await fs.mkdir(repo); await fs.mkdir(path.join(fixtureRoot, 'bin'), { recursive: true });
await fs.writeFile(path.join(fixtureRoot, 'package.json'), '{"type":"module"}');
const marker = path.join(dir, 'started.jsonl');
// This is an explicit inert CLI fixture, never installed-server or real-search evidence.
await fs.writeFile(path.join(fixtureRoot, 'bin/pairofcleats.js'), `import fs from 'node:fs';
const query=process.argv.at(-1);
fs.appendFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid,query})+'\\n');
if(query==='slow') { setInterval(()=>{},1000); }
else if(query==='invalid-output') { process.stdout.write('not JSON'); }
else if(query==='truncated-output') { process.stdout.write('x'.repeat(900*1024)); }
else {
  if(query==='stderr-flood') process.stderr.write('x'.repeat(900*1024));
  process.stdout.write(JSON.stringify({code:[{id:0,file:'item.js',name:query,start:0,end:1}],
    prose:[],extractedProse:[],records:[]}));
}\n`);
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, 'cache'),
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo, fixtureRoot]) } });
const session = createTuiSearchSession({ toolRoot: fixtureRoot, env });
const operations = [];
const query = (text, signal) => {
  const operation = session.query({ repoPath: repo, search: { query: text, mode: 'code', backend: 'memory' } }, { signal });
  operations.push(operation); operation.catch(() => {});
  return operation;
};
const started = async () => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    let text = '';
    try { text = await fs.readFile(marker, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const line = text.split('\n').find(Boolean);
    if (line) return JSON.parse(line);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('The explicit fixture CLI did not start within 3s');
};
let child;
try {
  if (['cancel', 'supersede', 'dispose'].includes(selected)) {
    const controller = new AbortController(), old = query('slow', controller.signal);
    child = await started();
    assert.equal(isProcessAlive(child.pid), true, 'cancellation must occur after real child startup');
    if (selected === 'cancel') controller.abort();
    else if (selected === 'dispose') await session.dispose();
    else {
      const replacement = await query('replacement');
      assert.equal(replacement.hits[0].name, 'replacement');
      assert.equal(replacement.hits.length, 1);
      assert.equal(isProcessAlive(child.pid), false);
    }
    await assert.rejects(old, { code: 'ABORT_ERR' });
    assert.equal(isProcessAlive(child.pid), false, 'awaited operation/disposal must reap its actual child');
  } else {
    await assert.rejects(query(selected), { code: 'ERR_TUI_SEARCH_OUTPUT' });
    child = await started();
    assert.equal(isProcessAlive(child.pid), false);
  }
  assert.equal(getTrackedSubprocessCount(), 0, 'completed search operations must release their own process tracking');
} finally {
  await session.dispose();
  await Promise.allSettled(operations);
  if (child && isProcessAlive(child.pid)) await killProcessTree(child.pid, { killTree: true, detached: process.platform !== 'win32', graceMs: 0 });
}
console.log(`Explicit search lifecycle fixture passed: ${selected}`);
