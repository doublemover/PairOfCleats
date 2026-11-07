import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { getCurrentConfigGypi } = createRequire(import.meta.url)('node-gyp/lib/create-config-gypi.js');
const { dir } = await prepareIsolatedTestCacheDir('addon-profile-isolation');
const include = path.join(dir, 'include', 'node');
await fs.mkdir(include, { recursive: true });
const base = { target_defaults: { cflags: ['node-only-flag'] }, variables: {
  enable_pgo_use: 'true', enable_pgo_generate: 'true',
  enable_lto: 'true', enable_thin_lto: 'true', fixture_retained: 'original', clang: 1
} };
await fs.writeFile(path.join(include, 'config.gypi'), JSON.stringify(base));
const config = await getCurrentConfigGypi({ nodeDir: dir, python: 'fixture-python',
  gyp: { opts: { 'dist-url': 'https://nodejs.org/download/release', arch: 'x64' }, configDefs: {} },
  vsInfo: { toolset: 'v143', sdk: '10.0.28000.0', versionMajor: 17, msBuild: 'fixture-msbuild' } });
assert.deepEqual(config.target_defaults.cflags, []);
assert.equal(config.variables.fixture_retained, 'original');
assert.equal(config.variables.python, 'fixture-python');
assert.equal(config.variables.target_arch, 'x64');
for (const key of ['enable_pgo_use', 'enable_pgo_generate', 'enable_lto', 'enable_thin_lto']) {
  assert.equal(config.variables[key], process.platform === 'win32' ? 'false' : 'true', key);
}
assert.equal(config.variables.clang, process.platform === 'win32' ? 0 : 1);
assert.equal(JSON.parse(await fs.readFile(path.join(include, 'config.gypi'), 'utf8')).variables.enable_pgo_use, 'true',
  'addon configuration must not alter official Node headers');
console.log('Windows addon configuration isolates executable-only profiles while retaining headers and unrelated options');
