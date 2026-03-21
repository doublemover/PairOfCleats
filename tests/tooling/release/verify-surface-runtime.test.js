#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const verifyScript = path.join(root, 'tools', 'release', 'verify-surface.js');
const { dir: outDir } = await prepareTestCacheDir('release-verify-runtime');

const runVerify = (surface, stage) => {
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

const apiBoot = runVerify('api', 'boot');
assert.equal(apiBoot.checks?.health, true, 'expected api boot to verify /health');

const apiSmoke = runVerify('api', 'smoke');
assert.equal(apiSmoke.checks?.status, true, 'expected api smoke to verify /status');
assert.equal(apiSmoke.checks?.capabilities, true, 'expected api smoke to verify /capabilities');
assert.equal(apiSmoke.checks?.search, true, 'expected api smoke to verify /search');

const mcpBoot = runVerify('mcp', 'boot');
assert.equal(mcpBoot.checks?.initialize, true, 'expected mcp boot to verify initialize');

const mcpSmoke = runVerify('mcp', 'smoke');
assert.equal(mcpSmoke.checks?.toolsList, true, 'expected mcp smoke to verify tools/list');
assert.equal(mcpSmoke.checks?.indexStatus, true, 'expected mcp smoke to verify index_status');
assert.equal(mcpSmoke.checks?.search, true, 'expected mcp smoke to verify search');

console.log('release verify-surface runtime test passed');
