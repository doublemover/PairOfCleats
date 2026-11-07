import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeBootstrapVerificationFixture } from './bootstrap-verification.js';
import { copyBootstrapMetadataSources } from './bootstrap-metadata-sources.js';

/** A disposable metadata diagnosis fixture, never an application installation.
 * Its package adapters delegate bounded probes to the prepared checkout's real
 * binaries; no placeholder native is loaded, copied, linked or qualified here.
 */
export const makeBootstrapDiagnosisFixture = async (sourceRoot = process.cwd()) => {
  const fixture = await makeBootstrapVerificationFixture();
  const { root, packages, write } = fixture;
  packages.push('tree-sitter-javascript');
  const declarations = {};
  for (const name of packages) {
    const installed = path.join(sourceRoot, 'node_modules', name);
    declarations[name] = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version;
    await write(`node_modules/${name}/package.json`, JSON.stringify({ name, version: declarations[name], main: 'index.cjs' }));
    await write(`node_modules/${name}/index.cjs`, `module.exports = require(${JSON.stringify(installed)});\n`);
    fs.rmSync(path.join(root, 'node_modules', name, 'fixture.node'), { force: true });
  }
  await write('package.json', JSON.stringify({ type: 'module', private: true, dependencies: declarations,
    scripts: { 'diagnosis-probe': 'node diagnosis-probe.js' } }));
  await write('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {
    '': { dependencies: declarations },
    ...Object.fromEntries(packages.map(name => ['node_modules/' + name, { version: declarations[name] }]))
  } }));
  copyBootstrapMetadataSources(sourceRoot, root, ['tools/setup/checkout-diagnose.js']);
  await write('diagnosis-probe.js', `
import { requireBootstrap } from './src/shared/bootstrap-readiness.js';
import { handleCheckoutInformation } from './tools/setup/checkout-diagnose.js';
if (process.argv[2] === 'ordinary') {
  try { await requireBootstrap(); throw Error('The stale runtime must not admit work.'); }
  catch (error) {
    if (error.code !== 'ERR_BOOTSTRAP_REQUIRED') throw error;
    process.stdout.write(JSON.stringify({code:error.code,bootstrap:error.bootstrap,recovery:error.recovery,runtime:error.runtime,message:error.message})+'\\n');
    process.exitCode = 1;
  }
} else await handleCheckoutInformation(['checkout','diagnose','--json']);
`);
  await fixture.verify();
  return { ...fixture, dispose: async () => {
    const resolved = fs.realpathSync(root), temporaryRoot = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), temporaryRoot);
    assert.match(path.basename(resolved), /^bootstrap-verification-/);
    await fs.promises.rm(resolved, { recursive: true, force: true });
  } };
};
