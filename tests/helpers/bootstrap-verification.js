import fs from 'node:fs/promises';
import path from 'node:path';
import { BOOTSTRAP_INPUTS, captureBootstrapVerification, recordBootstrapReadiness } from '../../src/shared/bootstrap-readiness.js';
import { makeTempDir } from './temp.js';

/** Inert metadata fixture only. No placeholder native file is ever activated,
 * and these receipts are never used for application workload admission.
 */
export const makeBootstrapVerificationFixture = async () => {
  const root = await makeTempDir('bootstrap-verification-');
  const packages = ['tree-sitter', 'better-sqlite3'];
  const write = async (relative, text) => {
    const target = path.join(root, relative); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text);
  };
  for (const relative of BOOTSTRAP_INPUTS) await write(relative, await fs.readFile(path.resolve(relative)));
  await write('package.json', JSON.stringify({ type: 'module', dependencies: Object.fromEntries(packages.map(name => [name, '1.0.0'])) }));
  for (const name of packages) {
    await write(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0' }));
    await write(`node_modules/${name}/fixture.node`, 'inert-metadata-only-never-load');
  }
  return { root, packages, write, capture: () => captureBootstrapVerification(root),
    record: verification => recordBootstrapReadiness(root, packages, { verification }) };
};
