import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { initGitRepo } from '../../helpers/git-fixture.js';
import { runNode } from '../../helpers/run-node.js';
import { loadQueue } from '../../../tools/service/queue.js';

const { dir } = await prepareIsolatedTestCacheDir('service-embedding-queue-ownership');
const repoRoot = path.join(dir, 'repo');
await fs.mkdir(repoRoot);
initGitRepo(repoRoot);
await fs.writeFile(path.join(repoRoot, 'source.js'), 'export function sum(a, b) { return a + b; }\n');
try {
  for (const stage of [null, 'stage2']) {
    const cacheRoot = path.join(dir, stage || 'full'), queueDir = path.join(cacheRoot, 'queue');
    const config = { threads: 1, cache: { root: cacheRoot },
      indexing: { twoStage: { enabled: false, stage2: { embeddings: { enabled: true, mode: 'service' } } },
        typeInference: false, typeInferenceCrossFile: false,
        embeddings: { enabled: true, mode: 'service', queue: { dir: queueDir },
          hnsw: { enabled: false }, lancedb: { enabled: false } } },
      tooling: { autoEnableOnDetect: false, lsp: { enabled: false } },
      sqlite: { use: false }, lmdb: { use: false } };
    const env = ensureTestingEnv(Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !/^pairofcleats_/i.test(key))));
    env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
    env.PAIROFCLEATS_TEST_CONFIG = JSON.stringify(config);
    const result = runNode([path.join(process.cwd(), 'build_index.js'), '--repo', repoRoot,
      '--mode', 'code', '--progress', 'log', '--json', ...(stage ? ['--stage', stage] : [])],
    `${stage || 'full'} service queue owner`, repoRoot, env, { stdio: 'pipe', allowFailure: true });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    const outcome = JSON.parse(result.stdout.trim());
    const jobs = (await loadQueue(queueDir, 'embeddings')).jobs;
    assert.equal(jobs.length, 1, `${stage || 'full'} must admit one job for its one completed mode: ${output}`);
    const job = jobs[0], generation = outcome.generations.find(value => value.modes?.includes('code'));
    assert.equal(job.buildRoot, generation.buildRoot);
    assert.equal(job.mode, 'code');
    assert.equal(path.relative(job.embeddingPlan.indexRoot, generation.buildRoot), '',
      'the plan retains this generation under the platform filesystem case rules');
    assert.equal(job.embeddingPayloadFormatVersion, 3);
    if (!stage) {
      assert.equal(outcome.status, 'pending');
      assert.equal(outcome.stages.find(value => value.stage === 'stage3').status, 'pending');
    }
  }
} finally {
  const relative = path.relative(path.join(process.cwd(), '.tmp'), dir);
  assert.ok(relative && !path.isAbsolute(relative) && !relative.split(path.sep).includes('..'));
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Full and explicit Stage2 builds retain exactly one generation-bound service queue owner');
