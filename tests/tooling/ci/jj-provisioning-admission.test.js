import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { provisionCiJj } from '../../../tools/ci/provision-jj.js';
import { JJ_VERSION, resolveCiJjRecipe } from '../../../tools/ci/jj-recipe.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('jj-provisioning-admission');
try {
  for (const platform of ['linux', 'win32', 'darwin']) for (const arch of ['x64', 'arm64']) {
    const row = resolveCiJjRecipe(platform, arch);
    assert.equal(row.version, JJ_VERSION); assert.equal(row.platform, platform); assert.equal(row.arch, arch);
    assert.match(row.sha256, /^[a-f0-9]{64}$/u); assert.ok(row.bytes > 0 && row.bytes < 16 * 1024 * 1024);
    assert.equal(new URL(row.url).origin, 'https://github.com');
    assert.equal(new URL(row.url).pathname, `/jj-vcs/jj/releases/download/v${JJ_VERSION}/${row.filename}`);
    assert.equal(row.archiveType, platform === 'win32' ? 'zip' : 'tar.gz');
  }
  assert.throws(() => resolveCiJjRecipe('win32', 'ia32'));
  const output = path.join(dir, 'github-path'); await fs.writeFile(output, 'retained-path\n');
  const env = { CI: 'true', RUNNER_TEMP: dir, GITHUB_PATH: output };
  let downloaded = 0, extracted = 0, spawned = 0;
  const dependencies = { root: dir, env, download: async () => { downloaded++; throw new Error('unexpected download'); },
    extract: async () => { extracted++; }, run: async () => { spawned++; } };
  for (const invalid of [{ ...env, CI: 'false' }, { ...env, GITHUB_PATH: path.join(path.dirname(dir), 'outside') },
    { ...env, RUNNER_TEMP: 'relative' }, { ...env, GITHUB_PATH: output + '\nextra' }]) {
    await assert.rejects(provisionCiJj({ ...dependencies, env: invalid }));
  }
  assert.equal(downloaded, 0);
  const recipe = resolveCiJjRecipe();
  for (const archive of [{ sourceUrl: 'https://example.invalid/changed.zip', body: Buffer.alloc(recipe.bytes) },
    { sourceUrl: recipe.url, body: Buffer.from('short') }, { sourceUrl: recipe.url, body: Buffer.alloc(recipe.bytes) }]) {
    await assert.rejects(provisionCiJj({ ...dependencies, download: async () => archive }));
    assert.equal(extracted, 0, 'Wrong source/bytes/digest cannot reach the archive owner.');
    assert.equal(spawned, 0, 'Unverified archives cannot start native commands.');
    assert.equal(await fs.readFile(output, 'utf8'), 'retained-path\n', 'Failed provisioning cannot publish a replacement command path.');
    await assert.rejects(fs.stat(path.join(dir, '.diagnostics/jj-provisioning.json')), { code: 'ENOENT' });
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Pinned official Jujutsu recipes reject unsupported/unsafe/unverified provisioning before extraction, execution or path publication.');
