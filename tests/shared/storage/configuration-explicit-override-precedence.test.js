import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planStorageConfiguration, applyStorageConfiguration } from '../../../src/shared/storage/configuration.js';
import { readStorageLocator } from '../../../src/shared/storage/locator-read.js';

const temporary = await makeTempDir('poc-configure-explicit-precedence-');
try {
  const home = path.join(temporary, 'home');
  const source = path.join(temporary, 'explicit-models');
  const target = path.join(temporary, 'desired-models');
  const repo = path.join(temporary, 'repo');
  await fs.mkdir(source);
  await fs.mkdir(repo);
  const env = { PAIROFCLEATS_MODELS_DIR: source };
  const layout = resolveStorageLayout({ home, env });
  const before = await fs.readdir(temporary, { recursive: true });
  const plan = await planStorageConfiguration({ layout, category: 'models', currentPath: source, target });
  assert.equal(plan.ready, false);
  assert.equal(plan.blocked.includes('explicit-current-override-would-shadow-locator-selection'), true);
  assert.equal(plan.selectedSourceBefore, 'env.PAIROFCLEATS_MODELS_DIR');
  assert.equal(plan.effectiveDiff['categories.models'].after, source, 'precedence does not disappear after locator publication');
  assert.equal(plan.selectionDiff['categories.models'].after, target);
  await assert.rejects(() => applyStorageConfiguration(plan, { approvedPlanId: plan.planId, home, category: 'models', target }), /exact reviewed/);
  const configured = await planStorageConfiguration({ layout: resolveStorageLayout({ home, env: {} }),
    category: 'models', currentPath: source, currentSource: 'effective-config.models.dir', target });
  assert.equal(configured.ready, false, 'legacy effective-config override is an actual caller source, not inferred from different legacy path strings');
  const result = runNode(['tools/storage/cli.js', 'configure-plan', '--repo', repo, '--home', home,
    '--category', 'models', '--path', target, '--json'], 'storage configure precedence CLI', process.cwd(),
  applyTestEnv({ syncProcess: false, extraEnv: env }), { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).shadowedByExplicitOverride, true);
  assert.equal(JSON.parse(result.stdout).effectiveDiff['categories.models'].after, source);
  assert.equal(readStorageLocator(home).status, 'missing');
  assert.deepEqual(await fs.readdir(temporary, { recursive: true }), before, 'blocked source planning preserves all paths');
} finally { await rmDirRecursive(temporary); }
console.log('storage configure explicit override precedence passed');
