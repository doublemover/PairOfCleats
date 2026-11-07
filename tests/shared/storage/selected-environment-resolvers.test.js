import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv, ensureTestingEnv } from '../../helpers/test-env.js';
import { getDefaultCacheRoot, getCacheRootBase, getApplicationHome, getCacheRoot,
  getStorageCategorySelection } from '../../../src/shared/cache-roots.js';
import { getModelsDir } from '../../../tools/dict-utils/paths/cache.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planStorageConfiguration, applyStorageConfiguration } from '../../../src/shared/storage/configuration.js';

const temporary = await makeTempDir('poc-storage-selected-env-');
try {
  const ambientHome = path.join(temporary, 'ambient-home');
  await fs.mkdir(path.join(ambientHome, 'config'), { recursive: true });
  await fs.writeFile(path.join(ambientHome, 'config', 'storage-locations.json'), '{bad ambient locator');
  const home = path.join(temporary, 'selected-home');
  const selectedEnv = { PAIROFCLEATS_HOME: home, LOCALAPPDATA: path.join(temporary, 'selected-local') };
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: ambientHome,
    PAIROFCLEATS_CACHE_ROOT: path.join(temporary, 'ambient-cache'), PAIROFCLEATS_MODELS_DIR: path.join(temporary, 'ambient-models') }), async () => {
    const options = { env: selectedEnv };
    assert.equal(getDefaultCacheRoot(options), path.join(selectedEnv.LOCALAPPDATA, 'PairOfCleats'));
    assert.equal(getDefaultCacheRoot({ env: { XDG_CACHE_HOME: path.join(temporary, 'xdg') } }), path.join(temporary, 'xdg', 'pairofcleats'));
    assert.equal(getCacheRootBase(options), home);
    assert.equal(getApplicationHome(options), home);
    assert.equal(getCacheRoot(options), path.join(home, 'cache'));
    assert.equal(getStorageCategorySelection('models', options), null);
    assert.equal(getModelsDir(temporary, {}, options), path.join(home, 'cache', 'models'));
    const source = path.join(home, 'empty-models');
    const destination = path.join(temporary, 'verified-models');
    await fs.mkdir(source, { recursive: true });
    const layout = resolveStorageLayout({ home, env: selectedEnv });
    const plan = await planStorageConfiguration({ layout, category: 'models', currentPath: source, target: destination });
    await applyStorageConfiguration(plan, { approvedPlanId: plan.planId, home, category: 'models', target: destination });
    assert.equal(getStorageCategorySelection('models', options), destination);
    assert.equal(getModelsDir(temporary, {}, options), destination, 'locator comes from the supplied environment home');
    assert.equal(getModelsDir(temporary, { models: { dir: path.join(temporary, 'config-models') } }, options), path.join(temporary, 'config-models'));
    const overrideEnv = { ...selectedEnv, PAIROFCLEATS_CACHE_ROOT: path.join(temporary, 'chosen-cache'),
      PAIROFCLEATS_MODELS_DIR: path.join(temporary, 'chosen-models') };
    assert.equal(getCacheRoot({ env: overrideEnv }), path.join(temporary, 'chosen-cache', 'cache'));
    assert.equal(getModelsDir(temporary, {}, { env: overrideEnv }), path.join(temporary, 'chosen-models'));
    assert.equal(getCacheRootBase(), path.join(temporary, 'ambient-cache'), 'omitting options preserves the existing process environment API');
    assert.equal(await fs.readFile(path.join(ambientHome, 'config', 'storage-locations.json'), 'utf8'), '{bad ambient locator');
  });
} finally { await rmDirRecursive(temporary); }
console.log('selected environment storage resolvers passed');
