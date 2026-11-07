import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveDevelopmentArtifactPath } from '../shared/dev-artifacts.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';

export const TYPESCRIPT_API7_QUALIFICATION_ROOT = resolveDevelopmentArtifactPath(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), 'test-cache', 'typescript-api7-qualification');
export const TYPESCRIPT_API7_QUALIFICATION_TOOLING = path.join(TYPESCRIPT_API7_QUALIFICATION_ROOT, 'tooling');

// Fixed CI preparation entry, separate from the 30-second fixture budgets. It
// downloads only the exact approved component pair; no npm hooks or CLI shims.
if (isDirectExecution(import.meta.url)) {
  const { guardBootstrapEntry } = await import('../../src/shared/bootstrap-readiness.js');
  await guardBootstrapEntry(import.meta.url);
  if (process.argv.length !== 2) throw new TypeError('TypeScript7.1 qualification preparation accepts no arguments.');
  const { prepareManagedTypeScriptApi7 } = await import('../tooling/managed-typescript-api7.js');
  const report = await prepareManagedTypeScriptApi7({ toolingRoot: TYPESCRIPT_API7_QUALIFICATION_TOOLING });
  const evidence = path.resolve('.diagnostics', 'typescript-api7');
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(path.join(evidence, 'preparation.json'), JSON.stringify({ ...report, node: process.version,
    abi: process.versions.modules, platform: process.platform, arch: process.arch }, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
