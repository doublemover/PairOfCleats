// Actual native adapter and disposable canonical files; UNVALIDATED development.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareTuiStorage } from '../../tools/tui/operator/storage.js';
import { CACHE_OWNER_FILE } from '../../src/shared/cache-deletion.js';
import { withGeneratedCacheMetadata } from '../../src/shared/generated-artifact-cache.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';
import { applyTestEnv } from '../helpers/test-env.js';

const temporary = await makeTempDir('native-storage-locator-');
const home = path.join(temporary, 'home');
const locator = path.join(home, 'config', 'storage-locations.json');
const roots = ['first', 'second'].map(name => path.join(temporary, name, 'cache'));
const env = { ...applyTestEnv({ extraEnv: { PAIROFCLEATS_HOME: home } }) };
delete env.PAIROFCLEATS_CACHE_ROOT;
const scope = { id: 'selected', configRoot: temporary };
const input = { commandId: 'storage.cleanup-apply', scope, env, values: {}, requireScope: () => scope };
const select = async (root, id = 'a') => fs.writeFile(locator, JSON.stringify({ schemaVersion: 1,
  categories: { cache: { path: root, migrationId: id.repeat(64), owner: 'fixture-cache-owner' } } }));
const probes = roots.map(root => path.join(root, 'tooling', 'command-probes', `${'b'.repeat(40)}.json`));
try {
  await fs.mkdir(path.dirname(locator), { recursive: true });
  for (let index = 0; index < roots.length; index++) {
    await fs.mkdir(path.dirname(probes[index]), { recursive: true });
    await fs.writeFile(path.join(roots[index], CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
    await fs.writeFile(probes[index], JSON.stringify(withGeneratedCacheMetadata({ result: `disposable-${index}` }, 'command-probe')));
  }
  await select(roots[0]);
  const first = await prepareTuiStorage(input);
  assert.equal(first.review.cacheRoot, roots[0], 'actual native preview uses the verified active category selection');
  assert.equal(first.review.launchable, true);
  assert.equal(first.review.canonicalPlan.operations.length, 1);
  const listed = await prepareTuiStorage({ ...input, commandId: 'storage.list' });
  assert.equal(listed.review.cacheRoot, roots[0]);
  await select(roots[1], 'c');
  await assert.rejects(first.execute({}), { code: 'ERR_TUI_STORAGE_STALE' });
  assert.match(await fs.readFile(probes[0], 'utf8'), /disposable-0/);
  assert.match(await fs.readFile(probes[1], 'utf8'), /disposable-1/);
  const second = await prepareTuiStorage(input);
  assert.equal(second.review.cacheRoot, roots[1]);
  const result = JSON.parse((await second.execute({})).stdout);
  assert.equal(result.results[0].status, 'deleted');
  assert.match(await fs.readFile(probes[0], 'utf8'), /disposable-0/);
  await assert.rejects(fs.stat(probes[1]), { code: 'ENOENT' });

  const samePath = await prepareTuiStorage({ ...input, commandId: 'storage.list' });
  await select(roots[1], 'd');
  await assert.rejects(samePath.execute({}), { code: 'ERR_TUI_STORAGE_STALE' },
    'same effective path with changed locator bytes still invalidates the reviewed authority');
  const override = await prepareTuiStorage({ ...input, commandId: 'storage.list',
    env: { ...env, PAIROFCLEATS_CACHE_ROOT: roots[0] } });
  assert.equal(override.review.cacheRoot, roots[0], 'existing explicit environment precedence remains authoritative');

  const current = await prepareTuiStorage({ ...input, commandId: 'storage.list' });
  await fs.writeFile(locator, '{invalid-json');
  await assert.rejects(prepareTuiStorage(input), { code: 'ERR_STORAGE_LOCATOR' });
  await assert.rejects(current.execute({}), { code: 'ERR_STORAGE_LOCATOR' });
  assert.match(await fs.readFile(probes[0], 'utf8'), /disposable-0/);
} finally { await rmDirRecursive(temporary); }
console.log('Native storage follows the canonical locator and refuses selection drift before execution.');
