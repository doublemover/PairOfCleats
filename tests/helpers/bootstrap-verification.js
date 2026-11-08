import fs from 'node:fs/promises';
import path from 'node:path';
import { BOOTSTRAP_INPUTS, captureBootstrapVerification, recordBootstrapReadiness } from '../../src/shared/bootstrap-readiness.js';
import { makeTempDir } from './temp.js';
import { withCheckoutMutation } from '../../tools/setup/checkout-mutation.js';
import { withCheckoutStageJournal } from '../../tools/setup/checkout-stage-journal.js';

/** Actual mutation/journal scope for inert metadata fixtures. The fixture does
 * not claim native activation; placeholder files are never loaded here.
 */
export const withBootstrapVerificationFixture = (root, packages, operation = ({ capture, record }) => record(capture())) =>
  withCheckoutMutation(root, session => withCheckoutStageJournal(root, session,
    { schemaVersion: 1, kind: 'inert-bootstrap-metadata-fixture', root: session.root, stages: [{ id: 'fixture-verification' }] },
    journal => journal.runStage('fixture-verification', () => operation({ session, journal,
      capture: () => captureBootstrapVerification(root, { session }),
      record: verification => recordBootstrapReadiness(root, packages, { verification }) }))));

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
  return { root, packages, write, verify: operation => withBootstrapVerificationFixture(root, packages, operation) };
};
