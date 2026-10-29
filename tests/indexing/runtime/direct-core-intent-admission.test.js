import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { parseBuildArgs } from '../../../src/index/build/args.js';
import { normalizeIndexBuildStage } from '../../../src/shared/indexing/stages.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
let stages = 0, runtimes = 0;
globalThis.__coreIntentAdmissions = { stage() { stages++; throw new Error('stage admitted'); }, runtime() { runtimes++; throw new Error('runtime admitted'); } };
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/src/integrations/core/build-index/stages.js')) return { format: 'module', shortCircuit: true,
    source: `export const runStage=()=>globalThis.__coreIntentAdmissions.stage();
      export const runEmbeddingsStage=runStage;export const runSqliteStage=runStage;` };
  if (url.endsWith('/src/index/build/runtime.js')) return { format: 'module', shortCircuit: true,
    source: 'export const createBuildRuntime=()=>globalThis.__coreIntentAdmissions.runtime();' };
  return next(url, context);
} });
try {
  const { buildIndex } = await import('../../../src/integrations/core/build-index/index.js');
  for (const options of [{ stage: '' }, { stage: 'stage5' }, { mode: '' }, { mode: 'cod' }, { quality: '' }, { quality: 'fas' },
    { _: ['status'] }, { modes: ['code', 'wrong'] }]) {
    await assert.rejects(buildIndex('must-not-be-resolved', options), { code: 'ERR_BUILD_ARG_VALIDATION' });
  }
  assert.equal(stages, 0); assert.equal(runtimes, 0);
  for (const stage of ['1', '2', '3', '4', 'stage1', 'stage2', 'stage3', 'stage4', 'sparse', 'enrich', 'full', 'embed', 'embeddings', 'sqlite', 'ann']) {
    const { argv } = parseBuildArgs(['--stage', stage, '--mode', 'code']);
    assert.equal(normalizeIndexBuildStage(argv.stage), normalizeIndexBuildStage(stage));
  }
  assert.equal(parseBuildArgs([]).argv.stage, undefined, 'ordinary option-only no-stage intent remains valid');
  for (const name of ['stage', 'mode', 'quality']) for (const args of [['--' + name], ['--' + name + '=']]) {
    assert.throws(() => parseBuildArgs(args), { code: 'ERR_BUILD_ARG_VALIDATION' });
  }
} finally { hook.deregister(); delete globalThis.__coreIntentAdmissions; }
console.log('Direct core invalid intent stops before runtime/stage admission and documented aliases remain valid.');
