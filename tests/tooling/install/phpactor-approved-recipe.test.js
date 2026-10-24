import assert from 'node:assert/strict';
import path from 'node:path';
import { getToolingRegistry } from '../../../tools/tooling/utils.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('phpactor-approved-recipe');
const tool = getToolingRegistry(path.join(dir, 'tooling'), dir).find(entry => entry.id === 'phpactor');
const option = (args, name) => args[args.indexOf(name) + 1];
for (const scope of ['cache', 'user']) {
  const install = tool.install[scope];
  assert.equal(install.requires, 'php', `${scope}: PHP is a separate executable prerequisite`);
  assert.ok(install.args.includes('--url'), `${scope}: the normal install recipe must supply its immutable source`);
  assert.equal(option(install.args, '--url'), 'https://github.com/phpactor/phpactor/releases/download/2026.10.07.0/phpactor.phar');
  assert.ok(install.args.includes('--sha256'), `${scope}: the normal install recipe must supply approved bytes`);
  assert.equal(option(install.args, '--sha256'), 'b28bf6166e016d539fc2f2aec18ef918b12590e436a6f1ccbdf30b5bbdbdb16b');
}
console.log('PHPactor install recipes select the immutable publisher release and its approved digest, with PHP kept as a separate prerequisite.');
