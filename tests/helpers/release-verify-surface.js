import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runNode } from './run-node.js';
import { prepareTestCacheDir } from './test-cache.js';
import { ensureTestingEnv } from './test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const verifyScript = path.join(root, 'tools', 'release', 'verify-surface.js');

export const runVerifySurface = async (surface, stage) => {
  const { dir: outDir } = await prepareTestCacheDir(`release-verify-runtime-${surface}-${stage}`);
  const outPath = path.join(outDir, `${surface}-${stage}.json`);
  const result = runNode(
    [verifyScript, '--surface', surface, '--stage', stage, '--out', outPath],
    `verify-surface ${surface}:${stage}`,
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', timeoutMs: 30000 }
  );
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.ok, true, `expected ${surface}:${stage} to succeed`);
  assert.equal(fs.existsSync(outPath), true, `expected output artifact for ${surface}:${stage}`);
  return payload;
};
