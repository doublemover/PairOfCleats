import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runNode as runNodeFixture } from '../../helpers/run-node.js';
import { SEARCH_OPTIONS } from '../../../src/retrieval/cli-options.js';
import { parseSearchArgs } from '../../../src/retrieval/cli-args.js';
import { collectSearchOptionFlags } from '../../../tools/docs/search-option-inventory.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('search-option-inventory');
const env = applyTestEnv({ syncProcess: false });
const flags = collectSearchOptionFlags();
assert.ok(flags.size > 100, 'canonical definitions cannot collapse to an importer alias');
for (const flag of ['--repo', '--top', '--json', '--cursor', '--help', '-h', '-n', '--n']) assert.ok(flags.has(flag), flag);
assert.equal(parseSearchArgs(['-n', '7']).top, 7);
assert.equal(parseSearchArgs(['--n', '8']).top, 8);
assert.throws(() => collectSearchOptionFlags({}), { code: 'ERR_SEARCH_OPTION_INVENTORY' });
assert.throws(() => collectSearchOptionFlags(null), { code: 'ERR_SEARCH_OPTION_INVENTORY' });
assert.ok(collectSearchOptionFlags({ ...SEARCH_OPTIONS, 'added-option': { type: 'string' } }).has('--added-option'));
const { cursor, ...withoutCursor } = SEARCH_OPTIONS;
assert.ok(cursor);
assert.equal(collectSearchOptionFlags(withoutCursor).has('--cursor'), false);
const fixture = path.join(dir, 'docs-root');
const files = ['docs/contracts/search-cli.md', 'docs/contracts/search-contract.md',
  'docs/contracts/artifact-schemas.md', 'docs/testing/test-runner-interface.md',
  'docs/testing/test-decomposition-regrouping.md', 'src/retrieval/pipeline.js', 'tests/run.rules.jsonc'];
try {
  for (const file of files) {
    const target = path.join(fixture, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(file, target);
  }
  // Documentation roots cannot inject executable source into this checker.
  await fs.writeFile(path.join(fixture, 'src/retrieval/cli-args.js'), 'const options = {};');
  await fs.writeFile(path.join(fixture, 'src/retrieval/cli-options.js'), 'throw new Error("must not execute docs-root source");');
  let sequence = 0;
  const run = async () => {
    const output = path.join(dir, `result-${++sequence}.json`);
    const result = runNodeFixture(['tools/docs/contract-drift.js', '--root', fixture, '--fail',
      '--out-json', output, '--out-md', path.join(dir, `result-${sequence}.md`)], 'isolated Node fixture', process.cwd(), process.env, { allowFailure: true, spawnOptions: { env, encoding: 'utf8', timeout: 5000 } });
    assert.ifError(result.error);
    return { result, report: JSON.parse(await fs.readFile(output, 'utf8')) };
  };
  const good = await run();
  assert.equal(good.result.status, 0, good.result.stderr);
  assert.equal(good.report.checks.searchCliFlags.sourceCount, flags.size);
  const doc = path.join(fixture, 'docs/contracts/search-cli.md');
  const original = await fs.readFile(doc, 'utf8');
  await fs.writeFile(doc, original.replaceAll('--cursor', 'cursor'));
  const removed = await run();
  assert.equal(removed.result.status, 1);
  assert.deepEqual(removed.report.checks.searchCliFlags.missingInDocs, ['--cursor']);
  await fs.writeFile(doc, original + '\n- `--invented-option`: invalid doc control.\n');
  const added = await run();
  assert.equal(added.result.status, 1);
  assert.deepEqual(added.report.checks.searchCliFlags.extraInDocs, ['--invented-option']);
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('canonical search options/aliases retain exact drift and reject empty inventories without executing docs-root source');
