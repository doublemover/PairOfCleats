#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { getCacheRootBase, normalizeLegacyCacheRootPath, resolveVersionedCacheRoot } from '../../src/shared/cache-roots.js';
import { readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { applyStorageCleanupPlan, planCacheRootCleanup } from '../../src/shared/storage/cleanup.js';

const argv = createCli({
  scriptName: 'clear-cache', argv: process.argv,
  usage: 'usage: clear-cache [--cache-root <path>] [--json] [--apply --plan <file> --plan-id <id>]',
  options: {
    all: { type: 'boolean', default: false, describe: 'Report legacy-root request; legacy evidence requires explicit migration/adoption' },
    force: { type: 'boolean', default: false, describe: 'Compatibility option; never bypasses plan, ownership, pins or leases' },
    apply: { type: 'boolean', default: false, describe: 'Apply the exact reviewed disposable-category plan' },
    json: { type: 'boolean', default: false, describe: 'Print structured plan or apply receipt' },
    plan: { type: 'string', describe: 'Previously reviewed plan JSON file' },
    'plan-id': { type: 'string', describe: 'Exact plan ID authorizing apply' },
    'cache-root': { type: 'string', describe: 'Launch-selected cache root; existing cache-only normalization is preserved' }
  }
}).parse();

try {
  const baseInput = argv['cache-root'] || getCacheRootBase();
  const root = resolveVersionedCacheRoot(normalizeLegacyCacheRootPath(baseInput) || path.resolve(baseInput));
  let receipt;
  if (argv.apply) {
    if (!argv.plan || !argv['plan-id']) throw new Error('Apply requires --plan and --plan-id from a reviewed dry run; --force is not authority.');
    const file = path.resolve(argv.plan);
    const { buffer } = await readVerifiedContainedFile(path.parse(file).root, file, { maxBytes: 16 * 1024 * 1024 });
    const plan = JSON.parse(buffer.toString('utf8'));
    if (plan.cacheRoot !== root) throw new Error('Reviewed plan cache root differs from the launch-selected root.');
    receipt = await applyStorageCleanupPlan(plan, { authorityRoots: [root], approvedPlanId: argv['plan-id'] });
  } else receipt = await planCacheRootCleanup({ cacheRoot: root, authorityRoots: [root] });
  if (argv.json) console.log(JSON.stringify(receipt, null, 2));
  else if (argv.apply) console.log(`Cleanup ${receipt.complete ? 'complete' : 'partial'}: ${receipt.results.filter(result => result.status === 'deleted').length} disposable files deleted. Saved evidence is preserved.`);
  else console.log(`Dry run ${receipt.planId}: ${receipt.operations.length} disposable files planned; ${receipt.blocked.length} blocked. Use --json to save and review the exact plan. Saved evidence and unregistered data are preserved.`);
  if (argv.all) console.error('Legacy-root bytes were preserved; use explicit storage migration/adoption planning.');
  if (argv.apply && !receipt.complete) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
