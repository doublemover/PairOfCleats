import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { initGitRepo } from '../../helpers/git-fixture.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { resolveCompareModelCacheRoot } from '../../../src/experimental/compare/config.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/reports/compare-models-partial-ranks/')[1];
assert.ok(['opposite-orders', 'one-common'].includes(selected));
const root = process.cwd(), { dir } = await prepareIsolatedTestCacheDir(`model-partial-ranks-${selected}`);
const repo = path.join(dir, 'repo'), cacheRootBase = path.join(dir, 'model-caches');
await fs.mkdir(path.join(repo, 'src'), { recursive: true }); initGitRepo(repo);
await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{"threads":1}\n');
const models = ['explicit-fixture-baseline', 'explicit-fixture-candidate'];
const env = applyTestEnv({ cacheRoot: cacheRootBase, embeddings: 'stub', extraEnv: {
  PAIROFCLEATS_TRUSTED_CONFIG: null
} });
const source = 'export function alphaBetaGamma() {}\n';
const fileHash = createHash('sha1').update(source).digest('hex');
const rows = Array.from({ length: 20 }, (_, id) => ({ id, file: `src/part-${id}.js`, fileHash,
  chunkUid: `fixture:${id}`, name: `part${id}`, kind: 'FunctionDeclaration',
  start: 0, end: Buffer.byteLength(source), startLine: 1, endLine: 1 }));
for (const row of rows) await fs.writeFile(path.join(repo, row.file), source);
for (const [modelIndex, modelId] of models.entries()) {
  const modelCache = resolveCompareModelCacheRoot({ modelId, cacheRootBase });
  await withTemporaryEnv({ ...env, PAIROFCLEATS_CACHE_ROOT: modelCache, PAIROFCLEATS_MODEL: modelId }, async () => {
    const indexDir = getIndexDir(repo, 'code', loadUserConfig(repo));
    await createCompatibilityIndex(path.dirname(indexDir), { directory: path.basename(indexDir),
      compatibilityKey: 'explicit-model-ranking-fixture', profileId: 'default', buildId: 'controlled-ranking-fixture' });
    const vocab = ['alpha', 'beta', 'gamma'];
    const postings = vocab.map(query => {
      const ids = modelIndex === 0 ? Array.from({ length: 10 }, (_, id) => id)
        : query === 'gamma' ? [0, ...Array.from({ length: 9 }, (_, id) => id + 10)]
          : [0, 1, ...Array.from({ length: 8 }, (_, id) => id + 10)];
      return ids.map(id => [id, modelIndex === 0 ? (id < 2 ? 30 - id : 10)
        : id >= 10 ? 30 : query === 'beta' ? id + 1 : 2 - id]);
    });
    await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(rows.map(row => ({
      ...row, tokens: vocab.filter((_, index) => postings[index].some(([id]) => id === row.id))
    }))));
    await fs.writeFile(path.join(indexDir, 'token_postings.json'), JSON.stringify({
      vocab, postings, docLengths: rows.map(() => 100),
      avgDocLen: 100, totalDocs: rows.length
    }));
  });
}
const queries = path.join(dir, 'queries.txt'), out = path.join(dir, 'report.json');
const queryList = selected === 'opposite-orders' ? ['alpha', 'beta'] : ['gamma'];
await fs.writeFile(queries, queryList.join('\n') + '\n');
const result = await spawnSubprocess(process.execPath, [path.join(root, 'tools/reports/compare-models.js'),
  '--repo', repo, '--cache-root', cacheRootBase, '--models', models.join(','), '--baseline', models[0],
  '--mode', 'code', '--backend', 'memory', '--no-ann', '--stub-embeddings', '--queries', queries,
  '--top', '10', '--limit', String(queryList.length), '--out', out, '--json'], {
  cwd: root, env, timeoutMs: 15000, maxOutputBytes: 128 * 1024, rejectOnNonZeroExit: false
});
await fs.writeFile(path.join(dir, 'command-receipt.json'), JSON.stringify(result, null, 2));
assert.equal(result.exitCode, 0, result.stderr);
assert.equal(result.stderr, '');
const report = JSON.parse(await fs.readFile(out, 'utf8'));
assert.deepEqual(report.warnings, []);
assert.ok(report.results.every(row => Object.values(row.runs).every(run => run.codeCount === 10)),
  'both real search children must return ten controlled sparse hits for every query');
const correlations = report.results.map(row => row.comparisons[models[1]].code.rankCorr);
console.log(JSON.stringify({ selected, correlations, summary: report.summary.comparisons[models[1]], dir }));
assert.deepEqual(correlations, selected === 'opposite-orders' ? [1, -1] : [null],
  'the actual report evaluates shifted/reversed/one-common sparse hit lists');
assert.equal(report.summary.comparisons[models[1]].code.rankCorrAvg, selected === 'opposite-orders' ? 0 : null,
  'only defined common-order correlations contribute to the real report average');
assert.equal(report.summary.comparisons[models[1]].prose, null);
assert.ok(report.results.every(row => row.comparisons[models[1]].code.overlap < 1));
