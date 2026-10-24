import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildToolingReport } from '../../../tools/tooling/utils.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
const { dir } = await prepareIsolatedTestCacheDir('tool-plan-without-probes');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off' });
let probes = 0;
const detectTool = () => { probes++; return { found: true, probe: { ok: true } }; };
try {
  const plan = await buildToolingReport(dir, ['typescript'], { skipScan: true, skipToolDetection: true, detectTool });
  assert.equal(probes, 0);
  assert.ok(Object.hasOwn(plan.languages, 'typescript'));
  const detected = await buildToolingReport(dir, ['typescript'], { skipScan: true, detectTool });
  assert.ok(detected.tools.length > 0);
  assert.equal(probes, detected.tools.length, 'the selected report detection pass probes each tool once');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Installer language planning can omit executable probes without changing tool selection.');
