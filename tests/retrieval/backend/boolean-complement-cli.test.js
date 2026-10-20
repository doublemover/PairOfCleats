import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';

const backends = ['memory', 'sqlite', 'sqlite-fts'];
assert.deepEqual(JSON.parse(await fs.readFile(new URL('./boolean-complement-cli.test.js.cases.json', import.meta.url))),
  { schemaVersion: 1, cases: backends });
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('retrieval/backend/boolean-complement-cli/')[1];
assert.ok(backends.includes(selected), 'run an independently bounded backend case');
const root = process.cwd();
const { dir } = await prepareIsolatedTestCacheDir(`boolean-complement-${selected}`);
const repo = path.join(dir, 'repo');
await fs.mkdir(repo);
const sources = { 'alpha.txt': 'alpha beta', 'alpha-gamma.txt': 'alpha gamma',
  'beta.txt': 'beta epsilon', 'unrelated.txt': 'unrelated' };
for (const [file, text] of Object.entries(sources)) await fs.writeFile(path.join(repo, file), `${text}\n`);
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub',
  testConfig: {
    indexing: { scm: { provider: 'none' }, typeInference: false, typeInferenceCrossFile: false,
      riskAnalysis: false, riskAnalysisCrossFile: false },
    tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
  },
  extraEnv: { PAIROFCLEATS_THREADS: '1', PAIROFCLEATS_BUNDLE_THREADS: '1' }
});
runNode([path.join(root, 'build_index.js'), '--repo', repo, '--mode', 'prose', '--stage', 'stage1',
  '--stub-embeddings', '--scm-provider', 'none'], 'Boolean fixture build', root, env,
{ stdio: 'pipe', timeoutMs: 30000 });
if (selected !== 'memory') await runSqliteBuild(repo, { env, mode: 'prose' });
const search = (query, args = [], failure = false) => {
  const result = runNode([path.join(root, 'search.js'), query, '--repo', repo, '--mode', 'prose',
    '--backend', selected, '--no-ann', '--json', '--top', '20', ...args],
  `Boolean ${selected}: ${query}`, root, env, { stdio: 'pipe', timeoutMs: 30000, allowFailure: failure });
  if (failure) return result;
  const warnings = selected === 'memory'
    ? '[search] prose index enrichment pending (stage1).\n[search] extracted-prose index enrichment pending (stage1).\n' : '';
  assert.equal(result.stderr, warnings, 'only the explicitly expected stage1 warnings are admitted');
  return JSON.parse(result.stdout).prose.map(hit => path.basename(hit.file)).sort();
};
assert.deepEqual(search('alpha', ['--ext', 'txt']), ['alpha-gamma.txt', 'alpha.txt'],
  'positive control proves the structured filter admits the source files');
for (const state of ['cold', 'warm']) {
  assert.deepEqual(search('alpha OR NOT gamma', ['--ext', 'txt']), Object.keys(sources).sort(),
    `${state}: a structured filter cannot turn a branch-local exclusion into a global NOT`);
  assert.deepEqual(search('NOT gamma'), ['alpha.txt', 'beta.txt', 'unrelated.txt'],
    `${state}: negative-only queries return admitted complement rows`);
}
assert.deepEqual(search('alpha OR NOT gamma', ['--file', 'alpha-gamma.txt']), ['alpha-gamma.txt'],
  'a restrictive file filter still applies independently of the Boolean branches');
assert.deepEqual(search('alpha AND NOT gamma', ['--ext', 'txt']), ['alpha.txt'],
  'mandatory exclusions remain enforced with structured filters');
assert.deepEqual(search('NOT (alpha AND gamma)', [], true).status === 0, false,
  'compound negation remains an invalid public query');
console.log(`Boolean complement CLI ${selected} passed (fresh index, cold and warm queries)`);
