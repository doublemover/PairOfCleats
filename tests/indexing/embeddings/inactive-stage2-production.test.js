import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/build-index/index.js';
import { getIndexDir, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { __setAdapterFactoryForTests } from '../../../src/shared/embedding-adapter.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';

const { dir } = await prepareIsolatedTestCacheDir('inactive-stage2-production');
const model = 'onnx-community/embeddinggemma-2-ONNX';
let creations = 0;
__setAdapterFactoryForTests(() => { creations++; throw new Error('inactive model acquisition is forbidden'); });
try {
  for (const environmentOff of [false, true]) {
    const repo = path.join(dir, String(environmentOff)), models = path.join(repo, 'unused-models');
    await fs.mkdir(repo); await fs.writeFile(path.join(repo, 'source.js'), 'export const recoveredSparseValue = 42;\n');
    applyTestEnv({ cacheRoot: path.join(dir, 'cache-' + environmentOff), embeddings: environmentOff ? 'off' : null,
      extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null },
      testConfig: createFastIndexingTestConfig({ threads: 1, models: { id: model, dir: models }, sqlite: { use: false }, lmdb: { use: false },
        indexing: { workerPool: { enabled: false }, embeddings: { provider: 'onnx', normalize: false, mode: 'inline' },
          ...(environmentOff ? { twoStage: { stage2: { embeddings: { enabled: true, mode: 'inline' } } } } : {}) } }) });
    const result = await buildIndex(repo, { mode: 'code', stage: 'stage2', sqlite: false, progress: 'off' });
    assert.ok(result.buildRoot); assert.equal(creations, 0);
    const config = loadUserConfig(repo), indexDir = getIndexDir(repo, 'code', config);
    const state = JSON.parse(await fs.readFile(path.join(indexDir, 'index_state.json')));
    assert.equal(state.embeddings.enabled, false); assert.equal(state.embeddings.ready, false);
    assert.equal(state.embeddings.embeddingIdentity.modelArtifact, null);
    await assert.rejects(fs.stat(models), { code: 'ENOENT' }, 'inactive execution cannot create a model destination');
    const validation = await validateIndexArtifacts({ root: repo, userConfig: config, modes: ['code'], sqliteEnabled: false, lmdbEnabled: false });
    assert.equal(validation.ok, true, validation.issues.join('; '));
    if (!environmentOff) {
      await assert.rejects(buildIndex(repo, { mode: 'code', stage: 'stage3', sqlite: false, model, progress: 'off' }),
        /requires the xenova/u, 'the same incompatible requested lane must reject when Stage3 activates it');
      assert.equal(creations, 0);
    }
  }
} finally { __setAdapterFactoryForTests(null); await fs.rm(dir, { recursive: true, force: true }); }
console.log('Real Stage2 and environment-off sparse recovery defer inactive model execution and do not advertise dense readiness.');
