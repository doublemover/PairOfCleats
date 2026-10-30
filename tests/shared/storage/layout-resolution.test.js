import assert from 'node:assert/strict';
import { resolveRepositoryStorage, resolveStorageLayout } from '../../../src/shared/storage/layout.js';

const windows = resolveStorageLayout({ platform: 'win32', cwd: 'C:\\launch', homedir: 'C:\\Users\\Person',
  env: { LOCALAPPDATA: 'C:\\Users\\Person\\AppData\\Local', PAIROFCLEATS_HOME: 'D:\\PoC home',
    PAIROFCLEATS_CACHE_ROOT: 'E:\\cache-base', PAIROFCLEATS_MODELS_DIR: '\\\\server\\models\\Unicode 雪' },
  home: 'C:\\explicit home', machineConfigPath: 'C:\\user-config\\storage.json',
  machineConfig: { categories: { models: './shadowed-models' }, cache: { root: 'F:\\effective-cache' } } });
assert.equal(windows.home.path, 'C:\\explicit home');
assert.equal(windows.home.shadowed[0].source, 'env.PAIROFCLEATS_HOME');
assert.equal(windows.descriptors.cache.path, 'E:\\cache-base\\cache');
assert.equal(windows.descriptors.repos.path, 'E:\\cache-base\\cache\\repos');
assert.equal(windows.descriptors.models.path, '\\\\server\\models\\Unicode 雪');
assert.equal(windows.descriptors.models.shadowed[0].path, 'C:\\user-config\\shadowed-models');
assert.equal(windows.descriptors.models.external, true);
assert.equal(windows.descriptors.reports.retention, 'evidence');
assert.equal(windows.descriptors.repos.deletionAuthority, false);
assert.equal(resolveRepositoryStorage(windows, 'repo-0123456789ab').path, 'E:\\cache-base\\cache\\repos\\repo-0123456789ab');
assert.throws(() => resolveRepositoryStorage(windows, '../other'), /identity/);
const posix = resolveStorageLayout({ platform: 'linux', cwd: '/launch', homedir: '/users/me', env: { XDG_CACHE_HOME: '/xdg' } });
assert.equal(posix.home.path, '/xdg/pairofcleats');
assert.equal(posix.descriptors.models.path, '/xdg/pairofcleats/assets/models');
assert.equal(posix.descriptors.tmp.path, '/xdg/pairofcleats/tmp');
const noLocalAppData = resolveStorageLayout({ platform: 'win32', cwd: 'C:\\launch', homedir: 'C:\\Users\\P', env: {} });
assert.equal(noLocalAppData.home.path, 'C:\\Users\\P\\.cache\\pairofcleats');
const noDoubleCache = resolveStorageLayout({ platform: 'linux', cwd: '/', homedir: '/u', env: { PAIROFCLEATS_CACHE_ROOT: '/chosen/cache' } });
assert.equal(noDoubleCache.descriptors.cache.path, '/chosen/cache');
assert.throws(() => resolveStorageLayout({ machineConfig: { categories: { reports: '/repo' } } }), /trusted source/);
console.log('storage layout resolution passed');
