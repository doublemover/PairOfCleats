import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { buildIndex } from '../../src/integrations/core/build-index.js';
import { getIndexDir } from '../../src/shared/repo-paths.js';
import { loadJsonArrayArtifactRows } from '../../src/shared/artifact-io/loaders.js';
import { runImpactCli } from '../../src/integrations/tooling/impact.js';
import { runSuggestTestsCli } from '../../src/integrations/tooling/suggest-tests.js';
import { validateGraphImpact } from '../../src/contracts/validators/analysis.js';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('graph/impact-indexed-source-cli/')[1];
assert.ok(['calls', 'imports'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`impact-indexed-cli-${selected}`);
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
const sources = selected === 'calls' ? {
  'chain.js': 'export function helper() { return 1; }\nexport function api() { return helper(); }\nexport function consumer() { return api(); }\nexport function isolated() { return 0; }\n'
} : {
  'src/utility.js': 'export const value = 1;\n',
  'src/module.js': 'import { value } from "./utility.js";\nexport const api = value;\n',
  'tests/consumer.test.js': 'import { api } from "../src/module.js";\nexport const observed = api;\n',
  'src/isolated.js': 'export const unrelated = 0;\n'
};
for (const [file, text] of Object.entries(sources)) {
  await fs.mkdir(path.dirname(path.join(repo, file)), { recursive: true }); await fs.writeFile(path.join(repo, file), text);
}
await fs.writeFile(path.join(repo, 'tsconfig.json'), JSON.stringify({ compilerOptions: { types: [], lib: ['es5'] } }));
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', testConfig: {
  threads: 1, extraIgnore: ['tsconfig.json'], indexing: { scm: { provider: 'none' }, semantic: { enabled: true,
    enrichment: { bindings: 'eager', localFlow: 'off', crossFileFlow: 'off' } }, embeddings: { enabled: false },
  typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
} });
const output = [], originalLog = console.log;
try {
  await buildIndex(repo, { mode: 'code', stage: 'stage2', threads: 1, log: () => {} });
  const chunks = [];
  for await (const row of loadJsonArrayArtifactRows(getIndexDir(repo, 'code'), 'chunk_meta', { strict: true })) chunks.push(row);
  console.log = value => output.push(value);
  const execute = async (selection, direction, depth, extra = []) => {
    const args = ['--repo', repo, ...selection, '--direction', direction, '--depth', String(depth),
      '--graphs', selected === 'calls' ? 'callGraph' : 'importGraph', '--pathSemantics', 'graph-witness', ...extra, '--json'];
    const result = await runImpactCli(args);
    assert.equal(validateGraphImpact(result).ok, true, JSON.stringify(result));
    assert.deepEqual(JSON.parse(output.at(-1)), JSON.parse(JSON.stringify(result)));
    assert.equal(result.direction, direction);
    assert.equal(result.stats.directionPolicy.traversal, direction === 'downstream' ? 'in' : direction === 'upstream' ? 'out' : 'both');
    return result;
  };
  const identify = row => selected === 'calls' ? chunks.find(chunk => chunk.chunkUid === row.ref.chunkUid)?.name : row.ref.path;
  const observe = result => result.impacted.map(row => [identify(row), row.distance]).sort();
  const selection = name => ['--seed', selected === 'calls'
    ? `chunk:${chunks.find(row => row.name === name)?.chunkUid}` : `file:${name}`];
  const leaf = selected === 'calls' ? 'helper' : 'src/utility.js';
  const middle = selected === 'calls' ? 'api' : 'src/module.js';
  const user = selected === 'calls' ? 'consumer' : 'tests/consumer.test.js';
  const isolated = selected === 'calls' ? 'isolated' : 'src/isolated.js';
  for (const temperature of ['cold', 'warm']) {
    assert.deepEqual(observe(await execute(selection(leaf), 'downstream', 1)), [[middle, 1]], temperature);
    const downstream = await execute(selection(leaf), 'downstream', 2);
    assert.deepEqual(observe(downstream), [[middle, 1], [user, 2]].sort());
    assert.deepEqual(observe(await execute(selection(user), 'upstream', 1)), [[middle, 1]]);
    assert.deepEqual(observe(await execute(selection(user), 'upstream', 2)), [[leaf, 2], [middle, 1]].sort());
    assert.deepEqual(observe(await execute(selection(middle), 'both', 1)), [[leaf, 1], [user, 1]].sort());
    assert.deepEqual(observe(await execute(selection(isolated), 'downstream', 2)), []);
    for (const hit of downstream.impacted) {
      assert.equal(hit.witnessPath.edges.length, hit.distance);
      for (const edge of hit.witnessPath.edges) {
        const endpoints = [edge.from, edge.to].map(ref => selected === 'calls'
          ? chunks.find(chunk => chunk.chunkUid === ref.chunkUid)?.name : ref.path);
        assert.ok([[user, middle], [middle, leaf]].some(pair => JSON.stringify(pair) === JSON.stringify(endpoints)), 'recorded dependency orientation is never rewritten to the reverse traversal');
      }
    }
    if (selected === 'imports') {
      assert.deepEqual(observe(await execute(['--changed', leaf], 'downstream', 2)), observe(downstream));
      const suggested = await runSuggestTestsCli(['--repo', repo, '--changed', leaf, '--max', '10', '--json']);
      assert.equal(suggested.suggestions[0].testPath, user);
    }
  }
  const humanArgs = ['--repo', repo, ...selection(leaf), '--direction', 'downstream', '--depth', '2',
    '--graphs', selected === 'calls' ? 'callGraph' : 'importGraph'];
  await runImpactCli(humanArgs);
  assert.match(output.at(-1), /Direction: downstream\nRecorded traversal: in/);
  const canonicalArgs = [path.resolve('bin/pairofcleats.js'), 'impact', ...humanArgs, '--pathSemantics', 'graph-witness', '--json'];
  const canonical = await spawnSubprocess(process.execPath, canonicalArgs, { cwd: process.cwd(), env,
    timeoutMs: 5000, maxOutputBytes: 256 * 1024, rejectOnNonZeroExit: false });
  assert.equal(canonical.exitCode, 0, canonical.stderr); assert.equal(canonical.stderr, '');
  const emitted = JSON.parse(canonical.stdout); assert.equal(validateGraphImpact(emitted).ok, true);
  assert.deepEqual(observe(emitted), [[middle, 1], [user, 2]].sort());
  assert.equal(emitted.direction, 'downstream'); assert.equal(emitted.stats.directionPolicy.traversal, 'in');
} finally { console.log = originalLog; await fs.rm(dir, { recursive: true, force: true }); }
console.log(`Actual indexed-source impact CLI ${selected} preserves dependency direction and evidence.`);
